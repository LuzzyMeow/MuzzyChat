import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';

// ── Types (溯源: 02-群聊与交互设计.md §3) ──────────────────

interface LoopCheckResult {
  needsConfirmation: boolean;
}

interface ConfirmResult {
  isLoop: boolean;
  confidence: number;
  reason: string;
}

/**
 * 观点循环检测器 (02-群聊与交互设计.md §三)
 *
 * 采用启发式初筛 + 低频 LLM 确认的混合策略:
 * 1. TF-IDF + Jaccard 相似度初筛 (零 LLM 调用)
 * 2. 初筛通过后用小模型确认
 * 仅在动态讨论模式下触发。
 */
@Injectable()
export class LoopDetector {
  private readonly logger = new Logger(LoopDetector.name);

  constructor(private readonly llmService: LlmService) {}

  // ── Constants (02-群聊设计 §3.2.3, §3.4, §3.3.2) ─────────

  /** Jaccard 相似度阈值 (02-群聊设计 §3.2.3) */
  private static readonly JACCARD_THRESHOLD = 0.7;

  /** 新关键词最小数量 (02-群聊设计 §3.2.3) */
  private static readonly MIN_NEW_KEYWORDS = 2;

  /** 连续最少轮次 (02-群聊设计 §3.2.3) */
  private static readonly MIN_CONSECUTIVE_ROUNDS = 3;

  /** LLM 确认置信度阈值 (02-群聊设计 §3.3.2) */
  private static readonly LLM_CONFIDENCE_THRESHOLD = 0.7;

  /** TF-IDF 滑动窗口大小 (02-群聊设计 §3.4) */
  private static readonly WINDOW_SIZE = 100;

  /** Top N 关键词 (02-群聊设计 §3.2.1) */
  private static readonly TOP_N_KEYWORDS = 20;

  // ── Public API ──────────────────────────────────────────────

  /**
   * 启发式初筛 (02-群聊设计 §3.2)
   * 返回是否需要 LLM 确认
   */
  check(
    messages: string[],
    dynamicRoundCount: number,
  ): LoopCheckResult {
    // 连续轮次不够 (02-群聊设计 §3.2.3)
    if (dynamicRoundCount < LoopDetector.MIN_CONSECUTIVE_ROUNDS) {
      return { needsConfirmation: false };
    }

    // 取最近 3 轮的消息
    // 简化: 将消息列表按轮次分组 (每条消息代表一轮)
    const relevantMessages = messages.slice(-LoopDetector.WINDOW_SIZE);

    if (relevantMessages.length < LoopDetector.MIN_CONSECUTIVE_ROUNDS) {
      return { needsConfirmation: false };
    }

    // 取最近 3 轮的关键词集合
    const lastThree = this.splitIntoRounds(
      relevantMessages,
      LoopDetector.MIN_CONSECUTIVE_ROUNDS,
    );

    if (lastThree.length < LoopDetector.MIN_CONSECUTIVE_ROUNDS) {
      return { needsConfirmation: false };
    }

    const keywordSets = lastThree.map((round) => {
      const keywords = this.extractTopKeywords(round);
      return new Set(keywords.map((k) => k.term));
    });

    // Jaccard 相似度计算 (02-群聊设计 §3.2.2)
    const sim01 = this.jaccardSimilarity(keywordSets[0], keywordSets[1]);
    const sim12 = this.jaccardSimilarity(keywordSets[1], keywordSets[2]);

    // 新关键词统计 (02-群聊设计 §3.2.2)
    const newKeywords = [...keywordSets[2]].filter(
      (kw) => !keywordSets[0].has(kw) && !keywordSets[1].has(kw),
    );

    const needsConfirmation =
      sim01 > LoopDetector.JACCARD_THRESHOLD &&
      sim12 > LoopDetector.JACCARD_THRESHOLD &&
      newKeywords.length < LoopDetector.MIN_NEW_KEYWORDS;

    if (needsConfirmation) {
      this.logger.log(
        `Heuristic passed for loop detection (sim: ${sim01.toFixed(2)}/${sim12.toFixed(2)}, new: ${newKeywords.length})`,
      );
    }

    return { needsConfirmation };
  }

