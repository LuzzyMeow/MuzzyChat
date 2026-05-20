import { Module } from '@nestjs/common';
import { ChatGroupController } from './chat-group.controller';
import { ChatGroupService } from './chat-group.service';

@Module({
  controllers: [ChatGroupController],
  providers: [ChatGroupService],
  exports: [ChatGroupService],
})
export class ChatGroupModule {}