import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateChatGroupDto } from './dto/create-chat-group.dto';
import type { UpdateChatGroupDto } from './dto/update-chat-group.dto';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class ChatGroupService {
  private readonly logger = new Logger(ChatGroupService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Group CRUD ──────────────────────────────────────────────

  async findAll() {
    return this.prisma.chatGroup.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: { omit: { deletedAt: true } },
        supervisorAgent: { omit: { deletedAt: true } },
        members: { include: { agent: { omit: { deletedAt: true } } } },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.chatGroup.findFirst({
      where: { id, deletedAt: null },
      include: {
        conversation: { omit: { deletedAt: true } },
        supervisorAgent: { omit: { deletedAt: true } },
        members: { include: { agent: { omit: { deletedAt: true } } } },
      },
    });
  }

  async create(dto: CreateChatGroupDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Step 1: Create the Conversation record
        const conversation = await tx.conversation.create({
          data: {
            type: 'group',
            title: dto.name,
          },
        });

        // Step 2: Create the ChatGroup record
        const group = await tx.chatGroup.create({
          data: {
            conversationId: conversation.id,
            name: dto.name,
            orchestrationMode: dto.orchestrationMode ?? 'parallel',
            dynamicDiscussionEnabled: dto.dynamicDiscussionEnabled ?? false,
            supervisorAgentId: dto.supervisorAgentId ?? null,
          },
          include: {
            conversation: true,
          },
        });

        this.logger.log(
          `ChatGroup created: ${group.id} (conv: ${conversation.id})`,
        );
        return group;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          `Invalid reference: ${dto.supervisorAgentId}`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateChatGroupDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.chatGroup.findFirst({
          where: { id, deletedAt: null },
        });
        if (!existing) return null;

        const data: Prisma.ChatGroupUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.orchestrationMode !== undefined) data.orchestrationMode = dto.orchestrationMode;
        if (dto.dynamicDiscussionEnabled !== undefined)
          data.dynamicDiscussionEnabled = dto.dynamicDiscussionEnabled;
        if (dto.supervisorAgentId !== undefined) {
          if (dto.supervisorAgentId === null) {
            data.supervisorAgent = { disconnect: true };
          } else {
            data.supervisorAgent = { connect: { id: dto.supervisorAgentId } };
          }
        }

        const updated = await tx.chatGroup.update({
          where: { id, deletedAt: null },
          data,
          include: {
            conversation: true,
            supervisorAgent: true,
          },
        });
        this.logger.log(`ChatGroup updated: ${id}`);
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          `Invalid reference: ${dto.supervisorAgentId}`,
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.chatGroup.findFirst({
        where: { id, deletedAt: null },
        select: { conversationId: true },
      });
      if (!existing) return null;

      // Soft-delete ChatGroup and its Conversation together
      const [removed] = await Promise.all([
        tx.chatGroup.update({
          where: { id, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        tx.conversation.update({
          where: { id: existing.conversationId },
          data: { deletedAt: new Date() },
        }),
      ]);
      this.logger.log(`ChatGroup soft-deleted: ${id}`);
      return removed;
    });
  }

  // ── Members management ──────────────────────────────────────

  private async findGroupOrThrow(id: string) {
    const group = await this.prisma.chatGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!group) {
      throw new NotFoundException(`ChatGroup ${id} not found`);
    }
    return group;
  }

  async addMember(groupId: string, agentId: string) {
    await this.findGroupOrThrow(groupId);
    try {
      const member = await this.prisma.groupMember.create({
        data: { groupId, agentId },
        include: { agent: true },
      });
      this.logger.log(`Agent ${agentId} joined group ${groupId}`);
      return member;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Agent ${agentId} is already a member of this group`,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          `Invalid reference: group ${groupId} or agent ${agentId} not found`,
        );
      }
      throw error;
    }
  }

  async removeMember(groupId: string, agentId: string) {
    await this.findGroupOrThrow(groupId);
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_agentId: { groupId, agentId } },
    });
    if (!member) return null;

    await this.prisma.groupMember.delete({
      where: { groupId_agentId: { groupId, agentId } },
    });
    this.logger.log(`Agent ${agentId} removed from group ${groupId}`);
    return member;
  }

  async listMembers(groupId: string) {
    await this.findGroupOrThrow(groupId);
    return this.prisma.groupMember.findMany({
      where: { groupId },
      include: { agent: { omit: { deletedAt: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }
}