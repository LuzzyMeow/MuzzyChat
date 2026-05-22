import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types (04 §3.3) ──────────────────────────────────

interface CuratorConfig {
  intervalDays: number;
  minIdleHours: number;
  batchSize: number;
}

const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  intervalDays: 7,
  minIdleHours: 1,
  batchSize: 20,
};

interface MergeOperation {
  type: 'merge';
  sourceSkillIds: string[];
  umbrellaName: string;
  umbrellaDescription: string;
  umbrellaCategory: string;
}

interface ArchiveOperation {
  type: 'archive';
  skillId: string;
  reason: string;
}

interface KeepOperation {
  type: 'keep';
  skillId: string;
  reason: string;
}

interface CuratorResult {
  mergeOperations: MergeOperation[];
  archiveOperations: ArchiveOperation[];
  keepOperations: KeepOperation[];
}

// ── Prompt (04 §3.3.2) ──────────────────────────────────

const CURATOR_PROMPT = `你是一个技能策展器。审查以下 Agent 创建的 Skills，执行以下操作：

## 审查策略

1. **伞形整合**：将多个窄域 Skills 合并为一个类级别的 umbrella Skill。
   - 例如：3 个分别处理"Python 爬虫""JavaScript 爬虫""API 数据采集"的 Skills → 合并为"通用数据采集" umbrella Skill
   - 合并后的 umbrella Skill 利用 references/、templates/、scripts/ 子目录组织

2. **归档过时 Skill**：30 天无活动的 Skill 标记为 stale，90 天无活动的标记为 archived

3. **保留高价值 Skill**：成功率高（> 0.8）且使用频繁的 Skill 应保留

## 输出格式

严格输出 JSON，不要输出其他内容：

\`\`\`json
{
  "merge_operations": [
    {
      "type": "merge",
      "source_skill_ids": ["skill_id_1", "skill_id_2"],
      "umbrella_name": "通用数据采集",
      "umbrella_description": "从多种数据源采集数据的通用流程",
      "umbrella_category": "data-collection"
    }
  ],
  "archive_operations": [
    {
      "type": "archive",
      "skill_id": "skill_id_3",
      "reason": "90 天无活动"
    }
  ],
  "keep_operations": [
    {
      "type": "keep",
      "skill_id": "skill_id_4",
      "reason": "高成功率且频繁使用"
    }
  ]
}
\`\`\`

## 待审查 Skills
{skills_formatted}`;

// ── Service ───────────────────────────────────────────────

@Injectable()
export class SkillCuratorService {
  private readonly logger = new Logger(SkillCuratorService.name);

  private readonly skillsBaseDir: string;
  private readonly config = DEFAULT_CURATOR_CONFIG;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {
    this.skillsBaseDir = path.join(process.cwd(), 'skills');
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Execute curator review for an agent (04 §3.3).
   * Only runs when agent is idle (no conversation in last hour).
   */
  async executeCuratorReview(agentId: string): Promise<CuratorResult> {
    const isIdle = await this.checkAgentIdle(agentId);
    if (!isIdle) {
      this.logger.debug(`Agent ${agentId} is not idle, skipping curator review`);
      return { mergeOperations: [], archiveOperations: [], keepOperations: [] };
    }

    const skills = await this.prisma.skill.findMany({
      where: {
        createdByAgentId: agentId,
        status: 'active',
        trustLevel: 'agent_created',
      },
      take: this.config.batchSize,
      orderBy: { updatedAt: 'asc' },
    });

    if (skills.length === 0) {
      this.logger.debug(`No agent-created skills to review for agent ${agentId}`);
      return { mergeOperations: [], archiveOperations: [], keepOperations: [] };
    }

    await this.createCuratorBackup();

    const skillsFormatted = skills
      .map(
        (s) =>
          `- ID: ${s.id} | Name: ${s.name} | Category: ${s.category} | Usage: ${s.usageCount} | SuccessRate: ${s.successRate} | Updated: ${s.updatedAt.toISOString()}`,
      )
      .join('\n');

    const prompt = CURATOR_PROMPT.replace('{skills_formatted}', skillsFormatted);

    const largeModel = await this.llmService.getDefaultModelByRole('big');
    const response = await largeModel.invoke([{ role: 'user', content: prompt }]);
    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const result = this.parseCuratorResult(text);

    for (const op of result.mergeOperations) {
      try {
        await this.executeMergeOperation(op, agentId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.error(`Merge operation failed: ${msg}`);
      }
    }

    for (const op of result.archiveOperations) {
      try {
        await this.executeArchiveOperation(op);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.error(`Archive operation failed: ${msg}`);
      }
    }

    this.logger.log(
      `Curator review completed for agent ${agentId}: ${result.mergeOperations.length} merges, ${result.archiveOperations.length} archives`,
    );

    return result;
  }

  // ── Internal ────────────────────────────────────────────

  private async checkAgentIdle(agentId: string): Promise<boolean> {
    const idleThreshold = new Date(
      Date.now() - this.config.minIdleHours * 60 * 60 * 1000,
    );

    const recentMessage = await this.prisma.message.findFirst({
      where: {
        agentId,
        createdAt: { gte: idleThreshold },
      },
    });

    return recentMessage === null;
  }

  private async createCuratorBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.skillsBaseDir, '.curator_backup', timestamp);

    try {
      await fs.mkdir(backupDir, { recursive: true });
      const sourceDir = this.skillsBaseDir;
      try {
        await fs.access(sourceDir);
        await this.copyDir(sourceDir, backupDir, ['.curator_backup']);
      } catch {
        this.logger.debug('Skills directory does not exist yet, skipping backup');
      }

      await this.cleanOldBackups();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.warn(`Curator backup failed: ${msg}`);
    }

    return backupDir;
  }

