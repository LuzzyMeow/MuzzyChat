import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

// ── Types (04-记忆与学习系统设计 §1.5) ───────────────────

export interface RetrievedCard {
  id: string;
  agentId: string;
  scope: string;
  goal: string;
  toolsUsed: string[];
  result: string;
  lesson: string;
  score: number;
  similarity: number;
}

// ── Service ───────────────────────────────────────────────

@Injectable()
export class AceRetrievalService {
  private readonly logger = new Logger(AceRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Retrieve top-K strategy cards for an agent during dialogue (04 §1.5.2).
   * Scope hierarchy: personal (agent's own) + group (same group agents) + global.
   */
  async retrieve(
    agentId: string,
    groupAgentIds: string[],
    queryText: string,
    topK = 5,
  ): Promise<RetrievedCard[]> {
    try {
      const queryEmbedding = await this.llmService.embedText(queryText);
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      // Personal scope: only this agent's cards
      const personalCards = await this.queryCards(
        `agent_id = $1 AND scope = 'personal' AND status = 'active' AND embedding IS NOT NULL`,
        [agentId],
        embeddingStr,
        topK,
      );

      // Group scope: cards from group members
      let groupCards: RetrievedCard[] = [];
      if (groupAgentIds.length > 0) {
        const placeholders = groupAgentIds.map((_, i) => `$${i + 1}`).join(',');
        groupCards = await this.queryCards(
          `agent_id IN (${placeholders}) AND scope = 'group' AND status = 'active' AND embedding IS NOT NULL`,
          groupAgentIds,
          embeddingStr,
          topK,
        );
      }

      // Global scope: all agents
      const globalCards = await this.queryCards(
        `scope = 'global' AND status = 'active' AND embedding IS NOT NULL`,
        [],
        embeddingStr,
        topK,
      );

      // Merge, sort by similarity, take top-K
      const allCards = [...personalCards, ...groupCards, ...globalCards]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      if (allCards.length > 0) {
        // Update last_retrieved_at for retrieved cards
        const cardIds = allCards.map((c) => c.id);
        await this.prisma.strategyCard.updateMany({
          where: { id: { in: cardIds } },
          data: { lastRetrievedAt: new Date() },
        });
      }

      return allCards;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.warn(`Strategy card retrieval failed: ${msg}`);
      return [];
    }
  }

  /**
   * Format retrieved cards for injection into Agent system prompt (04 §1.5.4).
   */
  formatForContext(cards: RetrievedCard[]): string {
    if (cards.length === 0) return '';

    const lines = ['## 相关历史经验（策略卡片）', ''];
    for (const card of cards) {
      const resultIcon = card.result === 'success' ? '✅' : '❌';
      lines.push(
        `- ${resultIcon} [${card.scope}] **${card.goal}**\n  ${card.lesson}\n  _评分: ${card.score.toFixed(2)} | 工具: ${card.toolsUsed.join(', ') || '无'}_`,
      );
    }
    return lines.join('\n');
  }

  // ── Helpers ─────────────────────────────────────────────

  private async queryCards(
    whereClause: string,
    params: string[],
    embeddingStr: string,
    limit: number,
  ): Promise<RetrievedCard[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          agent_id: string;
          scope: string;
          goal: string;
          tools_used: string[];
          result: string;
          lesson: string;
          score: number;
          similarity: number;
        }>
      >(
        `SELECT id, agent_id, scope, goal, tools_used, result, lesson,
                score, 1 - (embedding <=> $${params.length + 1}::vector) AS similarity
         FROM strategy_cards
         WHERE ${whereClause}
         ORDER BY embedding <=> $${params.length + 1}::vector
         LIMIT $${params.length + 2}`,
        ...params,
        embeddingStr,
        limit,
      );

      return rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        scope: r.scope,
        goal: r.goal,
        toolsUsed: r.tools_used,
        result: r.result,
        lesson: r.lesson,
        score: Number(r.score),
        similarity: Number(r.similarity),
      }));
    } catch {
      return [];
    }
  }
}
