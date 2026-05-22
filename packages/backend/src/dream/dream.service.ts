import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { v4 as uuidv4 } from 'uuid';

// ── Types (04-记忆与学习系统设计 §2.1) ───────────────────

interface CandidateItem {
  content: string;
  sourceMessageIds: string[];
  frequency: number;
  sweepId: string;
}

interface DedupStats {
  totalScanned: number;
  duplicatesRemoved: number;
  uniqueCandidates: number;
  sweepId: string;
}

interface PhaseSignal {
  pattern: string;
  relatedCandidateIds: string[];
  boostWeight: number;
  sweepId: string;
}

interface Insight {
  content: string;
  sourceMemoryIds: string[];
  confidence: number;
  sweepId: string;
}

interface CheckpointItem {
  candidateId: string;
  finalScore: number;
  passedThresholds: boolean;
  sweepId: string;
}

interface SixDimensionScores {
  frequency: number;
  relevance: number;
  queryDiversity: number;
  recency: number;
  consolidation: number;
  conceptualRichness: number;
}

interface ThresholdGate {
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
}

// ── Constants (04 §2.2) ──────────────────────────────────

const DEFAULT_THRESHOLD: ThresholdGate = {
  minScore: 0.45,
  minRecallCount: 2,
  minUniqueQueries: 2,
};

const REM_PROMPT = `你是一个记忆模式分析器。分析以下候选记忆，发现其中的隐藏联系和跨领域规律。

## 任务

1. 找出多条记忆中反复出现的模式
2. 提取跨领域的通用洞察
3. 为相关候选记忆生成强化信号

## 输出格式

严格输出 JSON，不要输出其他内容：

\`\`\`json
{
  "insights": [
    {
      "content": "洞察内容",
      "source_memory_ids": ["mem_id_1", "mem_id_2"],
      "confidence": 0.85
    }
  ],
  "phase_signals": [
    {
      "pattern": "模式描述",
      "related_candidate_ids": ["mem_id_1", "mem_id_2"],
      "boost_weight": 0.2
    }
  ]
}
\`\`\`

## 候选记忆列表
{candidate_memories_formatted}`;

// ── Service ───────────────────────────────────────────────

