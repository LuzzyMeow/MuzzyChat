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
      take: 200,
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
    ];

    const byScore = this.groupByScoreBucket(memories);
    for (const [bucket, items] of byScore) {
      lines.push(`## ${bucket}`);
      lines.push('');
      for (const mem of items) {
        const tags = mem.conceptualTags as Record<string, unknown> | null;
        const tagStr =
          tags && Array.isArray((tags as Record<string, unknown>).tags)
            ? ((tags as Record<string, unknown>).tags as string[]).join(', ')
            : '';
        lines.push(
          `- **[${Number(mem.score).toFixed(2)}]** ${mem.content.slice(0, 200)}${tagStr ? ` _(${tagStr})_` : ''}`,
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

  private groupByScoreBucket(
    memories: { score: { toFixed(digits: number): string }; content: string; conceptualTags: unknown }[],
  ): Map<string, { score: { toFixed(digits: number): string }; content: string; conceptualTags: unknown }[]> {
    const buckets = new Map<string, { score: { toFixed(digits: number): string }; content: string; conceptualTags: unknown }[]>();
    const bucketNames: [number, string][] = [
      [0.8, '核心记忆 (≥0.8)'],
      [0.6, '重要记忆 (0.6-0.8)'],
      [0.45, '一般记忆 (0.45-0.6)'],
      [0, '低优先记忆 (<0.45)'],
    ];

    for (const mem of memories) {
      for (const [threshold, name] of bucketNames) {
        if (Number(mem.score) >= threshold) {
          const existing = buckets.get(name) ?? [];
          existing.push(mem);
          buckets.set(name, existing);
          break;
        }
      }
    }

    return buckets;
  }
}
