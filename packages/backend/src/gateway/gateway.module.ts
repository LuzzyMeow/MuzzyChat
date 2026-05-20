import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [PrismaModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}