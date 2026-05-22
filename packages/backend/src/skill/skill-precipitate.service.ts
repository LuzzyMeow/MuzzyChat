import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types (04 §3.2.1) ──────────────────────────────────

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: 'success' | 'failure';
  output: string;
}

interface ToolCallSequence {
  agentId: string;
  conversationId: string;
  calls: ToolCallRecord[];
  allSuccess: boolean;
}

interface SkillDecision {
  reusable: boolean;
  confidence: number;
  category: string;
  name: string;
  description: string;
  reason: string;
}

interface SecurityThreat {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location: string;
}

interface SecurityScanResult {
  passed: boolean;
  threats: SecurityThreat[];
}

// ── Prompt (04 §3.2.2) ──────────────────────────────────

const REUSABILITY_PROMPT = `你是一个技能可复用性评估器。判断以下工具调用序列是否值得沉淀为可复用 Skill。

## 判定标准

1. 通用性：该序列是否可能在类似场景中复用？还是仅适用于当前特定任务？
2. 完整性：序列是否构成一个完整的任务流程？还是只是零散的操作？
3. 独立性：该序列是否可以独立执行？还是强依赖当前对话的特定上下文？

## 输出格式

严格输出 JSON，不要输出其他内容：

\`\`\`json
{
  "reusable": true,
  "confidence": 0.85,
  "category": "分类名称",
  "name": "skill-name",
  "description": "一句话描述",
  "reason": "判断理由"
}
\`\`\`

## 工具调用序列
{tool_calls_formatted}`;

// ── Service ───────────────────────────────────────────────

@Injectable()
export class SkillPrecipitateService {
  private readonly logger = new Logger(SkillPrecipitateService.name);

