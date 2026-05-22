import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DreamService } from './dream.service';
import { DreamSchedulerProcessor, DREAM_QUEUE } from './dream-scheduler.processor';
import { DreamController } from './dream.controller';
import { ExportViewService } from './export-view.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    BullModule.registerQueue({
      name: DREAM_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    }),
  ],
  controllers: [DreamController],
  providers: [DreamService, DreamSchedulerProcessor, ExportViewService],
  exports: [DreamService, DreamSchedulerProcessor, ExportViewService],
})
export class DreamModule {}
