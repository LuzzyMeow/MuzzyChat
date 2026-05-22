import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { GatewayModule } from '../gateway/gateway.module';
import { SecurityModule } from '../security/security.module';
import { AgentLoopService } from './agent-loop.service';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    forwardRef(() => GatewayModule),
    SecurityModule,
  ],
  providers: [AgentLoopService],
  exports: [AgentLoopService],
})
export class AgentLoopModule {}