  private async copyDir(
    src: string,
    dest: string,
    exclude: string[] = [],
  ): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath, exclude);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async cleanOldBackups(): Promise<void> {
    const backupBase = path.join(this.skillsBaseDir, '.curator_backup');
    try {
      const entries = await fs.readdir(backupBase);
      if (entries.length <= 5) return;

      const sorted = entries.sort();
      const toDelete = sorted.slice(0, sorted.length - 5);

      for (const name of toDelete) {
        await fs.rm(path.join(backupBase, name), { recursive: true, force: true });
      }
    } catch {
      // backup dir may not exist
    }
  }

  private parseCuratorResult(text: string): CuratorResult {
    const result: CuratorResult = {
      mergeOperations: [],
      archiveOperations: [],
      keepOperations: [],
    };

    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.match(/\{[\s\S]*\}/)?.[0];

    if (!jsonStr) return result;

    try {
      const parsed = JSON.parse(jsonStr);

      if (Array.isArray(parsed.merge_operations)) {
        result.mergeOperations = parsed.merge_operations
          .filter(
            (op: Record<string, unknown>) =>
              op.type === 'merge' &&
              Array.isArray(op.source_skill_ids) &&
              op.umbrella_name,
          )
          .map((op: Record<string, unknown>) => ({
            type: 'merge' as const,
            sourceSkillIds: (op.source_skill_ids as string[]).map(String),
            umbrellaName: String(op.umbrella_name).slice(0, 100),
            umbrellaDescription: String(op.umbrella_description || '').slice(0, 500),
            umbrellaCategory: String(op.umbrella_category || 'uncategorized').slice(0, 100),
          }));
      }

      if (Array.isArray(parsed.archive_operations)) {
        result.archiveOperations = parsed.archive_operations
          .filter((op: Record<string, unknown>) => op.type === 'archive' && op.skill_id)
          .map((op: Record<string, unknown>) => ({
            type: 'archive' as const,
            skillId: String(op.skill_id),
            reason: String(op.reason || '').slice(0, 500),
          }));
      }

      if (Array.isArray(parsed.keep_operations)) {
        result.keepOperations = parsed.keep_operations
          .filter((op: Record<string, unknown>) => op.type === 'keep' && op.skill_id)
          .map((op: Record<string, unknown>) => ({
            type: 'keep' as const,
            skillId: String(op.skill_id),
            reason: String(op.reason || '').slice(0, 500),
          }));
      }
    } catch {
      this.logger.warn('Failed to parse curator result');
    }

    return result;
  }

  private async executeMergeOperation(
    operation: MergeOperation,
    agentId: string,
  ): Promise<void> {
    const sourceSkills = await this.prisma.skill.findMany({
      where: { id: { in: operation.sourceSkillIds } },
    });

    if (sourceSkills.length === 0) {
      this.logger.warn(`No source skills found for merge: ${operation.sourceSkillIds.join(',')}`);
      return;
    }

    const umbrellaDir = path.join(
      this.skillsBaseDir,
      operation.umbrellaCategory,
      operation.umbrellaName,
    );

    await fs.mkdir(path.join(umbrellaDir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(umbrellaDir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(umbrellaDir, 'references'), { recursive: true });

    const umbrellaSkillMd = this.generateUmbrellaSkillMd(operation, sourceSkills);
    await fs.writeFile(path.join(umbrellaDir, 'SKILL.md'), umbrellaSkillMd, 'utf-8');

    for (const sourceSkill of sourceSkills) {
      try {
        const sourceDir = path.dirname(sourceSkill.filePath);
        await this.moveSkillAssets(sourceDir, umbrellaDir);
      } catch {
        this.logger.debug(`Could not move assets for skill ${sourceSkill.id}`);
      }

      await this.prisma.skill.update({
        where: { id: sourceSkill.id },
        data: { status: 'deprecated' },
      });
    }

    const umbrellaSkill = await this.prisma.skill.create({
      data: {
        name: operation.umbrellaName,
        description: operation.umbrellaDescription,
        category: operation.umbrellaCategory,
        filePath: path.join(umbrellaDir, 'SKILL.md'),
        status: 'active',
        trustLevel: 'agent_created',
        prerequisites: [],
        createdByAgentId: agentId,
      },
    });

    const embedding = await this.llmService.embedText(
      `${operation.umbrellaName} ${operation.umbrellaDescription}`,
    );
    const embeddingStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE skills SET embedding = $1::vector WHERE id = $2`,
      embeddingStr,
      umbrellaSkill.id,
    );

    this.logger.log(
      `Merged ${sourceSkills.length} skills into umbrella: ${operation.umbrellaName}`,
    );
  }

  private async executeArchiveOperation(operation: ArchiveOperation): Promise<void> {
    const skill = await this.prisma.skill.findUnique({
      where: { id: operation.skillId },
    });

    if (!skill) {
      this.logger.warn(`Skill not found for archive: ${operation.skillId}`);
      return;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    let newStatus: 'stale' | 'archived' | typeof skill.status;
    if (skill.updatedAt < ninetyDaysAgo) {
      newStatus = 'archived';
    } else if (skill.updatedAt < thirtyDaysAgo) {
      newStatus = 'stale';
    } else {
      newStatus = skill.status;
    }

    if (newStatus !== skill.status) {
      await this.prisma.skill.update({
        where: { id: operation.skillId },
        data: { status: newStatus },
      });
      this.logger.log(`Skill ${operation.skillId} status changed to ${newStatus}`);
    }
  }

  private generateUmbrellaSkillMd(
    operation: MergeOperation,
    sourceSkills: { name: string; description: string; category: string }[],
  ): string {
    const frontmatter = [
      '---',
      `name: ${operation.umbrellaName}`,
      `description: ${operation.umbrellaDescription}`,
      `version: "1.0"`,
      `category: ${operation.umbrellaCategory}`,
      `author: agent`,
      `platforms:`,
      `  - linux`,
      `  - macos`,
      `  - windows`,
      `trust_level: agent_created`,
      `status: active`,
      `prerequisites: []`,
      `created_at: ${new Date().toISOString()}`,
      `updated_at: ${new Date().toISOString()}`,
      '---',
    ].join('\n');

    const subSkillList = sourceSkills
      .map((s) => `- **${s.name}** (${s.category}): ${s.description}`)
      .join('\n');

    const body = [
      `# ${operation.umbrellaName}`,
      '',
      '## 概述',
      '',
      operation.umbrellaDescription,
      '',
      '## 子技能',
      '',
      subSkillList,
      '',
      '## 参考模板',
      '',
      '参见 `templates/` 目录',
      '',
      '## 脚本',
      '',
      '参见 `scripts/` 目录',
      '',
      '## 参考资料',
      '',
      '参见 `references/` 目录',
    ].join('\n');

    return frontmatter + '\n' + body;
  }

  private async moveSkillAssets(sourceDir: string, umbrellaDir: string): Promise<void> {
    const subDirs = ['templates', 'scripts', 'references'];

    for (const subDir of subDirs) {
      const srcPath = path.join(sourceDir, subDir);
      try {
        await fs.access(srcPath);
        const entries = await fs.readdir(srcPath);
        for (const entry of entries) {
          const srcFile = path.join(srcPath, entry);
          const destFile = path.join(umbrellaDir, subDir, entry);
          try {
            await fs.copyFile(srcFile, destFile);
          } catch {
            // skip if copy fails
          }
        }
      } catch {
        // subDir may not exist
      }
    }
  }
}
