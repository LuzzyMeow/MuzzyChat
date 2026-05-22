import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportViewService {
  private readonly logger = new Logger(ExportViewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateMemoryMd(agentId: string): Promise<string> {
    const memories = await this.prisma.longTermMemory.findMany({
      where: { agentId },
      orderBy: { score: 'desc' },
      take: 500,
    });

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { name: true },
    });

    const lines: string[] = [
      `# ${agent?.name ?? agentId} — 长期记忆`,
      '',
      `> 自动生成于 ${new Date().toISOString()} | 共 ${memories.length} 条记忆`,
      '',
      `## 统计`,
      '',
      `| 分数区间 | 数量 |`,
      `|----------|------|`,
      `| ≥ 0.8 | ${memories.filter((m) => Number(m.score) >= 0.8).length} |`,
      `| 0.6 - 0.8 | ${memories.filter((m) => Number(m.score) >= 0.6 && Number(m.score) < 0.8).length} |`,
      `| 0.45 - 0.6 | ${memories.filter((m) => Number(m.score) >= 0.45 && Number(m.score) < 0.6).length} |`,
      `| < 0.45 | ${memories.filter((m) => Number(m.score) < 0.45).length} |`,
      '',
    ];

    const byCategory = this.groupByCategory(memories);
    for (const [category, items] of byCategory) {
      lines.push(`## ${category}`);
      lines.push('');
      for (const mem of items) {
        lines.push(
          `- **[${Number(mem.score).toFixed(2)}]** ${mem.content.slice(0, 200)}`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  async generateDreamsMd(agentId: string): Promise<string> {
    const sweeps = await this.prisma.dreamSweep.findMany({
      where: { agentId },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { name: true },
    });

    const lines: string[] = [
      `# ${agent?.name ?? agentId} — 梦境日志`,
      '',
      `> 自动生成于 ${new Date().toISOString()} | 共 ${sweeps.length} 次梦境`,
      '',
    ];

    for (const sweep of sweeps) {
      const status = sweep.status === 'completed' ? '✅' : sweep.status === 'failed' ? '❌' : '⏳';
      const completed = sweep.completedAt
        ? ` → ${sweep.startedAt.toISOString()}`
        : '';
      lines.push(
        `### ${status} Sweep \`${sweep.sweepId}\`  ${sweep.startedAt.toISOString()}${completed}`,
      );
      lines.push('');

      const lightState = await this.prisma.dreamLightState.findFirst({
        where: { agentId, sweepId: sweep.sweepId },
      });
      if (lightState) {
        const stats = lightState.dedupStats as Record<string, unknown> | null;
        lines.push(
          `- 浅睡: 扫描 ${stats?.totalScanned ?? '?'} 条消息, 去重后 ${(stats?.uniqueCandidates ?? '?')} 条候选`,
        );
      }

      const remState = await this.prisma.dreamRemState.findFirst({
        where: { agentId, sweepId: sweep.sweepId },
      });
      if (remState) {
        const insights = remState.insights as Record<string, unknown>[] | null;
        const signals = remState.phaseSignals as Record<string, unknown>[] | null;
        lines.push(
          `- REM: ${(insights?.length ?? 0)} 条洞察, ${(signals?.length ?? 0)} 个模式信号`,
        );
        if (insights && insights.length > 0) {
          for (const insight of insights.slice(0, 5)) {
            lines.push(
              `  - _${(insight.confidence as number).toFixed(2)}_ ${String(insight.content).slice(0, 150)}`,
            );
          }
        }
      }

      const deepState = await this.prisma.dreamDeepState.findFirst({
        where: { agentId, sweepId: sweep.sweepId },
      });
      if (deepState) {
        lines.push(`- 深睡: 晋升 ${deepState.promotedCount} 条长期记忆`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private groupByCategory(
    memories: { content: string; score: unknown; conceptualTags: unknown }[],
  ): Map<string, { content: string; score: unknown }[]> {
    const buckets = new Map<string, { content: string; score: unknown }[]>();
    const defaultCategories = ['用户偏好', '工具使用经验', '任务模式', '通用原则'];

    for (const cat of defaultCategories) {
      buckets.set(cat, []);
    }
    const otherKey = '未分类';
    buckets.set(otherKey, []);

    for (const mem of memories) {
      const tags = mem.conceptualTags as Record<string, unknown> | null;
      const tagList: string[] =
        tags && Array.isArray((tags as Record<string, unknown>).tags)
          ? ((tags as Record<string, unknown>).tags as string[])
          : [];

      let categorized = false;
      for (const cat of defaultCategories) {
        if (tagList.some((t: string) => t.includes(cat))) {
          buckets.get(cat)!.push(mem);
          categorized = true;
          break;
        }
      }
      if (!categorized) {
        buckets.get(otherKey)!.push(mem);
      }
    }

    for (const cat of defaultCategories) {
      const items = buckets.get(cat)!;
      items.sort((a, b) => Number(b.score) - Number(a.score));
    }
    buckets.get(otherKey)!.sort((a, b) => Number(b.score) - Number(a.score));

    return buckets;
  }
}
