import { Module, forwardRef } from '@nestjs/common';
import { ParallelOrchestrator } from './parallel-orchestrator.service';
import { DynamicDiscussionCoordinator } from './dynamic-discussion.service';
import { LoopDetector } from './loop-detector.service';
import { SupervisorEngine } from './supervisor-engine.service';
import { AgentRecruitService } from './agent-recruit.service';
import { OrchestrationController } from './orchestration.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { AgentLoopModule } from '../agent-loop/agent-loop.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    forwardRef(() => AgentLoopModule),
    forwardRef(() => GatewayModule),
  ],
  providers: [
    ParallelOrchestrator,
    DynamicDiscussionCoordinator,
    LoopDetector,
    SupervisorEngine,
    AgentRecruitService,
  ],
  controllers: [OrchestrationController],
  exports: [
    ParallelOrchestrator,
    SupervisorEngine,
    AgentRecruitService,
  ],
})
export class OrchestrationModule {}
