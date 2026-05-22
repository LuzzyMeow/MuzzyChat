import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { DynamicDiscussionCoordinator } from './dynamic-discussion.service';
import { LoopDetector } from './loop-detector.service';

// ── Types (溯源: 02-群聊与交互设计.md §1.1-1.2) ──────────────

/** 7 态状态机 (02-群聊设计 §1.2) */
export enum ParallelState {
  Idle = 'idle',
  UserSent = 'user_sent',
  AgentsThinking = 'agents_thinking',
  AgentsResponding = 'agents_responding',
  RoundComplete = 'round_complete',
  DynamicDiscussion = 'dynamic_discussion',
  LoopDetected = 'loop_detected',
}

interface AgentRoundState {
  agentId: string;
  agentName: string;
  joinedAt: Date;
  status: 'thinking' | 'responding' | 'completed' | 'failed';
  content: string;
}

interface RoundState {
  status: ParallelState;
  conversationId: string;
  members: AgentRoundState[];
  startedAt: Date;
  completedCount: number;
  failedCount: number;
  dynamicRoundCount: number;
  /** Store latest round messages for loop detection */
  roundMessages: string[];
}

@Injectable()
export class ParallelOrchestrator {
  private readonly logger = new Logger(ParallelOrchestrator.name);
  /** Per-conversation round state (内存态) */
  private readonly rounds = new Map<string, RoundState>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentLoopService))
    private readonly agentLoopService: AgentLoopService,
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => DynamicDiscussionCoordinator))
    private readonly dynamicDiscussion: DynamicDiscussionCoordinator,
    @Inject(forwardRef(() => LoopDetector))
    private readonly loopDetector: LoopDetector,
  ) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * 触发一轮 Parallel 模式讨论 (02-群聊设计 §1.2)
   * 替代 Gateway.triggerAgentResponse 中的简单并行分派
   */
  async triggerRound(params: {
    conversationId: string;
    userMessage: string;
    groupName: string;
    dynamicDiscussionEnabled: boolean;
  }): Promise<void> {
    const { conversationId, userMessage, groupName, dynamicDiscussionEnabled } = params;

    try {
      // 1. 查询群组成员 (enabled + agent 未删除)
      const members = await this.prisma.groupMember.findMany({
        where: {
          group: { conversationId, deletedAt: null },
          enabled: true,
          agent: { deletedAt: null },
        },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      });

      if (members.length === 0) {
        this.logger.warn(`No enabled agents in conversation ${conversationId}`);
        return;
      }

      // 2. 初始化轮次状态 → USER_SENT
      const roundState: RoundState = {
        status: ParallelState.UserSent,
        conversationId,
        members: members.map((m) => ({
          agentId: m.agentId,
          agentName: m.agent.name,
          joinedAt: m.joinedAt,
          status: 'thinking',
          content: '',
        })),
        startedAt: new Date(),
        completedCount: 0,
        failedCount: 0,
        dynamicRoundCount: 0,
        roundMessages: [],
      };

      this.rounds.set(conversationId, roundState);

      // 3. → AGENTS_THINKING
      roundState.status = ParallelState.AgentsThinking;

      // 4. 并发启动所有 Agent
      const messageContent = `[Group Chat - ${groupName}] ${userMessage}`;
      const results = await Promise.allSettled(
        members.map((m) =>
          this.agentLoopService.runAgentLoop({
            agentId: m.agentId,
            conversationId,
            userMessage: messageContent,
          }),
        ),
      );

      // 5. → AGENTS_RESPONDING (首个 Agent 开始流式输出时自动触发)
      // → ROUND_COMPLETE (所有 Agent 完成, 包括失败)
      roundState.status = ParallelState.RoundComplete;

      // 统计结果
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          roundState.members[i].status = 'completed';
          roundState.completedCount++;
        } else {
          roundState.members[i].status = 'failed';
          roundState.failedCount++;
          this.logger.warn(
            `Agent ${roundState.members[i].agentId} failed: ${r.reason}`,
          );
        }
      }

      // 全部失败 → 转入 IDLE
      if (roundState.failedCount === members.length) {
        this.logger.error(
          `All agents failed in conversation ${conversationId}`,
        );
        this.chatGateway.emitError(conversationId, {
          code: 'ALL_AGENTS_FAILED',
          message: '所有 Agent 暂时无法响应',
        });
        roundState.status = ParallelState.Idle;
        return;
      }

      // 6. 异常处理: 单个 Agent 失败不影响其他
      // (已完成, failed agents 标记后不再触发)

      // 7. 检查动态讨论模式
      if (dynamicDiscussionEnabled) {
        await this.enterDynamicDiscussion(conversationId, roundState);
      } else {
        roundState.status = ParallelState.Idle;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Parallel round failed: ${msg}`);
      const state = this.rounds.get(conversationId);
      if (state) state.status = ParallelState.Idle;
      this.chatGateway.emitError(conversationId, {
        code: 'ORCHESTRATOR_ERROR',
        message: msg,
      });
    }
  }

  /** 用户发送新消息 → 终止当前轮 */
  interruptRound(conversationId: string): void {
    const state = this.rounds.get(conversationId);
    if (!state) return;

    if (
      state.status === ParallelState.DynamicDiscussion ||
      state.status === ParallelState.AgentsThinking ||
      state.status === ParallelState.AgentsResponding
    ) {
      this.logger.log(
        `Round interrupted by user in conversation ${conversationId}`,
      );
      state.status = ParallelState.Idle;
    }
  }

  /** 获取当前轮次状态 (用于查询) */
  getRoundState(conversationId: string): RoundState | undefined {
    return this.rounds.get(conversationId);
  }

  // ── Private: Dynamic Discussion ─────────────────────────────

  private async enterDynamicDiscussion(
    conversationId: string,
    roundState: RoundState,
  ): Promise<void> {
    roundState.status = ParallelState.DynamicDiscussion;

    // 收集本轮完成的 Agent 回复
    const completedMembers = roundState.members.filter(
      (m) => m.status === 'completed' && m.content,
    );

    // 委托 DynamicDiscussionCoordinator 管理轮次
    let keepGoing = true;
    while (keepGoing) {
      const result = await this.dynamicDiscussion.runDynamicRound({
        conversationId,
        members: roundState.members.filter((m) => m.status !== 'failed'),
        previousMessages: completedMembers.map((m) => ({
          agentId: m.agentId,
          content: m.content,
        })),
        currentRound: roundState.dynamicRoundCount,
      });

      roundState.dynamicRoundCount = result.roundNumber;

      // 收集本轮消息用于循环检测
      result.roundMessages.forEach((msg) => roundState.roundMessages.push(msg));

      // 终止条件检测 (02-群聊设计 §2.3)
      if (result.terminationReason) {
        const reason = result.terminationReason;
        if (reason === 'all_skipped' || reason === 'max_rounds') {
          keepGoing = false;
        } else if (reason === 'user_interrupted') {
          keepGoing = false;
        }
        continue;
      }

      // 观点循环检测 (02-群聊设计 §3)
      const loopResult = this.loopDetector.check(
        roundState.roundMessages,
        roundState.dynamicRoundCount,
      );

      if (loopResult.needsConfirmation) {
        const confirmed = await this.loopDetector.confirmViaLLM(
          roundState.roundMessages.slice(-100),
        );
        if (confirmed) {
          roundState.status = ParallelState.LoopDetected;
          await this.handleLoopDetected(conversationId, roundState);
          keepGoing = false;
        }
      }
    }

    roundState.status = ParallelState.Idle;
  }

  /** 观点循环检测后的处理 (02-群聊设计 §3.4) */
  private async handleLoopDetected(
    conversationId: string,
    roundState: RoundState,
  ): Promise<void> {
    // 插入系统消息"请各自总结观点"
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'system',
        content: '检测到观点循环，请各自总结观点',
        messageType: 'system_notice',
      },
    });

    // 给每个活跃 Agent 一次总结机会
    const activeMembers = roundState.members.filter((m) =>
      ['thinking', 'responding', 'completed'].includes(m.status),
    );

    for (const member of activeMembers) {
      try {
        await this.agentLoopService.runAgentLoop({
          agentId: member.agentId,
          conversationId,
          userMessage: '[系统] 检测到观点循环，请总结你的最终观点',
        });
      } catch (error) {
        this.logger.warn(
          `Summary failed for agent ${member.agentId}: ${error}`,
        );
      }
    }

    // 转入 ROUND_COMPLETE → IDLE
    roundState.status = ParallelState.RoundComplete;
  }
}