  /**
   * LLM 确认 (02-群聊设计 §3.3)
   * 用小模型判断是否存在"无新信息增量的循环反驳"
   */
  async confirmViaLLM(roundMessages: string[]): Promise<boolean> {
    // 取最近 3 轮的消息用于分析
    const separated = this.splitIntoRounds(roundMessages, 3);
    if (separated.length < 3) return false;

    // 构建确认 Prompt (02-群聊设计 §3.3.1)
    const prompt = [
      '你是一个讨论循环检测器。请分析以下连续 3 轮讨论内容，判断是否存在"无新信息增量的循环反驳"。',
      '',
      '判定标准：',
      '- 参与者是否在重复相同观点而未提供新的论据、数据或角度',
      '- 讨论是否陷入"你说 A 我说 B"的反复拉锯，且双方均无新内容',
      '- 是否存在为了反驳而反驳，而非推进讨论的行为',
      '',
      '请仅回答 JSON 格式：',
      '{',
      '  "is_loop": true/false,',
      '  "confidence": 0.0-1.0,',
      '  "reason": "简要说明判断理由"',
      '}',
      '',
      `---第 1 轮---`,
      separated[0].join('\n').slice(0, 1000),
      '',
      `---第 2 轮---`,
      separated[1].join('\n').slice(0, 1000),
      '',
      `---第 3 轮---`,
      separated[2].join('\n').slice(0, 1000),
    ].join('\n');

    try {
      // 使用小模型 (02-群聊设计 §3.3)
      const model = await this.llmService.getDefaultModelByRole('small');

      // 实际: 使用 invoke with simple prompt string
      const result = await model.invoke(prompt);
      const content =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);

      // 解析 JSON 响应 (02-群聊设计 §3.3.2)
      const parsed = this.parseLoopResponse(content);

      if (!parsed) {
        this.logger.warn('Failed to parse LLM loop detection response');
        return false;
      }

      const confirmed = parsed.isLoop && parsed.confidence >= LoopDetector.LLM_CONFIDENCE_THRESHOLD;

      if (confirmed) {
        this.logger.log(
          `Loop confirmed by LLM (confidence: ${parsed.confidence}): ${parsed.reason}`,
        );
      }

      return confirmed;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`LLM loop detection failed: ${msg}`);
      return false;
    }
  }

  // ── Private: TF-IDF (02-群聊设计 §3.2.1) ─────────────────

  private tokenize(text: string): string[] {
    // 简单分词: 按非字母数字/中文字符分割
    // 中文: 按字符分割; 英文: 按空格/标点分割
    const tokens: string[] = [];

    // English words
    const englishWords = text.match(/[a-zA-Z]+/g) ?? [];
    tokens.push(...englishWords.map((w) => w.toLowerCase()));

    // Chinese characters (simple CJK range)
    const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) ?? [];
    for (const segment of chineseChars) {
      // Split Chinese into bigrams for better matching
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2));
      }
      // Also add single chars as tokens
      for (const char of segment) {
        tokens.push(char);
      }
    }

    // Numbers
    const numbers = text.match(/\d+/g) ?? [];
    tokens.push(...numbers);

    // Filter out very short tokens
    return tokens.filter((t) => t.length >= 2);
  }

  private extractTopKeywords(
    messages: string[],
  ): { term: string; score: number }[] {
    const totalDocs = messages.length;
    if (totalDocs === 0) return [];

    // 文档频率
    const documentFrequency = new Map<string, number>();
    const termPerDoc: string[][] = [];

    for (const msg of messages) {
      const terms = [...new Set(this.tokenize(msg))];
      termPerDoc.push(terms);
      for (const term of terms) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    // TF-IDF scores
    const tfidfScores = new Map<string, number>();
    for (const [term, df] of documentFrequency) {
      const idf = Math.log(totalDocs / (df + 1));
      const tf = df / totalDocs;
      tfidfScores.set(term, tf * idf);
    }

    // Sort by score descending, take top N
    return [...tfidfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LoopDetector.TOP_N_KEYWORDS)
      .map(([term, score]) => ({ term, score }));
  }

  // ── Private: Jaccard (02-群聊设计 §3.2.2) ─────────────────

  private jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  // ── Private: Helpers ───────────────────────────────────────

  private splitIntoRounds(messages: string[], rounds: number): string[][] {
    if (messages.length < rounds) return [];

    const perRound = Math.floor(messages.length / rounds);
    const result: string[][] = [];
    for (let i = 0; i < rounds; i++) {
      const start = i * perRound;
      const end = i === rounds - 1 ? messages.length : (i + 1) * perRound;
      result.push(messages.slice(start, end));
    }
    return result;
  }

  private parseLoopResponse(content: string): ConfirmResult | null {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*?"is_loop"[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (
        typeof parsed.is_loop !== 'boolean' ||
        typeof parsed.confidence !== 'number'
      ) {
        return null;
      }

      return {
        isLoop: parsed.is_loop,
        confidence: parsed.confidence,
        reason: parsed.reason ?? 'No reason provided',
      };
    } catch {
      return null;
    }
  }
}
