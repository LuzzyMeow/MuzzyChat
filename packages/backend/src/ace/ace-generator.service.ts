import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

// ── Types (04-记忆与学习系统设计 §1.2.2) ───────────────────

export interface InteractionMessage {
  messageId: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: Date;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: 'success' | 'failure';
  output: string;
}

export interface AgentInteraction {
  agentId: string;
  conversationId: string;
  messages: InteractionMessage[];
  toolCalls: ToolCallRecord[];
  startTime: Date;
  endTime: Date;
}

// ── Generator Prompt (04 §1.2.3) ──────────────────────────

const GENERATOR_PROMPT = `你是一个策略卡片生成器。根据以下 Agent 交互记录，生成一条结构化的策略卡片。

## 规则

1. 仅在交互包含有价值的经验教训时生成卡片。如果交互平淡无奇（如简单问答），输出 null。
2. 每次最多生成 1 条卡片。
3. goal 字段：简洁描述本次任务目标（1-2 句话）。
4. tools_used 字段：列出本次使用的工具名称。
5. result 字段：根据交互结果判定 success 或 failure。
6. lesson 字段：提炼经验教训。成功时说明什么做法是对的，失败时说明原因和规避策略。
7. score 字段：初始评分，范围 0.0-1.0，基于经验的新颖性和通用性。

## 输出格式

严格输出 JSON，不要输出其他内容：

\`\`\`json
{
  "goal": "任务目标描述",
  "tools_used": ["tool_name_1", "tool_name_2"],
  "result": "success 或 failure",
  "lesson": "经验教训描述",
  "score": 0.7
}
\`\`\`

如果交互无有价值经验，输出：

\`\`\`json
null
\`\`\`

## Agent 交互记录

Agent ID: {agent_id}
对话 ID: {conversation_id}

### 消息序列
{messages_formatted}

### 工具调用记录
{tool_calls_formatted}`;

// ── Service ───────────────────────────────────────────────

@Injectable()
export class AceGeneratorService {
  private readonly logger = new Logger(AceGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Process agent interactions after a round completes (04 §1.2.1).
   * Groups by agent_id, merges within 30s window, generates strategy cards.
   */
  async onRoundComplete(interactions: AgentInteraction[]): Promise<void> {
    const grouped = this.aggregateInteractions(interactions);

    for (const [agentId, agentInteractions] of grouped) {
      for (const interaction of agentInteractions) {
        try {
          await this.generateCard(agentId, interaction);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown';
          this.logger.error(
            `Generator failed for agent ${agentId}: ${msg}`,
          );
        }
      }
    }
  }

  /**
   * Aggregate interactions by agent, merging within 30s window (04 §1.2.2).
   */
  private aggregateInteractions(
    interactions: AgentInteraction[],
    mergeWindowMs = 30_000,
  ): Map<string, AgentInteraction[]> {
    const grouped = new Map<string, AgentInteraction[]>();

    for (const interaction of interactions) {
      const existing = grouped.get(interaction.agentId) ?? [];

      if (existing.length > 0) {
        const last = existing[existing.length - 1];
        const gap =
          interaction.startTime.getTime() - last.endTime.getTime();
        if (gap < mergeWindowMs) {
          last.messages.push(...interaction.messages);
          last.toolCalls.push(...interaction.toolCalls);
          last.endTime = interaction.endTime;
          continue;
        }
      }

      existing.push({ ...interaction });
      grouped.set(interaction.agentId, existing);
    }

    return grouped;
  }

  /**
   * Generate a strategy card from an agent interaction (04 §1.2.3).
   */
  private async generateCard(
    agentId: string,
    interaction: AgentInteraction,
  ): Promise<void> {
    // Build formatted messages
    const messagesFormatted = interaction.messages
      .map((m) => `[${m.role}] ${m.content.slice(0, 500)}`)
      .join('\n');

    const toolCallsFormatted =
      interaction.toolCalls.length === 0
        ? '(无工具调用)'
        : interaction.toolCalls
            .map(
              (tc) =>
                `- ${tc.toolName}: [${tc.result}] ${tc.output.slice(0, 200)}`,
            )
            .join('\n');

    // Build prompt
    const prompt = GENERATOR_PROMPT.replace('{agent_id}', agentId)
      .replace('{conversation_id}', interaction.conversationId)
      .replace('{messages_formatted}', messagesFormatted)
      .replace('{tool_calls_formatted}', toolCallsFormatted);

    // Call small model
    const smallModel = await this.llmService.getDefaultModelByRole('small');
    const response = await smallModel.invoke([{ role: 'user', content: prompt }]);
    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON from response
    const jsonStr = this.extractJson(text);
    if (!jsonStr) {
      this.logger.debug(`No JSON found in Generator response for agent ${agentId}`);
      return;
    }

    const parsed = JSON.parse(jsonStr);
    if (parsed === null || parsed.goal === undefined) {
      this.logger.debug(`Generator returned null for agent ${agentId}`);
      return;
    }

    // Validate fields
    if (!parsed.goal || !parsed.lesson) {
      this.logger.warn(`Generator output missing goal/lesson for agent ${agentId}`);
      return;
    }

    const result: 'success' | 'failure' =
      parsed.result === 'failure' ? 'failure' : 'success';
    const score = Math.min(Math.max(Number(parsed.score) || 0.5, 0), 1);

    // Write strategy card to DB
    const card = await this.prisma.strategyCard.create({
      data: {
        agentId,
        scope: 'personal', // Generator defaults to personal; Curator adjusts later
        goal: parsed.goal.slice(0, 2000),
        toolsUsed: Array.isArray(parsed.tools_used) ? parsed.tools_used : [],
        result,
        lesson: parsed.lesson.slice(0, 5000),
        score,
        sourceConversationId: interaction.conversationId,
        sourceMessageIds: interaction.messages.map((m) => m.messageId),
        status: 'active',
      },
    });

    // Async: generate embedding
    this.generateEmbedding(card.id, card.goal, card.toolsUsed, card.result, card.lesson).catch(
      (err) =>
        this.logger.warn(`Embedding generation failed for card ${card.id}: ${err}`),
    );

    this.logger.log(
      `Strategy card generated: ${card.id} for agent ${agentId} (${result}, score=${score})`,
    );
  }

  /**
   * Generate pgvector embedding for a strategy card (04 §1.1.2).
   */
  private async generateEmbedding(
    cardId: string,
    goal: string,
    toolsUsed: string[],
    result: string,
    lesson: string,
  ): Promise<void> {
    try {
      const combinedText = [
        '[目标]',
        goal,
        '[工具]',
        toolsUsed.join(','),
        '[结果]',
        result,
        '[教训]',
        lesson,
      ].join(' ');

      const embedding = await this.llmService.embedText(combinedText);

      // Write embedding via raw SQL (pgvector-specific)
      const embeddingStr = `[${embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE strategy_cards SET embedding = $1::vector WHERE id = $2`,
        embeddingStr,
        cardId,
      );

      this.logger.debug(`Embedding generated for card ${cardId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.warn(`Embedding generation failed for card ${cardId}: ${msg}`);
    }
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks).
   */
  private extractJson(text: string): string | null {
    // Try to extract from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    // Try to find JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    // Check for null
    if (text.trim() === 'null') {
      return 'null';
    }
    return null;
  }
}
