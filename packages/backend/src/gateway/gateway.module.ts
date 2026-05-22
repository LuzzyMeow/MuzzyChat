import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentLoopModule } from '../agent-loop/agent-loop.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { SecurityModule } from '../security/security.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AgentLoopModule),
    forwardRef(() => OrchestrationModule),
    SecurityModule,
  ],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}
