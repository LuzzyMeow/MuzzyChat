import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SkillPrecipitateService } from './skill-precipitate.service';
import { SkillCuratorService } from './skill-curator.service';
import { SkillCuratorProcessor, SKILL_CURATOR_QUEUE } from './skill-curator.processor';
import { SkillController } from './skill.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    BullModule.registerQueue({
      name: SKILL_CURATOR_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 120_000 },
      },
    }),
  ],
  controllers: [SkillController],
  providers: [SkillPrecipitateService, SkillCuratorService, SkillCuratorProcessor],
  exports: [SkillPrecipitateService, SkillCuratorService, SkillCuratorProcessor],
})
export class SkillModule {}
