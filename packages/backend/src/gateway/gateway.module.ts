import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentLoopModule } from '../agent-loop/agent-loop.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [PrismaModule, forwardRef(() => AgentLoopModule)],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}