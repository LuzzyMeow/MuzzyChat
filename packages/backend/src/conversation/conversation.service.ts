import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateConversationDto } from './dto/create-conversation.dto';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const conversations = await this.prisma.conversation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      omit: { deletedAt: true },
      include: {
        messages: {
          where: { role: { in: ['agent', 'user'] } },
          select: { agentId: true, role: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return conversations.map((c) => ({
      ...c,
      // For DM conversations, extract the participant agentId from the first message
      participantAgentId: c.type === 'dm'
        ? c.messages[0]?.agentId ?? null
        : null,
      messages: undefined,
    }));
  }

  async findById(id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      omit: { deletedAt: true },
      include: {
        messages: {
          where: { role: { in: ['agent', 'user'] } },
          select: { agentId: true, role: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation) return null;

    return {
      ...conversation,
      participantAgentId: conversation.type === 'dm'
        ? conversation.messages[0]?.agentId ?? null
        : null,
      messages: undefined,
    };
  }

  async create(dto: CreateConversationDto) {
    const conversation = await this.prisma.conversation.create({
      data: {
        type: dto.type,
        title: dto.title ?? null,
      },
    });
    this.logger.log(`Conversation created: ${conversation.id}`);
    return conversation;
  }

  async update(id: string, dto: UpdateConversationDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) return null;

      const updated = await tx.conversation.update({
        where: { id, deletedAt: null },
        data: dto,
      });
      this.logger.log(`Conversation updated: ${id}`);
      return updated;
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) return null;

      const removed = await tx.conversation.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      this.logger.log(`Conversation soft-deleted: ${id}`);
      return removed;
    });
  }
}