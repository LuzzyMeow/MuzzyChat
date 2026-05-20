import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAgentDto } from './dto/create-agent.dto';
import type { UpdateAgentDto } from './dto/update-agent.dto';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.agent.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      omit: { deletedAt: true },
    });
  }

  async findById(id: string) {
    return this.prisma.agent.findFirst({
      where: { id, deletedAt: null },
      omit: { deletedAt: true },
    });
  }

  async create(dto: CreateAgentDto) {
    try {
      const agent = await this.prisma.agent.create({
        data: {
          name: dto.name,
          avatarDescription: dto.avatarDescription ?? null,
          systemPrompt: dto.systemPrompt,
          assignedModelId: dto.assignedModelId ?? null,
          tools: dto.tools ?? [],
        },
      });
      this.logger.log(`Agent created: ${agent.id} (${agent.name})`);
      return agent;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          `assignedModelId not found: ${dto.assignedModelId}`,
        );
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create agent: ${msg}`);
      throw error;
    }
  }

  async update(id: string, dto: UpdateAgentDto) {
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findFirst({
        where: { id, deletedAt: null },
      });
      if (!agent) return null;

      const updated = await tx.agent.update({
        where: { id },
        data: dto,
      });
      this.logger.log(`Agent updated: ${id}`);
      return updated;
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findFirst({
        where: { id, deletedAt: null },
      });
      if (!agent) return null;

      const removed = await tx.agent.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      this.logger.log(`Agent soft-deleted: ${id}`);
      return removed;
    });
  }
}