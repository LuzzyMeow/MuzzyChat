import { Controller, Post, Param, Get, Query, Res } from '@nestjs/common';
import { DreamSchedulerProcessor } from './dream-scheduler.processor';
import { DreamService } from './dream.service';
import { ExportViewService } from './export-view.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Response } from 'express';

@Controller('dream')
export class DreamController {
  constructor(
    private readonly scheduler: DreamSchedulerProcessor,
    private readonly dreamService: DreamService,
    private readonly exportView: ExportViewService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sweep/:agentId')
  async triggerSweep(@Param('agentId') agentId: string) {
    const jobId = await this.scheduler.enqueueSweep(agentId, 'manual');
    return { jobId, agentId, status: 'enqueued' };
  }

  @Post('sweep-all')
  async triggerAllSweeps() {
    const count = await this.scheduler.enqueueAllAgents('manual');
    return { enqueued: count, status: 'enqueued' };
  }

  @Get('sweeps/:agentId')
  async getSweeps(
    @Param('agentId') agentId: string,
    @Query('limit') limit?: string,
  ) {
    const sweeps = await this.prisma.dreamSweep.findMany({
      where: { agentId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Number(limit) || 10, 50),
    });
    return sweeps;
  }

  @Get('memories/:agentId')
  async getLongTermMemories(
    @Param('agentId') agentId: string,
    @Query('limit') limit?: string,
  ) {
    const memories = await this.prisma.longTermMemory.findMany({
      where: { agentId },
      orderBy: { score: 'desc' },
      take: Math.min(Number(limit) || 20, 100),
    });
    return memories;
  }

  @Post('recover/:agentId')
  async recoverSweep(@Param('agentId') agentId: string) {
    const sweepId = await this.dreamService.recoverSweep(agentId);
    return { sweepId, status: sweepId ? 'recovered' : 'no_pending_sweep' };
  }

  @Get('export/memory/:agentId')
  async exportMemoryMd(@Param('agentId') agentId: string, @Res() res: Response) {
    const md = await this.exportView.generateMemoryMd(agentId);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  }

  @Get('export/dreams/:agentId')
  async exportDreamsMd(@Param('agentId') agentId: string, @Res() res: Response) {
    const md = await this.exportView.generateDreamsMd(agentId);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  }
}
