import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

// ── Types (04-记忆与学习系统设计 §1.3) ───────────────────

interface MergeOperation {
  type: 'merge';
  sourceCardIds: string[];
  mergedCard: {
    goal?: string;
    toolsUsed?: string[];
    result?: 'success' | 'failure';
    lesson?: string;
    score?: number;
  };
}

// ── Reflector Prompt (04 §1.3.2) ─────────────────────────

const REFLECTOR_MERGE_PROMPT = `你是一个经验教训提炼器。请将以下多条相关的经验教训合并为一条精炼的教训。

## 规则
1. 综合各条教训，提炼出更高阶、更通用的经验
2. 保留关键的具体细节（如工具名、错误类型）
3. 用 2-3 句话表达
4. 只输出合并后的教训文本，不要输出其他内容

## 原始教训
{lessons}

## 合并后的教训`;

// ── Service ───────────────────────────────────────────────

@Injectable()
export class AceReflectorService {
  private readonly logger = new Logger(AceReflectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Run Reflector for a specific agent (04 §1.3).
   * Triggered by time (3am) or count threshold (10 rounds).
   */
  async reflect(agentId: string): Promise<{ merged: number; deleted: number }> {
    this.logger.log(`Reflector starting for agent ${agentId}`);

    // 1. Query all active strategy cards for this agent
    const cards = await this.prisma.strategyCard.findMany({
      where: { agentId, status: 'active' },
      orderBy: { score: 'desc' },
    });

    if (cards.length === 0) {
      this.logger.log(`No active cards for agent ${agentId}, skipping`);
      return { merged: 0, deleted: 0 };
    }

    // 2. Find similar card pairs for merging
    const mergeOps = await this.findMergeCandidates(cards);

    // 3. Execute merges
    let mergedCount = 0;
    const mergedIds = new Set<string>();
    for (const op of mergeOps) {
      try {
        if (op.sourceCardIds.some((id) => mergedIds.has(id))) continue;
        await this.executeMerge(op);
        op.sourceCardIds.forEach((id) => mergedIds.add(id));
        mergedCount++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.warn(`Merge failed for agent ${agentId}: ${msg}`);
      }
    }

    // 4. Execute deletions
    const deletedCount = await this.executeDeletion(agentId);

    this.logger.log(
      `Reflector done for agent ${agentId}: merged=${mergedCount}, deleted=${deletedCount}`,
    );
    return { merged: mergedCount, deleted: deletedCount };
  }

  /**
   * Find candidate card pairs with cosine similarity > 0.85 (04 §1.3.2).
   */
  private async findMergeCandidates(
    cards: Array<{
      id: string;
      goal: string;
      toolsUsed: string[];
      result: string;
      lesson: string;
      score: unknown;
      sourceConversationId: string | null;
      sourceMessageIds: string[];
      agentId: string;
      scope: string;
    }>,
  ): Promise<MergeOperation[]> {
    const operations: MergeOperation[] = [];
    const paired = new Set<string>();

    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const pairKey = `${cards[i].id}:${cards[j].id}`;
        if (paired.has(pairKey)) continue;
        paired.add(pairKey);

        const similar = await this.checkSimilarity(cards[i].id, cards[j].id);
        if (similar) {
          operations.push({
            type: 'merge',
            sourceCardIds: [cards[i].id, cards[j].id],
            mergedCard: {},
          });
        }
      }
    }

