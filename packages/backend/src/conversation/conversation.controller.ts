import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { CreateConversationDto, UpdateConversationDto } from './dto';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  async findAll() {
    return this.conversationService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  @Post()
  async create(@Body() dto: CreateConversationDto) {
    return this.conversationService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateConversationDto) {
    const conversation = await this.conversationService.update(id, dto);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const conversation = await this.conversationService.remove(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }
}