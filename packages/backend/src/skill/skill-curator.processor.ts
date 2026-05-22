import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkillCuratorService } from './skill-curator.service';

export const SKILL_CURATOR_QUEUE = 'skill-curator';

export interface SkillCuratorJobData {
  agentId: string;
  triggeredBy: 'cron' | 'manual';
}

@Processor(SKILL_CURATOR_QUEUE)
export class SkillCuratorProcessor extends WorkerHost {
  private readonly logger = new Logger(SkillCuratorProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly curatorService: SkillCuratorService,
    @InjectQueue(SKILL_CURATOR_QUEUE)
    private readonly curatorQueue: Queue<SkillCuratorJobData>,
  ) {
    super();
  }

  async process(job: Job<SkillCuratorJobData>): Promise<void> {
    const { agentId, triggeredBy } = job.data;
    this.logger.log(`Processing curator review for agent ${agentId} (trigger: ${triggeredBy})`);

    await this.curatorService.executeCuratorReview(agentId);
  }

  async enqueueReview(
    agentId: string,
    triggeredBy: SkillCuratorJobData['triggeredBy'] = 'cron',
  ): Promise<string> {
    const job = await this.curatorQueue.add(
      'review',
      { agentId, triggeredBy },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 120_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
    return job.id ?? '';
  }

  async enqueueAllAgents(
    triggeredBy: SkillCuratorJobData['triggeredBy'] = 'cron',
  ): Promise<number> {
    const agents = await this.prisma.agent.findMany({
      select: { id: true },
    });

    let enqueued = 0;
    for (const agent of agents) {
      try {
        await this.enqueueReview(agent.id, triggeredBy);
        enqueued++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        this.logger.warn(`Failed to enqueue curator for agent ${agent.id}: ${msg}`);
      }
    }

    this.logger.log(`Enqueued ${enqueued}/${agents.length} agents for curator review`);
    return enqueued;
  }
}
