import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { AceGeneratorService } from './ace-generator.service';
import { AceReflectorService } from './ace-reflector.service';
import { AceCuratorService } from './ace-curator.service';
import { AceRetrievalService } from './ace-retrieval.service';

@Module({
  imports: [PrismaModule, LlmModule],
  providers: [
    AceGeneratorService,
    AceReflectorService,
    AceCuratorService,
    AceRetrievalService,
  ],
  exports: [
    AceGeneratorService,
    AceReflectorService,
    AceCuratorService,
    AceRetrievalService,
  ],
})
export class AceModule {}