    return operations;
  }

  /**
   * Check vector cosine similarity between two cards via pgvector (04 §1.3.2).
   */
  private async checkSimilarity(
    cardId1: string,
    cardId2: string,
  ): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ similarity: number }>
      >(
        `SELECT 1 - (a.embedding <=> b.embedding) AS similarity
         FROM strategy_cards a, strategy_cards b
         WHERE a.id = $1 AND b.id = $2
           AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL`,
        cardId1,
        cardId2,
      );
      if (rows.length === 0) return false;
      return Number(rows[0].similarity) > 0.85;
    } catch {
      // Fallback: no embedding available, skip merge
      return false;
    }
  }

  /**
   * Execute a card merge (04 §1.3.2).
   */
  private async executeMerge(operation: MergeOperation): Promise<void> {
    const sourceCards = await this.prisma.strategyCard.findMany({
      where: { id: { in: operation.sourceCardIds } },
    });

    if (sourceCards.length < 2) return;

    // ── Merge fields per rules ──
    // scope: take wider range
    const scopeOrder: Record<string, number> = { personal: 1, group: 2, global: 3 };
    const mergedScope = sourceCards.reduce((best, c) =>
      (scopeOrder[c.scope] ?? 1) > (scopeOrder[best] ?? 1) ? c.scope : best,
      'personal' as string);

    // toolsUsed: union
    const mergedTools = [...new Set(sourceCards.flatMap((c) => c.toolsUsed))];

    // result: failure takes priority
    const mergedResult = sourceCards.some((c) => c.result === 'failure')
      ? 'failure'
      : 'success';

    // score: max + 0.05, capped at 1.0
    const rawScores = sourceCards.map((c) => Number(c.score) || 0);
    const mergedScore = Math.min(Math.max(...rawScores) + 0.05, 1.0);

    // sourceMessageIds: union
    const mergedMessageIds = [
      ...new Set(sourceCards.flatMap((c) => c.sourceMessageIds)),
    ];

    // sourceConversationId: earliest
    const earliestConv = sourceCards
      .map((c) => c.sourceConversationId)
      .filter(Boolean)
      .sort()[0] ?? null;

    // lesson: LLM refinement
    const mergedLesson = await this.refineLesson(
      sourceCards.map((c) => `${c.goal} → ${c.lesson}`),
    );

    // Create merged card
    const newCard = await this.prisma.strategyCard.create({
      data: {
        agentId: sourceCards[0].agentId,
        scope: mergedScope as 'personal' | 'group' | 'global',
        goal: operation.mergedCard.goal ?? sourceCards[0].goal,
        toolsUsed: mergedTools,
        result: mergedResult as 'success' | 'failure',
        lesson: mergedLesson,
        score: mergedScore,
        sourceConversationId: earliestConv,
        sourceMessageIds: mergedMessageIds,
        status: 'active',
      },
    });

    // Archive source cards
    await this.prisma.strategyCard.updateMany({
      where: { id: { in: operation.sourceCardIds } },
      data: { status: 'archived' },
    });

    // Generate embedding for merged card
    await this.generateEmbedding(
      newCard.id, newCard.goal, mergedTools, mergedResult, mergedLesson,
    ).catch((err) => this.logger.warn(`Embedding failed for merged card ${newCard.id}: ${err}`));

    this.logger.log(`Merged ${operation.sourceCardIds.length} cards → ${newCard.id}`);
  }

  /**
   * Use small LLM to refine merged lesson text (04 §1.3.2).
   */
  private async refineLesson(lessons: string[]): Promise<string> {
    try {
      const prompt = REFLECTOR_MERGE_PROMPT.replace(
        '{lessons}',
        lessons.map((l, i) => `${i + 1}. ${l}`).join('\n'),
      );
      const smallModel = await this.llmService.getDefaultModelByRole('small');
      const response = await smallModel.invoke([{ role: 'user', content: prompt }]);
      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      return text.trim().slice(0, 2000);
    } catch {
      return lessons[0] ?? '综合经验教训';
    }
  }

  /**
   * Check count threshold: has the agent accumulated 10+ rounds? (04 §1.3.1)
   */
  async checkCountThreshold(agentId: string, threshold = 10): Promise<boolean> {
    const count = await this.prisma.strategyCard.count({
      where: { agentId, status: 'active' },
    });
    return count >= threshold;
  }

  /**
   * Execute deletion of stale/obsolete cards (04 §1.3.3).
   */
  private async executeDeletion(agentId: string): Promise<number> {
    let deletedCount = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Rule 1: score < 0.2 and not retrieved recently
    const staleCards = await this.prisma.strategyCard.findMany({
      where: {
        agentId,
        status: 'active',
        updatedAt: { lt: thirtyDaysAgo },
        score: { lt: 0.2 },
      },
    });

    for (const card of staleCards) {
      await this.prisma.strategyCard.update({
        where: { id: card.id },
        data: { status: 'deleted' },
      });
      deletedCount++;
    }

    // Rule 2: tools no longer exist in system
    const currentToolNames = new Set([
      'read_file', 'list_files', 'write_file',
      'execute_command', 'code_execute', 'web_search', 'web_fetch',
    ]);

    const allActiveCards = await this.prisma.strategyCard.findMany({
      where: { agentId, status: 'active' },
    });

    for (const card of allActiveCards) {
      const hasObsoleteTool = card.toolsUsed.some(
        (tool) => !currentToolNames.has(tool),
      );
      if (hasObsoleteTool) {
        await this.prisma.strategyCard.update({
          where: { id: card.id },
          data: { status: 'deleted' },
        });
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Generate pgvector embedding for a card.
   */
  private async generateEmbedding(
    cardId: string,
    goal: string,
    toolsUsed: string[],
    result: string,
    lesson: string,
  ): Promise<void> {
    const combinedText = [
      '[目标]', goal,
      '[工具]', toolsUsed.join(','),
      '[结果]', result,
      '[教训]', lesson,
    ].join(' ');

    const embedding = await this.llmService.embedText(combinedText);
    const embeddingStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE strategy_cards SET embedding = $1::vector WHERE id = $2`,
      embeddingStr,
      cardId,
    );
  }
}
