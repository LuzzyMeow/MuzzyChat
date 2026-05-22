import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import { ChatGateway } from '../gateway/chat.gateway';

// ── Types (溯源: 02-群聊与交互设计.md §2.1-2.4) ──────────────

export interface PeerMessage {
  agentId: string;
  content: string;
}

export interface DynamicRoundInput {
  conversationId: string;
  members: { agentId: string; agentName: string }[];
  previousMessages: PeerMessage[];
  currentRound: number;
}

export interface DynamicRoundResult {
  roundNumber: number;
  roundMessages: string[];
  terminationReason?: 'all_skipped' | 'max_rounds' | 'user_interrupted';
}

/** Max dynamic rounds = N × 3 (02-群聊设计 §2.3) */
function maxDynamicRounds(memberCount: number): number {
  return memberCount * 3;
}

/**
 * 动态讨论协调器 (02-群聊与交互设计.md §二)
 *
 * 在 Parallel 模式 ROUND_COMPLETE 后, 若 dynamic_discussion_enabled = true,
 * 管理 Agent 间的追加评论轮次, 控制上限 N×3, 检测跳过/终止条件。
 */
@Injectable()
export class DynamicDiscussionCoordinator {
  private readonly logger = new Logger(DynamicDiscussionCoordinator.name);

  constructor(
    @Inject(forwardRef(() => AgentLoopService))
    private readonly agentLoopService: AgentLoopService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * 运行一轮动态讨论 (02-群聊设计 §2.2)
   *
   * 每轮: 向每个 Agent 广播 peer messages → Agent 决策 (追加评论 or SKIP) →
   * 收集回复 → 返回结果
   */
  async runDynamicRound(input: DynamicRoundInput): Promise<DynamicRoundResult> {
    const { conversationId, members, previousMessages, currentRound } = input;
    const maxRounds = maxDynamicRounds(members.length);
    const nextRound = currentRound + 1;

    // 终止条件: 达到 N×3 上限 (02-群聊设计 §2.3)
    if (nextRound > maxRounds) {
      this.logger.log(
        `Dynamic discussion max rounds (${maxRounds}) reached for ${conversationId}`,
      );
      return { roundNumber: nextRound, roundMessages: [], terminationReason: 'max_rounds' };
    }

    // 构建 peer message 文本 (02-群聊设计 §2.2.2)
    const peerMessagesText = previousMessages
      .map((pm) => `${pm.agentId}: ${pm.content.slice(0, 200)}`)
      .join('\n');

    // 决策引导 Prompt (02-群聊设计 §2.2.2)
    const decisionPrompt = [
      '[系统提示 - 动态讨论模式]',
      '你正在参与群组动态讨论。以下是其他成员的最新发言：',
      '---',
      peerMessagesText || '(暂无其他成员发言)',
      '---',
      '你可以选择：',
      '1. 追加评论：对其他成员的观点进行回应、补充或反驳',
      `2. 跳过：如果你认为当前讨论已无需你补充，回复 [SKIP] 即可`,
      `当前动态讨论轮次：${nextRound} / ${maxRounds}`,
    ].join('\n');

    // 并发启动所有 Agent (每个 Agent 收到相同的 peer message context)
    const roundMessages: string[] = [];
    let allSkipped = true;

    const results = await Promise.allSettled(
      members.map(async (member) => {
        // Broadcast peer message to agent (02-群聊设计 §2.2.1)
        this.chatGateway.emitAgentPeerMessage(conversationId, {
          fromAgentId: 'system',
          content: peerMessagesText,
          messageId: `dynamic_${conversationId}_round_${nextRound}`,
        });

        // Run agent loop with decision prompt, capture response for [SKIP] detection
        // (02-群聊设计 §2.2.3: 精确匹配 [SKIP]、空内容、失败均视为跳过)
        const response = await this.agentLoopService.runAgentLoop({
          agentId: member.agentId,
          conversationId,
          userMessage: decisionPrompt,
        });

        const trimmed = response.trim();
        const skipped = !trimmed || trimmed === '[SKIP]';
        return { agentId: member.agentId, skipped };
      }),
    );

    // 收集结果
    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.skipped) {
        allSkipped = false;
      }
    }

    // 全部跳过 → 终止 (02-群聊设计 §2.3)
    if (allSkipped) {
      this.logger.log(
        `All agents skipped in dynamic round ${nextRound} for ${conversationId}`,
      );
      return { roundNumber: nextRound, roundMessages, terminationReason: 'all_skipped' };
    }

    return { roundNumber: nextRound, roundMessages };
  }
}
