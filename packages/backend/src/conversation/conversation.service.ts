import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateConversationDto } from './dto/create-conversation.dto';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.conversation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      omit: { deletedAt: true },
    });
  }

  async findById(id: string) {
    return this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      omit: { deletedAt: true },
    });
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