  private readonly skillsBaseDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.skillsBaseDir = path.join(process.cwd(), 'skills');
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Evaluate a tool call sequence and precipitate as Skill if reusable (04 §3.2).
   */
  async evaluateAndPrecipitate(sequence: ToolCallSequence): Promise<string | null> {
    if (!this.shouldPrecipitate(sequence)) {
      return null;
    }

    const decision = await this.evaluateReusability(sequence);
    if (!decision.reusable || decision.confidence < 0.7) {
      this.logger.debug(
        `Skill not precipitated: reusable=${decision.reusable}, confidence=${decision.confidence}`,
      );
      return null;
    }

    const skillMd = this.generateSkillMd(sequence, decision);

    const scanResult = this.scanSkillSecurity(skillMd);
    if (!scanResult.passed) {
      this.logger.warn(
        `Skill "${decision.name}" failed security scan: ${scanResult.threats.map((t) => t.type).join(', ')}`,
      );
      return null;
    }

    const skillDir = path.join(this.skillsBaseDir, decision.category, decision.name);
    const skillFilePath = path.join(skillDir, 'SKILL.md');

    await fs.mkdir(path.join(skillDir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
    await fs.writeFile(skillFilePath, skillMd, 'utf-8');

    const skill = await this.prisma.skill.create({
      data: {
        name: decision.name,
        description: decision.description,
        category: decision.category,
        filePath: skillFilePath,
        successRate: 0,
        usageCount: 0,
        status: 'active',
        sourceConversationId: sequence.conversationId,
        trustLevel: 'agent_created',
        prerequisites: [],
        createdByAgentId: sequence.agentId,
      },
    });

    this.generateSkillEmbedding(skill.id, decision.name, decision.description).catch((err) =>
      this.logger.warn(`Skill embedding failed for ${skill.id}: ${err}`),
    );

    this.logger.log(
      `Skill precipitated: ${decision.name} (${decision.category}) for agent ${sequence.agentId}`,
    );

    return skill.id;
  }

  /**
   * Retrieve top-K relevant skills for a query (04 §3.4.1).
   */
  async retrieveSkills(queryText: string, topK = 3): Promise<unknown[]> {
    const queryEmbedding = await this.llmService.embedText(queryText);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const skills: unknown[] = await this.prisma.$queryRawUnsafe(
      `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM skills
       WHERE status = 'active' AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      embeddingStr,
      topK,
    );

    return skills;
  }

  /**
   * Record skill usage for tracking (04 §3.4).
   */
  async recordUsage(skillId: string, agentId: string, success: boolean, executionTimeMs = 0): Promise<void> {
    await this.prisma.skillUsageLog.create({
      data: {
        skillId,
        agentId,
        success,
        executionTimeMs,
      },
    });

    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return;

    const usageLogs = await this.prisma.skillUsageLog.findMany({
      where: { skillId },
    });

    const totalUses = usageLogs.length;
    const successCount = usageLogs.filter((l) => l.success).length;
    const successRate = totalUses > 0 ? successCount / totalUses : 0;

    await this.prisma.skill.update({
      where: { id: skillId },
      data: {
        usageCount: totalUses,
        successRate,
      },
    });

    const recentLogs = await this.prisma.skillUsageLog.findMany({
      where: { skillId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const consecutiveSuccess =
      recentLogs.length >= 5 && recentLogs.every((l) => l.success);

    if (consecutiveSuccess) {
      const embedding = await this.llmService
        .embedText(`${skill.name} ${skill.description}`)
        .catch(() => [] as number[]);

      this.eventEmitter.emit('skill.success_trend', {
        type: 'skill.success_trend',
        payload: {
          skillId: skill.id,
          skillName: skill.name,
          skillDescription: skill.description,
          skillEmbedding: embedding,
          consecutiveSuccesses: recentLogs.length,
          totalUsageCount: totalUses,
          successRate: Math.round(successRate * 10000) / 10000,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.log(
        `Skill ${skill.name} (${skill.id}) achieved ${recentLogs.length} consecutive successes — success_trend emitted`,
      );
    }
  }

  // ── Internal ────────────────────────────────────────────

  private shouldPrecipitate(sequence: ToolCallSequence): boolean {
    return sequence.calls.length >= 3 && sequence.allSuccess;
  }

  private async evaluateReusability(sequence: ToolCallSequence): Promise<SkillDecision> {
    const callsFormatted = sequence.calls
      .map(
        (c, i) =>
          `${i + 1}. ${c.toolName}(${Object.entries(c.args)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ')}) → [${c.result}] ${c.output.slice(0, 100)}`,
      )
      .join('\n');

    const prompt = REUSABILITY_PROMPT.replace('{tool_calls_formatted}', callsFormatted);

    const smallModel = await this.llmService.getDefaultModelByRole('small');
    const response = await smallModel.invoke([{ role: 'user', content: prompt }]);
    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const jsonStr = this.extractJson(text);
    if (!jsonStr) {
      return { reusable: false, confidence: 0, category: '', name: '', description: '', reason: 'Parse failed' };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        reusable: !!parsed.reusable,
        confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
        category: String(parsed.category || 'uncategorized').slice(0, 100),
        name: this.sanitizeSkillName(String(parsed.name || 'unnamed-skill')),
        description: String(parsed.description || '').slice(0, 500),
        reason: String(parsed.reason || '').slice(0, 500),
      };
    } catch {
      return { reusable: false, confidence: 0, category: '', name: '', description: '', reason: 'Parse failed' };
    }
  }

  private generateSkillMd(sequence: ToolCallSequence, decision: SkillDecision): string {
    const steps = sequence.calls.map((call, i) => {
      const argsStr = Object.entries(call.args)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      return `${i + 1}. 使用 \`${call.toolName}\` 工具（${argsStr}）— ${call.output.slice(0, 100)}`;
    });

    const frontmatter = [
      '---',
      `name: ${decision.name}`,
      `description: ${decision.description}`,
      `version: "1.0"`,
      `category: ${decision.category}`,
      `author: agent`,
      `agent_id: ${sequence.agentId}`,
      `platforms:`,
      `  - linux`,
      `  - macos`,
      `  - windows`,
      `trust_level: agent_created`,
      `status: active`,
      `prerequisites: []`,
      `created_at: ${new Date().toISOString()}`,
      `updated_at: ${new Date().toISOString()}`,
      `source_conversation_id: ${sequence.conversationId}`,
      '---',
    ].join('\n');

    const body = [
      `# ${decision.name}`,
      '',
      '## 概述',
      '',
      decision.description,
      '',
      '## 步骤',
      '',
      ...steps,
    ].join('\n');

    return frontmatter + '\n' + body;
  }

  private scanSkillSecurity(skillContent: string): SecurityScanResult {
    const threats: SecurityThreat[] = [];

    const apiKeyPattern =
      /(?:sk-|api_key|apikey|api-key|token|secret|password)\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}/gi;
    const injectionPattern =
      /(?:忽略|ignore|override|bypass)\s*(?:之前的|previous|above)\s*(?:指令|instructions?|rules?)/gi;
    const destructivePattern =
      /(?:rm\s+-rf|format\s+[A-Z]:|del\s+\/s|shutdown|reboot)/gi;

    const apiKeyMatches = skillContent.match(apiKeyPattern) || [];
    for (const match of apiKeyMatches) {
      threats.push({
        type: 'DATA_LEAK',
        severity: 'critical',
        description: `检测到可能的 API Key 或密钥: ${match.slice(0, 20)}...`,
        location: 'SKILL.md',
      });
    }

    const injectionMatches = skillContent.match(injectionPattern) || [];
    for (const match of injectionMatches) {
      threats.push({
        type: 'PROMPT_INJECTION',
        severity: 'high',
        description: `检测到可能的提示注入: ${match}`,
        location: 'SKILL.md',
      });
    }

    const destructiveMatches = skillContent.match(destructivePattern) || [];
    for (const match of destructiveMatches) {
      threats.push({
        type: 'DESTRUCTIVE_OPERATION',
        severity: 'critical',
        description: `检测到破坏性命令: ${match}`,
        location: 'SKILL.md',
      });
    }

    return {
      passed:
        threats.filter((t) => t.severity === 'critical' || t.severity === 'high').length === 0,
      threats,
    };
  }

  private async generateSkillEmbedding(
    skillId: string,
    name: string,
    description: string,
  ): Promise<void> {
    try {
      const embedding = await this.llmService.embedText(`${name} ${description}`);
      const embeddingStr = `[${embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE skills SET embedding = $1::vector WHERE id = $2`,
        embeddingStr,
        skillId,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.warn(`Skill embedding failed for ${skillId}: ${msg}`);
    }
  }

  private sanitizeSkillName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }

  private extractJson(text: string): string | null {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return null;
  }
}
