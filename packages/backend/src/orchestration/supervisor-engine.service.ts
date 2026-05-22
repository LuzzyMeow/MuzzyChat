import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import { ChatGateway } from '../gateway/chat.gateway';
import type { GroupMember } from '../../generated/prisma/client';

// ── Types (溯源: 02-群聊与交互设计.md §4.1) ──────────────────

enum PlanStatus {
  Draft = 'draft',
  Executing = 'executing',
  Completed = 'completed',
  Failed = 'failed',
  Replanned = 'replanned',
}

enum SubtaskStatus {
  Pending = 'pending',
  Ready = 'ready',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}

interface Subtask {
  subtaskId: string;
  planId: string;
  agentId: string;
  agentName: string;
  title: string;
  description: string;
  dependencies: string[];
  status: SubtaskStatus;
  result?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface ExecutionPlan {
  planId: string;
  conversationId: string;
  supervisorAgentId: string;
  userRequest: string;
  subtasks: Subtask[];
  createdAt: Date;
  status: PlanStatus;
}

interface ValidationError {
  type: string;
  subtaskId?: string;
  message: string;
}

/**
 * Supervisor 模式执行引擎 (02-群聊与交互设计.md §四)
 *
 * 内存态 (02-群聊设计 §4.5 明确不持久化至数据库):
 * 1. Supervisor Agent 通过 LLM 生成 ExecutionPlan
 * 2. PlanValidator 校验 (agent_id 有效性 / 依赖成环 / 不可达子任务)
 * 3. PlanExecutor 拓扑排序 + 并行执行子任务
 * 4. 失败重试 (3 次, 指数退避) + 通知 Supervisor 重新规划
 */
@Injectable()
export class SupervisorEngine {
  private readonly logger = new Logger(SupervisorEngine.name);
  /** 内存态计划存储 */
  private readonly plans = new Map<string, ExecutionPlan>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    @Inject(forwardRef(() => AgentLoopService))
    private readonly agentLoopService: AgentLoopService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * 启动 Supervisor 模式 (02-群聊设计 §4.3)
   */
  async start(params: {
    conversationId: string;
    supervisorAgentId: string;
    userMessage: string;
    members: (GroupMember & { agent: { id: string; name: string } })[];
  }): Promise<void> {
    const { conversationId, supervisorAgentId, userMessage, members } = params;

    try {
      // 1. 加载 Supervisor Agent 配置
      const supervisorAgent = await this.prisma.agent.findFirst({
        where: { id: supervisorAgentId, deletedAt: null },
      });

      if (!supervisorAgent) {
        this.logger.warn(`Supervisor agent ${supervisorAgentId} not found`);
        this.chatGateway.emitError(conversationId, {
          code: 'SUPERVISOR_NOT_FOUND',
          message: '主管 Agent 不存在',
        });
        return;
      }

      // 2. Supervisor 生成 ExecutionPlan (02-群聊设计 §4.1)
      const plan = await this.generatePlan(
        supervisorAgentId,
        supervisorAgent.name,
        conversationId,
        userMessage,
        members,
      );

      if (!plan || plan.subtasks.length === 0) {
        this.logger.warn('Supervisor generated empty plan');
        this.chatGateway.emitError(conversationId, {
          code: 'EMPTY_PLAN',
          message: '主管无法为当前任务生成有效计划',
        });
        return;
      }

      // 3. 计划验证 (02-群聊设计 §4.2)
      const validationErrors = this.validatePlan(plan, members);
      if (validationErrors.length > 0) {
        this.logger.warn(
          `Plan validation failed: ${validationErrors.map((e) => e.message).join('; ')}`,
        );
        // 通知 Supervisor 重新规划
        plan.status = PlanStatus.Replanned;
        const retryPlan = await this.generatePlan(
          supervisorAgentId,
          supervisorAgent.name,
          conversationId,
          `上一次计划验证失败 (${validationErrors[0].message})，请重新规划: ${userMessage}`,
          members,
        );
        if (!retryPlan || retryPlan.subtasks.length === 0) {
          plan.status = PlanStatus.Failed;
          this.chatGateway.emitError(conversationId, {
            code: 'PLAN_FAILED',
            message: '计划验证失败且重规划也失败',
          });
          return;
        }
        // Use retry plan
        this.plans.set(conversationId, retryPlan);
        await this.executePlan(conversationId, retryPlan, members);
        return;
      }

      // 4. 存储并执行计划
      this.plans.set(conversationId, plan);
      await this.executePlan(conversationId, plan, members);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`Supervisor engine failed: ${msg}`);
      this.chatGateway.emitError(conversationId, {
        code: 'SUPERVISOR_ERROR',
        message: msg,
      });
    }
  }

