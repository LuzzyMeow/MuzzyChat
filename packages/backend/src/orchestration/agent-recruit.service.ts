import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

// ── Types (溯源: 02-群聊与交互设计.md §5) ──────────────────

export interface ParsedAgent {
  name: string;
  avatarStyle: string;
  profession: string;
  personality: string;
  background: string;
  scenario: string;
}

export interface RecruitResult {
  groupName: string;
  agents: ParsedAgent[];
}

/**
 * 一句话招募服务 (02-群聊与交互设计.md §五)
 *
 * 用小模型将自然语言描述解析为结构化 Agent 配置，
 * 支持创建新群组和已有群组追加 Agent 两种场景。
 */
@Injectable()
export class AgentRecruitService {
  private readonly logger = new Logger(AgentRecruitService.name);

  /** Max retries (02-群聊设计 §5.2) */
  private static readonly MAX_RETRIES = 2;

  /** Max agents (02-群聊设计 §5.1) */
  private static readonly MAX_AGENTS = 10;

  /** Min agents (02-群聊设计 §5.3.1) */
  private static readonly MIN_AGENTS = 1;

  // ── System Prompt (02-群聊设计 §5.1) ──────────────────────

  private static readonly SYSTEM_PROMPT = [
    '你是一个 AI Agent 团队配置解析器。用户会用一句话描述他们想要的 AI 团队，你需要将其解析为结构化的 Agent 配置列表。',
    '',
    '## 输出格式',
    '',
    '请严格输出以下 JSON 格式，不要输出任何其他内容：',
    '',
    '```json',
    '{',
    '  "group_name": "群组名称",',
    '  "agents": [',
    '    {',
    '      "name": "Agent 名称（2-8 个字符）",',
    '      "avatar_style": "头像风格描述（如：蓝色猫耳、绿色机器人、红色书本等）",',
    '      "profession": "职业/角色定位",',
    '      "personality": "性格特征（2-4 个关键词）",',
    '      "background": "背景故事（1-2 句话）",',
    '      "scenario": "典型应用场景描述"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '## 规则',
    '',
    '1. 根据用户描述，生成 1-10 个 Agent。如果用户描述暗示需要更多 Agent，最多生成 10 个。',
    '2. 每个 Agent 必须有明确的职责分工，避免角色重叠。',
    '3. name 必须简洁且能体现角色特征，不能为空。',
    '4. profession 应使用常见职业名称，如"研究员"、"分析师"、"撰稿人"等。',
    '5. personality 使用 2-4 个形容词关键词，如"严谨、细致、耐心"。',
    '6. background 提供简短的角色背景，增强角色辨识度。',
    '7. scenario 描述该 Agent 最适合处理什么类型的任务。',
    '8. group_name 应概括整个团队的主题或目标。',
  ].join('\n');

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * 解析自然语言描述, 返回结构化 Agent 配置 (02-群聊设计 §5.2)
   */
  async parse(input: string): Promise<RecruitResult | null> {
    // 使用小模型 (02-群聊设计 §5.2)
    const model = await this.llmService.getDefaultModelByRole('small');

    let lastError = '';

    for (let attempt = 0; attempt < AgentRecruitService.MAX_RETRIES; attempt++) {
      try {
        const prompt =
          attempt === 0
            ? `${AgentRecruitService.SYSTEM_PROMPT}\n\n用户输入："${input}"`
            : `${AgentRecruitService.SYSTEM_PROMPT}\n\n上次输出格式不正确，请确保输出合法 JSON，包含 group_name 和 agents 数组，每个 agent 包含 name、avatar_style、profession、personality、background、scenario 六个字段。\n\n用户输入："${input}"`;

        const response = await model.invoke(prompt);
        const content =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        // 提取 JSON (02-群聊设计 §5.3.1)
        const jsonMatch = content.match(/\{[\s\S]*?"agents"[\s\S]*?\}/);
        if (!jsonMatch) {
          lastError = '无法从响应中提取 JSON';
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Schema 验证 (02-群聊设计 §5.3.1)
        const validated = this.validateRecruitResult(parsed);
        if (validated) {
          return validated;
        }

        lastError = 'Schema 验证失败';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown';
        this.logger.warn(`Recruit attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    this.logger.warn(`Recruit parsing failed after ${AgentRecruitService.MAX_RETRIES} retries: ${lastError}`);
    return null;
  }

  /**
   * 批量创建 Agent 并加入群组
   */
  async createAgentsForGroup(
    groupId: string,
    agents: ParsedAgent[],
  ): Promise<{ agentId: string; name: string }[]> {
    const created: { agentId: string; name: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const agent of agents) {
        // 构建 system prompt
        const systemPrompt = [
          `你是 ${agent.name}，一名 ${agent.profession}。`,
          `性格特征：${agent.personality}。`,
          `背景：${agent.background}`,
          `擅长场景：${agent.scenario}`,
        ].join('\n');

        // 创建 Agent
        const createdAgent = await tx.agent.create({
          data: {
            name: agent.name,
            avatarDescription: agent.avatarStyle,
            systemPrompt,
            tools: ['web_search', 'web_fetch'], // 默认工具
          },
        });

        // 加入群组
        await tx.groupMember.create({
          data: {
            groupId,
            agentId: createdAgent.id,
          },
        });

        created.push({ agentId: createdAgent.id, name: agent.name });
        this.logger.log(`Created agent ${agent.name} (${createdAgent.id}) for group ${groupId}`);
      }
    });

    return created;
  }

  // ── Private: Validation (02-群聊设计 §5.3.1) ───────────────

  private validateRecruitResult(raw: unknown): RecruitResult | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const obj = raw as Record<string, unknown>;
    const groupName =
      typeof obj.group_name === 'string' ? obj.group_name : 'AI 团队';
    const agents = obj.agents;

    if (!Array.isArray(agents)) return null;

    const parsedAgents = agents
      .map((a): ParsedAgent | null => {
        if (typeof a !== 'object' || a === null) return null;
        const agent = a as Record<string, unknown>;

        const name = typeof agent.name === 'string' ? agent.name.trim() : '';
        if (!name || name.length < 2 || name.length > 8) return null;

        const avatarStyle =
          typeof agent.avatar_style === 'string' ? agent.avatar_style : 'AI 助手';
        const profession =
          typeof agent.profession === 'string' ? agent.profession : '';
        if (!profession) return null;

        const personality =
          typeof agent.personality === 'string' ? agent.personality : '';
        if (!personality) return null;

        const background =
          typeof agent.background === 'string' ? agent.background : '';
        const scenario =
          typeof agent.scenario === 'string' ? agent.scenario : '';

        return {
          name,
          avatarStyle,
          profession,
          personality,
          background,
          scenario,
        };
      })
      .filter((a): a is ParsedAgent => a !== null);

    // Agent 数量校验 (02-群聊设计 §5.3.1)
    if (
      parsedAgents.length < AgentRecruitService.MIN_AGENTS ||
      parsedAgents.length > AgentRecruitService.MAX_AGENTS
    ) {
      return null;
    }

    return { groupName, agents: parsedAgents };
  }
}
