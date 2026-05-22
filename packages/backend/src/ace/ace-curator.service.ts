import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── Types (04-记忆与学习系统设计 §1.4) ───────────────────

type StrategyScope = 'personal' | 'group' | 'global';

interface StrategyCard {
  id: string;
  agentId: string;
  scope: StrategyScope;
  goal: string;
  toolsUsed: string[];
  result: 'success' | 'failure';
  lesson: string;
  score: unknown;
  sourceConversationId: string | null;
  sourceMessageIds: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Service ───────────────────────────────────────────────

@Injectable()
export class AceCuratorService {
  private readonly logger = new Logger(AceCuratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run Curator after Reflector completes: auto-set scope for all personal cards (04 §1.4).
   */
  async curate(agentId: string): Promise<number> {
    this.logger.log(`Curator starting for agent ${agentId}`);

    const cards = await this.prisma.strategyCard.findMany({
      where: { agentId, status: 'active', scope: 'personal' },
    });

    let curatedCount = 0;
    for (const card of cards) {
      try {
        const newScope = await this.autoSetScope(card as unknown as StrategyCard);
        if (newScope !== card.scope) {
          await this.prisma.strategyCard.update({
            where: { id: card.id },
            data: { scope: newScope },
          });
          curatedCount++;
          this.logger.debug(`Card ${card.id} scope: personal → ${newScope}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.warn(`Curator scope assessment failed for card ${card.id}: ${msg}`);
      }
    }

    this.logger.log(`Curator done for agent ${agentId}: ${curatedCount} scopes updated`);
    return curatedCount;
  }

  /**
   * Auto-set scope based on 5 priority rules (04 §1.4.1).
   */
  private async autoSetScope(card: StrategyCard): Promise<StrategyScope> {
    // Rule 1: failure with tools → personal
    if (card.result === 'failure' && card.toolsUsed.length > 0) {
      return 'personal';
    }

    // Rule 2: lesson contains user preference keywords → group
    const preferenceKeywords = ['用户喜欢', '用户不喜欢', '用户偏好', '用户习惯'];
    if (preferenceKeywords.some((kw) => card.lesson.includes(kw))) {
      return 'group';
    }

    // Rule 3: similar to ≥ 2 other agents' cards → global
    try {
      const similarCards = await this.findSimilarCards(card.id, 0.8);
      const otherAgentCards = similarCards.filter(
        (c) => c.agentId !== card.agentId,
      );
      if (otherAgentCards.length >= 2) {
        return 'global';
      }
    } catch {
      // pgvector might not be available — skip this rule
    }

    // Rule 4: success with tools → group
    if (card.toolsUsed.length > 0 && card.result === 'success') {
      return 'group';
    }

    // Rule 5: contains principle keywords → global
    const principleKeywords = ['始终', '永远', '原则', '规则', '务必', '必须'];
    if (principleKeywords.some((kw) => card.lesson.includes(kw))) {
      return 'global';
    }

    return 'personal';
  }

  /**
   * Find cards with vector similarity > threshold (pgvector).
   */
  private async findSimilarCards(
    cardId: string,
    threshold: number,
  ): Promise<Array<{ agentId: string }>> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ agent_id: string; similarity: number }>
      >(
        `SELECT b.agent_id, 1 - (a.embedding <=> b.embedding) AS similarity
         FROM strategy_cards a, strategy_cards b
         WHERE a.id = $1 AND b.id != $1
           AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
           AND b.status = 'active'
           AND 1 - (a.embedding <=> b.embedding) > $2
         LIMIT 10`,
        cardId,
        threshold,
      );
      return rows.map((r) => ({ agentId: r.agent_id }));
    } catch {
      return [];
    }
  }
}
