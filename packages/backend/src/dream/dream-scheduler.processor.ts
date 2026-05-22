import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DreamService } from './dream.service';

export const DREAM_QUEUE = 'dream-sweep';

export interface DreamJobData {
  agentId: string;
  triggeredBy: 'cron' | 'manual' | 'idle';
}

@Processor(DREAM_QUEUE)
export class DreamSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(DreamSchedulerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dreamService: DreamService,
    @InjectQueue(DREAM_QUEUE) private readonly dreamQueue: Queue<DreamJobData>,
  ) {
    super();
  }

  async process(job: Job<DreamJobData>): Promise<void> {
    const { agentId, triggeredBy } = job.data;
    this.logger.log(`Processing dream job for agent ${agentId} (trigger: ${triggeredBy})`);

    const existingSweep = await this.prisma.dreamSweep.findFirst({
      where: { agentId, status: 'running' },
    });

    if (existingSweep) {
      this.logger.warn(`Agent ${agentId} already has a running sweep, skipping`);
      return;
    }

    await this.dreamService.executeSweep(agentId);
  }

  async enqueueSweep(agentId: string, triggeredBy: DreamJobData['triggeredBy'] = 'cron'): Promise<string> {
    const job = await this.dreamQueue.add(
      'sweep',
      { agentId, triggeredBy },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    return job.id ?? '';
  }

  async enqueueAllAgents(triggeredBy: DreamJobData['triggeredBy'] = 'cron'): Promise<number> {
    const agents = await this.prisma.agent.findMany({
      select: { id: true },
    });

    let enqueued = 0;
    for (const agent of agents) {
      try {
        await this.enqueueSweep(agent.id, triggeredBy);
        enqueued++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.warn(`Failed to enqueue sweep for agent ${agent.id}: ${msg}`);
      }
    }

    this.logger.log(`Enqueued ${enqueued}/${agents.length} agents for dream sweep`);
    return enqueued;
  }
}
