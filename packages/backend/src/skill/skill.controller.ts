import { Controller, Post, Param, Get, Query } from '@nestjs/common';
import { SkillPrecipitateService } from './skill-precipitate.service';
import { SkillCuratorProcessor, SKILL_CURATOR_QUEUE } from './skill-curator.processor';
import { PrismaService } from '../prisma/prisma.service';

@Controller('skill')
export class SkillController {
  constructor(
    private readonly precipitateService: SkillPrecipitateService,
    private readonly curatorProcessor: SkillCuratorProcessor,
    private readonly prisma: PrismaService,
  ) {}

  @Get('search')
  async searchSkills(@Query('q') query: string, @Query('topK') topK?: string) {
    const skills = await this.precipitateService.retrieveSkills(
      query,
      Math.min(Number(topK) || 3, 10),
    );
    return skills;
  }

  @Get('list/:agentId')
  async listSkills(
    @Param('agentId') agentId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where: Record<string, unknown> = { createdByAgentId: agentId };
    if (status) where.status = status;

    const skills = await this.prisma.skill.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Number(limit) || 20, 100),
    });
    return skills;
  }

  @Get(':skillId')
  async getSkill(@Param('skillId') skillId: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
    });
    return skill;
  }

  @Post('curator/:agentId')
  async triggerCuratorReview(@Param('agentId') agentId: string) {
    const jobId = await this.curatorProcessor.enqueueReview(agentId, 'manual');
    return { jobId, agentId, status: 'enqueued' };
  }

  @Post('curator-all')
  async triggerAllCuratorReviews() {
    const count = await this.curatorProcessor.enqueueAllAgents('manual');
    return { enqueued: count, status: 'enqueued' };
  }
}
