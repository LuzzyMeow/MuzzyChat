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
import { ChatGroupService } from './chat-group.service';
import { CreateChatGroupDto, UpdateChatGroupDto } from './dto';

@Controller('groups')
export class ChatGroupController {
  constructor(private readonly chatGroupService: ChatGroupService) {}

  @Get()
  async findAll() {
    return this.chatGroupService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const group = await this.chatGroupService.findById(id);
    if (!group) {
      throw new NotFoundException(`ChatGroup ${id} not found`);
    }
    return group;
  }

  @Post()
  async create(@Body() dto: CreateChatGroupDto) {
    return this.chatGroupService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChatGroupDto) {
    const group = await this.chatGroupService.update(id, dto);
    if (!group) {
      throw new NotFoundException(`ChatGroup ${id} not found`);
    }
    return group;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const group = await this.chatGroupService.remove(id);
    if (!group) {
      throw new NotFoundException(`ChatGroup ${id} not found`);
    }
    return group;
  }

  // ── Members ──────────────────────────────────────────────────

  @Get(':id/members')
  async listMembers(@Param('id') id: string) {
    return this.chatGroupService.listMembers(id);
  }

  @Post(':id/members/:agentId')
  async addMember(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
  ) {
    return this.chatGroupService.addMember(id, agentId);
  }

  @Delete(':id/members/:agentId')
  async removeMember(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
  ) {
    const member = await this.chatGroupService.removeMember(id, agentId);
    if (!member) {
      throw new NotFoundException(
        `Member ${agentId} not found in group ${id}`,
      );
    }
    return member;
  }
}