@Injectable()
export class DreamService {
  private readonly logger = new Logger(DreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  // ── Public API ──────────────────────────────────────────

  /**
   * Execute a full dream sweep for an agent (04 §2.1).
   * Order: Light → REM → Deep (fixed sequence, REM signals feed into Deep scoring).
   */
  async executeSweep(agentId: string): Promise<string> {
    const sweepId = uuidv4();

    const sweep = await this.prisma.dreamSweep.create({
      data: {
        agentId,
        sweepId,
        status: 'running',
      },
    });

    this.logger.log(`Dream sweep started: ${sweepId} for agent ${agentId}`);

    try {
      // Phase 1: Light sleep
      const lightState = await this.executeLightSleep(agentId, sweepId);

      // Phase 2: REM sleep
      const remState = await this.executeRemSleep(
        agentId,
        sweepId,
        lightState.candidatePool as CandidateItem[],
      );

      // Phase 3: Deep sleep
      const deepState = await this.executeDeepSleep(
        agentId,
        sweepId,
        lightState.candidatePool as CandidateItem[],
        remState.phaseSignals as PhaseSignal[],
        remState.insights as Insight[],
      );

      // Mark sweep as completed
      await this.prisma.dreamSweep.update({
        where: { id: sweep.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Dream sweep completed: ${sweepId}, promoted ${(deepState.checkpoint as CheckpointItem[]).filter((c) => c.passedThresholds).length} memories`,
      );

      return sweepId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`Dream sweep failed: ${sweepId} — ${msg}`);

      await this.prisma.dreamSweep.update({
        where: { id: sweep.id },
        data: { status: 'failed' },
      });

      throw error;
    }
  }

  /**
   * Recover a crashed sweep by checking which phases completed (04 §2.1.6).
   */
  async recoverSweep(agentId: string): Promise<string | null> {
    const pendingSweep = await this.prisma.dreamSweep.findFirst({
      where: { agentId, status: { not: 'completed' } },
      orderBy: { startedAt: 'desc' },
    });

    if (!pendingSweep) return null;

    const sweepId = pendingSweep.sweepId;
    this.logger.log(`Recovering sweep ${sweepId} for agent ${agentId}`);

    const lightState = await this.prisma.dreamLightState.findFirst({
      where: { agentId, sweepId },
    });

    const remState = await this.prisma.dreamRemState.findFirst({
      where: { agentId, sweepId },
    });

    const deepState = await this.prisma.dreamDeepState.findFirst({
      where: { agentId, sweepId },
    });

    if (deepState) return null;

    try {
      let candidates: CandidateItem[] = [];
      let phaseSignals: PhaseSignal[] = [];
      let insights: Insight[] = [];

      if (!lightState) {
        const light = await this.executeLightSleep(agentId, sweepId);
        candidates = light.candidatePool as CandidateItem[];
      } else {
        candidates = lightState.candidatePool as unknown as CandidateItem[];
      }

      if (!remState) {
        const rem = await this.executeRemSleep(agentId, sweepId, candidates);
        phaseSignals = rem.phaseSignals as PhaseSignal[];
        insights = rem.insights as Insight[];
      } else {
        phaseSignals = remState.phaseSignals as unknown as PhaseSignal[];
        insights = remState.insights as unknown as Insight[];
      }

      await this.executeDeepSleep(agentId, sweepId, candidates, phaseSignals, insights);

      await this.prisma.dreamSweep.update({
        where: { id: pendingSweep.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      this.logger.log(`Sweep ${sweepId} recovered successfully`);
      return sweepId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`Sweep recovery failed: ${sweepId} — ${msg}`);
      return null;
    }
  }

  // ── Phase 1: Light Sleep (04 §2.1.3) ────────────────────

  private async executeLightSleep(
    agentId: string,
    sweepId: string,
  ): Promise<{ id: string; candidatePool: unknown; dedupStats: unknown }> {
    this.logger.debug(`Light sleep starting for agent ${agentId}, sweep ${sweepId}`);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recentMessages = await this.prisma.message.findMany({
      where: {
        agentId,
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        content: true,
        createdAt: true,
      },
    });

    const rawCandidates: CandidateItem[] = [];
    const messageMap = new Map<string, number>();

    for (const msg of recentMessages) {
      const key = msg.content.trim().slice(0, 200);
      const existingIdx = messageMap.get(key);
      if (existingIdx !== undefined) {
        rawCandidates[existingIdx].frequency++;
        rawCandidates[existingIdx].sourceMessageIds.push(msg.id);
      } else {
        const candidate: CandidateItem = {
          content: msg.content.slice(0, 2000),
          sourceMessageIds: [msg.id],
          frequency: 1,
          sweepId,
        };
        rawCandidates.push(candidate);
        messageMap.set(key, rawCandidates.length - 1);
      }
    }

    const uniqueCandidates = await this.deduplicateCandidates(rawCandidates);

    const dedupStats: DedupStats = {
      totalScanned: recentMessages.length,
      duplicatesRemoved: rawCandidates.length - uniqueCandidates.length,
      uniqueCandidates: uniqueCandidates.length,
      sweepId,
    };

    const lightState = await this.prisma.dreamLightState.create({
      data: {
        agentId,
        sweepId,
        candidatePool: uniqueCandidates as unknown as object[],
        dedupStats: dedupStats as unknown as object,
      },
    });

    this.logger.debug(
      `Light sleep completed: ${uniqueCandidates.length} candidates from ${recentMessages.length} messages`,
    );

    return lightState;
  }

  private async deduplicateCandidates(
    candidates: CandidateItem[],
  ): Promise<CandidateItem[]> {
    if (candidates.length <= 1) return candidates;

    const unique: CandidateItem[] = [];

    for (const candidate of candidates) {
      let isDuplicate = false;

      for (const existing of unique) {
        const sim = await this.computeTextSimilarity(
          candidate.content,
          existing.content,
        );
        if (sim > 0.85) {
          existing.frequency += candidate.frequency;
          existing.sourceMessageIds.push(...candidate.sourceMessageIds);
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        unique.push({ ...candidate });
      }
    }

    return unique;
  }

  private async computeTextSimilarity(a: string, b: string): Promise<number> {
    try {
      const [embA, embB] = await Promise.all([
        this.llmService.embedText(a.slice(0, 500)),
        this.llmService.embedText(b.slice(0, 500)),
      ]);
      return this.cosineSimilarity(embA, embB);
    } catch {
      return this.jaccardSimilarity(a, b);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  // ── Phase 2: REM Sleep (04 §2.1.4) ──────────────────────

  private async executeRemSleep(
    agentId: string,
    sweepId: string,
    candidates: CandidateItem[],
  ): Promise<{ id: string; phaseSignals: unknown; insights: unknown }> {
    this.logger.debug(`REM sleep starting for agent ${agentId}, sweep ${sweepId}`);

    if (candidates.length === 0) {
      const remState = await this.prisma.dreamRemState.create({
        data: {
          agentId,
          sweepId,
          phaseSignals: [],
          insights: [],
        },
      });
      return remState;
    }

    const candidatesFormatted = candidates
      .map((c, i) => `${i + 1}. [ID: ${i}] ${c.content.slice(0, 300)} (频次: ${c.frequency})`)
      .join('\n');

    const prompt = REM_PROMPT.replace('{candidate_memories_formatted}', candidatesFormatted);

    const smallModel = await this.llmService.getDefaultModelByRole('small');
    const response = await smallModel.invoke([{ role: 'user', content: prompt }]);
    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const jsonStr = this.extractJson(text);
    let phaseSignals: PhaseSignal[] = [];
    let insights: Insight[] = [];

    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.insights)) {
          insights = parsed.insights
            .filter((i: Record<string, unknown>) => i.content && typeof i.confidence === 'number')
            .map((i: Record<string, unknown>) => ({
              content: String(i.content).slice(0, 2000),
              sourceMemoryIds: Array.isArray(i.source_memory_ids)
                ? i.source_memory_ids.map(String)
                : [],
              confidence: Math.min(Math.max(Number(i.confidence) || 0, 0), 1),
              sweepId,
            }));
        }
        if (Array.isArray(parsed.phase_signals)) {
          phaseSignals = parsed.phase_signals
            .filter((s: Record<string, unknown>) => s.pattern && typeof s.boost_weight === 'number')
            .map((s: Record<string, unknown>) => ({
              pattern: String(s.pattern).slice(0, 500),
              relatedCandidateIds: Array.isArray(s.related_candidate_ids)
                ? s.related_candidate_ids.map(String)
                : [],
              boostWeight: Math.min(Math.max(Number(s.boost_weight) || 0, 0), 0.3),
              sweepId,
            }));
        }
      } catch {
        this.logger.warn('Failed to parse REM output, using empty signals');
      }
    }

    const remState = await this.prisma.dreamRemState.create({
      data: {
        agentId,
        sweepId,
        phaseSignals: phaseSignals as unknown as object[],
        insights: insights as unknown as object[],
      },
    });

    this.logger.debug(
      `REM sleep completed: ${insights.length} insights, ${phaseSignals.length} signals`,
    );

    return remState;
  }

  // ── Phase 3: Deep Sleep (04 §2.1.5) ─────────────────────

  private async executeDeepSleep(
    agentId: string,
    sweepId: string,
    candidates: CandidateItem[],
    phaseSignals: PhaseSignal[],
    _insights: Insight[],
  ): Promise<{ id: string; checkpoint: unknown; promotedCount: number }> {
    this.logger.debug(`Deep sleep starting for agent ${agentId}, sweep ${sweepId}`);

    const checkpoint: CheckpointItem[] = [];
    let promotedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      const rawScores = {
        frequency: candidate.frequency,
        relevance: 0.5,
        uniqueQueries: Math.min(candidate.frequency, 5),
        daysSinceLastMention: 0,
        spanDays: 1,
        conceptTags: 2,
      };

      const scores = this.normalizeScores(rawScores);
      let compositeScore = this.calculateCompositeScore(scores);

      compositeScore = this.applyRemBoost(compositeScore, phaseSignals, String(i));

      const passed = this.passesThreshold(
        compositeScore,
        rawScores.frequency,
        rawScores.uniqueQueries,
      );

      checkpoint.push({
        candidateId: String(i),
        finalScore: Math.round(compositeScore * 10000) / 10000,
        passedThresholds: passed,
        sweepId,
      });

      if (passed) {
        try {
          const embedding = await this.llmService.embedText(
            candidate.content.slice(0, 500),
          );
          const embeddingStr = `[${embedding.join(',')}]`;

          await this.prisma.longTermMemory.create({
            data: {
              agentId,
              content: candidate.content,
              score: compositeScore,
              frequency: rawScores.frequency,
              relevance: rawScores.relevance,
              queryDiversity: rawScores.uniqueQueries / 5,
              recency: scores.recency,
              consolidation: scores.consolidation,
              conceptualRichness: scores.conceptualRichness,
              conceptualTags: { tags: ['auto'], source: 'dream' },
              sourceConversationId: null,
              sourceMessageIds: candidate.sourceMessageIds,
            },
          });

          await this.prisma.$executeRawUnsafe(
            `UPDATE long_term_memories SET embedding = $1::vector WHERE id = (SELECT id FROM long_term_memories WHERE agent_id = $2 ORDER BY created_at DESC LIMIT 1)`,
            embeddingStr,
            agentId,
          );

          promotedCount++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown';
          this.logger.warn(`Failed to promote memory for candidate ${i}: ${msg}`);
        }
      }
    }

    const deepState = await this.prisma.dreamDeepState.create({
      data: {
        agentId,
        sweepId,
        checkpoint: checkpoint as unknown as object[],
        promotedCount,
      },
    });

    this.logger.debug(`Deep sleep completed: ${promotedCount} memories promoted`);

    return deepState;
  }

  // ── Scoring (04 §2.2) ──────────────────────────────────

  private normalizeScores(raw: {
    frequency: number;
    relevance: number;
    uniqueQueries: number;
    daysSinceLastMention: number;
    spanDays: number;
    conceptTags: number;
  }): SixDimensionScores {
    return {
      frequency: Math.min(raw.frequency / 10, 1.0),
      relevance: raw.relevance,
      queryDiversity: Math.min(raw.uniqueQueries / 5, 1.0),
      recency: Math.exp(-0.1 * raw.daysSinceLastMention),
      consolidation: Math.min(raw.spanDays / 14, 1.0),
      conceptualRichness: Math.min(raw.conceptTags / 8, 1.0),
    };
  }

  private calculateCompositeScore(scores: SixDimensionScores): number {
    return (
      scores.frequency * 0.24 +
      scores.relevance * 0.30 +
      scores.queryDiversity * 0.15 +
      scores.recency * 0.15 +
      scores.consolidation * 0.10 +
      scores.conceptualRichness * 0.06
    );
  }

  private applyRemBoost(
    score: number,
    phaseSignals: PhaseSignal[],
    candidateId: string,
  ): number {
    const matchedSignal = phaseSignals.find((signal) =>
      signal.relatedCandidateIds.includes(candidateId),
    );
    if (!matchedSignal) return score;
    const boostWeight = Math.min(matchedSignal.boostWeight, 0.3);
    return score * (1 + boostWeight);
  }

  private passesThreshold(
    finalScore: number,
    rawFrequency: number,
    rawUniqueQueries: number,
    threshold: ThresholdGate = DEFAULT_THRESHOLD,
  ): boolean {
    return (
      finalScore >= threshold.minScore &&
      rawFrequency >= threshold.minRecallCount &&
      rawUniqueQueries >= threshold.minUniqueQueries
    );
  }

  // ── Helpers ─────────────────────────────────────────────

  private extractJson(text: string): string | null {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return null;
  }
}