  // ── Plan Generation (02-群聊设计 §4.1) ─────────────────────

  private async generatePlan(
    supervisorAgentId: string,
    supervisorName: string,
    conversationId: string,
    userRequest: string,
    members: (GroupMember & { agent: { id: string; name: string } })[],
  ): Promise<ExecutionPlan | null> {
    const memberInfo = members
      .filter((m) => m.enabled)
      .map((m) => `- ${m.agentId}: ${m.agent.name}`)
      .join('\n');

    const prompt = [
      '你是一个任务主管 Agent。请根据用户需求和可用团队成员，生成一份结构化的执行计划。',
      '',
      '用户需求：',
      userRequest,
      '',
      '可用团队成员：',
      memberInfo,
      '',
      '请输出严格的 JSON 格式执行计划（不要输出其他内容）：',
      '```json',
      '{',
      '  "subtasks": [',
      '    {',
      '      "subtaskId": "sub_01",',
      '      "agentId": "agent_id_here",',
      '      "agentName": "Agent 名称",',
      '      "title": "子任务标题",',
      '      "description": "详细的子任务描述",',
      '      "dependencies": []',
      '    }',
      '  ]',
      '}',
      '```',
      '',
      '规则：',
      '1. subtaskId 必须唯一，如 sub_01, sub_02, sub_03',
      '2. agentId 必须从可用团队成员中选择',
      '3. dependencies 为前置依赖的 subtaskId 列表（空数组表示无依赖）',
      '4. 子任务数量 1-10',
      '5. 子任务按执行顺序排列，有依赖关系的必须排在被依赖任务后面',
    ].join('\n');

    try {
      // 使用大模型生成计划
      const model = await this.llmService.getDefaultModelByRole('big');
      const response = await model.invoke(prompt);
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*?"subtasks"[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.warn('Failed to extract JSON from supervisor plan');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const subtasks: Subtask[] = (parsed.subtasks ?? []).map(
        (s: SubTaskInput) => ({
          subtaskId: s.subtaskId ?? `sub_${Date.now()}`,
          planId: `plan_${conversationId}_${Date.now()}`,
          agentId: s.agentId,
          agentName: s.agentName ?? 'Unknown',
          title: s.title ?? 'Untitled',
          description: s.description ?? '',
          dependencies: s.dependencies ?? [],
          status: SubtaskStatus.Pending,
          result: undefined,
          error: undefined,
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(),
        }),
      );

      return {
        planId: `plan_${conversationId}_${Date.now()}`,
        conversationId,
        supervisorAgentId,
        userRequest,
        subtasks,
        createdAt: new Date(),
        status: PlanStatus.Draft,
      };
    } catch (error) {
      this.logger.error(`Failed to generate plan: ${error}`);
      return null;
    }
  }

  // ── Plan Validation (02-群聊设计 §4.2) ────────────────────

  private validatePlan(
    plan: ExecutionPlan,
    members: (GroupMember & { agent: { id: string; name: string } })[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // agent_id 校验 (02-群聊设计 §4.2.1)
    const memberIds = new Set(
      members.filter((m) => m.enabled).map((m) => m.agentId),
    );
    for (const subtask of plan.subtasks) {
      if (!memberIds.has(subtask.agentId)) {
        errors.push({
          type: 'INVALID_AGENT',
          subtaskId: subtask.subtaskId,
          message: `Agent ${subtask.agentId} 不在群组成员列表中`,
        });
      }
    }

    // 依赖成环检测 (02-群聊设计 §4.2.2)
    const cycleError = this.detectDependencyCycle(plan);
    if (cycleError) errors.push(cycleError);

    // 不可达子任务检测 (02-群聊设计 §4.2.3)
    const unreachableErrors = this.detectUnreachableSubtasks(plan);
    errors.push(...unreachableErrors);

    return errors;
  }

  private detectDependencyCycle(plan: ExecutionPlan): ValidationError | null {
    const subtaskMap = new Map(plan.subtasks.map((s) => [s.subtaskId, s]));
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function dfs(subtaskId: string): boolean {
      visited.add(subtaskId);
      recursionStack.add(subtaskId);

      const subtask = subtaskMap.get(subtaskId);
      if (!subtask) return false;

      for (const depId of subtask.dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true;
        }
      }

      recursionStack.delete(subtaskId);
      return false;
    }

    for (const subtask of plan.subtasks) {
      if (!visited.has(subtask.subtaskId)) {
        if (dfs(subtask.subtaskId)) {
          return {
            type: 'CYCLIC_DEPENDENCY',
            message: '子任务依赖关系存在环',
          };
        }
      }
    }

    return null;
  }

  private detectUnreachableSubtasks(plan: ExecutionPlan): ValidationError[] {
    const reachable = new Set<string>();
    const queue: string[] = [];

    for (const subtask of plan.subtasks) {
      if (subtask.dependencies.length === 0) {
        reachable.add(subtask.subtaskId);
        queue.push(subtask.subtaskId);
      }
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const subtask = plan.subtasks.find((s) => s.subtaskId === currentId);
      if (!subtask) continue;

      for (const candidate of plan.subtasks) {
        if (reachable.has(candidate.subtaskId)) continue;
        if (candidate.dependencies.every((dep) => reachable.has(dep))) {
          reachable.add(candidate.subtaskId);
          queue.push(candidate.subtaskId);
        }
      }
    }

    return plan.subtasks
      .filter((s) => !reachable.has(s.subtaskId))
      .map((s) => ({
        type: 'UNREACHABLE_SUBTASK',
        subtaskId: s.subtaskId,
        message: `子任务 ${s.title} 不可达（依赖了不存在的子任务）`,
      }));
  }

  // ── Plan Execution (02-群聊设计 §4.3) ──────────────────────

  private async executePlan(
    conversationId: string,
    plan: ExecutionPlan,
    members: (GroupMember & { agent: { id: string; name: string } })[],
  ): Promise<void> {
    plan.status = PlanStatus.Executing;
    const subtaskMap = new Map(plan.subtasks.map((s) => [s.subtaskId, s]));

    while (true) {
      // 拓扑排序获取 Ready 子任务 (02-群聊设计 §4.3.1)
      const readySubtasks = this.getReadySubtasks(plan, subtaskMap);

      if (readySubtasks.length === 0) {
        if (this.allSubtasksCompleted(plan)) break;

        // 存在 Failed (阻塞) 子任务 → 通知 Supervisor 重新规划
        if (this.hasBlockedFailed(plan, subtaskMap)) {
          const replanned = await this.replan(conversationId, plan, members);
          if (replanned) {
            // 合并重规划的子任务
            plan.subtasks.push(...replanned.subtasks);
            plan.status = PlanStatus.Executing;
            continue;
          } else {
            plan.status = PlanStatus.Failed;
            break;
          }
        }

        break;
      }

      // 并行执行所有 Ready 子任务 (02-群聊设计 §4.3.1)
      await Promise.allSettled(
        readySubtasks.map(async (subtask) => {
          subtask.status = SubtaskStatus.Running;
          subtask.startedAt = new Date();

          // Emit task:update (02-群聊设计 §4.4.1)
          this.chatGateway.emitTaskUpdate(conversationId, {
            taskId: subtask.subtaskId,
            status: 'running',
            data: {
              planId: plan.planId,
              agentId: subtask.agentId,
              agentName: subtask.agentName,
              title: subtask.title,
            },
          });

          try {
            await this.agentLoopService.runAgentLoop({
              agentId: subtask.agentId,
              conversationId,
              userMessage: `[子任务] ${subtask.title}: ${subtask.description}`,
            });

            subtask.status = SubtaskStatus.Completed;
            subtask.completedAt = new Date();

            this.chatGateway.emitTaskUpdate(conversationId, {
              taskId: subtask.subtaskId,
              status: 'completed',
              data: { title: subtask.title },
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown';
            subtask.error = msg;
            subtask.retryCount++;

            // 重试 (02-群聊设计 §4.3.3: 指数退避 1s/2s/4s)
            if (subtask.retryCount < subtask.maxRetries) {
              const delayMs = 1000 * 2 ** (subtask.retryCount - 1);
              this.logger.warn(
                `Subtask ${subtask.subtaskId} failed, retrying in ${delayMs}ms (${subtask.retryCount}/${subtask.maxRetries})`,
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              subtask.status = SubtaskStatus.Pending;
            } else {
              subtask.status = SubtaskStatus.Failed;
              this.logger.error(
                `Subtask ${subtask.subtaskId} failed after ${subtask.maxRetries} retries`,
              );
              this.chatGateway.emitTaskUpdate(conversationId, {
                taskId: subtask.subtaskId,
                status: 'failed',
                data: { error: msg },
              });
            }
          }
        }),
      );
    }

    if (plan.status === PlanStatus.Executing) {
      plan.status = PlanStatus.Completed;
      this.logger.log(`Plan ${plan.planId} completed`);
    }
  }

  private getReadySubtasks(
    plan: ExecutionPlan,
    subtaskMap: Map<string, Subtask>,
  ): Subtask[] {
    return plan.subtasks.filter((subtask) => {
      if (subtask.status !== SubtaskStatus.Pending) return false;
      return subtask.dependencies.every((depId) => {
        const dep = subtaskMap.get(depId);
        return dep && dep.status === SubtaskStatus.Completed;
      });
    });
  }

  private allSubtasksCompleted(plan: ExecutionPlan): boolean {
    // 02-群聊设计 §4.3.1: 仅 Completed || Skipped 视为完成
    // Failed 子任务应触发 replan，不视为正常完成
    return plan.subtasks.every(
      (s) =>
        s.status === SubtaskStatus.Completed ||
        s.status === SubtaskStatus.Skipped,
    );
  }

  private hasBlockedFailed(
    plan: ExecutionPlan,
    _subtaskMap: Map<string, Subtask>,
  ): boolean {
    // Any failed subtask that blocks other pending tasks
    const failedIds = new Set(
      plan.subtasks
        .filter((s) => s.status === SubtaskStatus.Failed)
        .map((s) => s.subtaskId),
    );

    if (failedIds.size === 0) return false;

    // Check if any pending task depends on a failed task
    return plan.subtasks.some(
      (s) =>
        s.status === SubtaskStatus.Pending &&
        s.dependencies.some((depId) => failedIds.has(depId)),
    );
  }

  private async replan(
    conversationId: string,
    plan: ExecutionPlan,
    members: (GroupMember & { agent: { id: string; name: string } })[],
  ): Promise<ExecutionPlan | null> {
    this.logger.log(`Requesting replan for ${plan.planId}`);
    plan.status = PlanStatus.Replanned;

    const failedInfo = plan.subtasks
      .filter((s) => s.status === SubtaskStatus.Failed)
      .map((s) => `- ${s.title}: ${s.error}`)
      .join('\n');

    return this.generatePlan(
      plan.supervisorAgentId,
      'Supervisor',
      conversationId,
      `以下子任务执行失败，请重新规划:\n${failedInfo}\n\n原始需求: ${plan.userRequest}`,
      members,
    );
  }
}

// ── Helper types ─────────────────────────────────────────────

interface SubTaskInput {
  subtaskId?: string;
  agentId: string;
  agentName?: string;
  title?: string;
  description?: string;
  dependencies?: string[];
}
