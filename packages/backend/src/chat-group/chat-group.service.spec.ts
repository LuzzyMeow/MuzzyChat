import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChatGroupService } from './chat-group.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

interface MockPrismaTx {
  conversation: {
    create: jest.Mock;
    update: jest.Mock;
  };
  chatGroup: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  groupMember: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    delete: jest.Mock;
  };
}

describe('ChatGroupService', () => {
  let service: ChatGroupService;

  const mockPrisma: MockPrismaTx & { $transaction: jest.Mock } = {
    conversation: {
      create: jest.fn(),
      update: jest.fn(),
    },
    chatGroup: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    groupMember: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(
      (cb: (_tx: MockPrismaTx) => Promise<unknown>) => cb(mockPrisma),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGroupService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ChatGroupService>(ChatGroupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all non-deleted groups', async () => {
      const groups = [{ id: '1', name: 'Test Group' }];
      mockPrisma.chatGroup.findMany.mockResolvedValue(groups);

      const result = await service.findAll();
      expect(result).toEqual(groups);
      expect(mockPrisma.chatGroup.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          conversation: { omit: { deletedAt: true } },
          supervisorAgent: { omit: { deletedAt: true } },
          members: { include: { agent: { omit: { deletedAt: true } } } },
        },
      });
    });
  });

  describe('create', () => {
    it('should create conversation and chat group in transaction', async () => {
      mockPrisma.conversation.create.mockResolvedValue({
        id: 'conv-1',
        type: 'group',
        title: 'My Group',
      });
      mockPrisma.chatGroup.create.mockResolvedValue({
        id: 'group-1',
        name: 'My Group',
        conversation: { id: 'conv-1' },
      });

      const result = await service.create({ name: 'My Group' });
      expect(result).toBeDefined();
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'group', title: 'My Group' },
      });
      expect(mockPrisma.chatGroup.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          name: 'My Group',
          orchestrationMode: 'parallel',
          dynamicDiscussionEnabled: false,
          supervisorAgentId: null,
        },
        include: { conversation: true },
      });
    });

    it('should throw BadRequestException when supervisorAgentId is invalid', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '7.8.0' },
      );
      mockPrisma.$transaction.mockRejectedValueOnce(prismaError);

      await expect(
        service.create({
          name: 'Group',
          supervisorAgentId: 'invalid-agent',
        }),
      ).rejects.toThrow(/Invalid reference/);
    });
  });

  describe('update', () => {
    it('should update existing group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      mockPrisma.chatGroup.update.mockResolvedValue({
        id: 'group-1',
        name: 'Updated',
      });

      const result = await service.update('group-1', { name: 'Updated' });
      expect(result).toBeDefined();
      expect(mockPrisma.chatGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'group-1', deletedAt: null },
        }),
      );
    });

    it('should return null when not found', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue(null);
      expect(
        await service.update('nonexistent', { name: 'Updated' }),
      ).toBeNull();
    });

    it('should disconnect supervisor when supervisorAgentId is null', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      mockPrisma.chatGroup.update.mockResolvedValue({
        id: 'group-1',
        supervisorAgentId: null,
      });

      const result = await service.update('group-1', { supervisorAgentId: null });
      expect(result).toBeDefined();
      expect(mockPrisma.chatGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supervisorAgent: { disconnect: true },
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('should soft delete group and conversation', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({
        id: 'group-1',
        conversationId: 'conv-1',
      });
      mockPrisma.chatGroup.update.mockResolvedValue({
        id: 'group-1',
        deletedAt: new Date(),
      });
      mockPrisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        deletedAt: new Date(),
      });

      const result = await service.remove('group-1');
      expect(result).toBeDefined();
      expect(mockPrisma.chatGroup.update).toHaveBeenCalled();
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue(null);
      expect(await service.remove('nonexistent')).toBeNull();
    });
  });

  describe('members', () => {
    it('should add member to group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      mockPrisma.groupMember.create.mockResolvedValue({
        id: 'mem-1',
        groupId: 'group-1',
        agentId: 'agent-1',
        agent: { id: 'agent-1', name: 'Test' },
      });

      const result = await service.addMember('group-1', 'agent-1');
      expect(result).toBeDefined();
      expect(mockPrisma.groupMember.create).toHaveBeenCalledWith({
        data: { groupId: 'group-1', agentId: 'agent-1' },
        include: { agent: true },
      });
    });

    it('should throw NotFoundException when adding member to nonexistent group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember('nonexistent', 'agent-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when adding duplicate member', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      mockPrisma.groupMember.create.mockRejectedValue(prismaError);

      await expect(
        service.addMember('group-1', 'agent-1'),
      ).rejects.toThrow(/already a member/);
    });

    it('should list members of group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      const members = [{ id: 'mem-1', groupId: 'group-1', agentId: 'agent-1' }];
      mockPrisma.groupMember.findMany.mockResolvedValue(members);

      const result = await service.listMembers('group-1');
      expect(result).toEqual(members);
      expect(mockPrisma.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1' },
        include: { agent: { omit: { deletedAt: true } } },
        orderBy: { joinedAt: 'asc' },
      });
    });

    it('should throw NotFoundException when listing members of nonexistent group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.listMembers('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should remove member from group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        groupId: 'group-1',
        agentId: 'agent-1',
      });
      mockPrisma.groupMember.delete.mockResolvedValue({
        id: 'mem-1',
      });

      const result = await service.removeMember('group-1', 'agent-1');
      expect(result).toBeDefined();
      expect(mockPrisma.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_agentId: { groupId: 'group-1', agentId: 'agent-1' } },
      });
    });

    it('should throw NotFoundException when removing member from nonexistent group', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('nonexistent', 'agent-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return null when removing non-member', async () => {
      mockPrisma.chatGroup.findFirst.mockResolvedValue({ id: 'group-1' });
      mockPrisma.groupMember.findUnique.mockResolvedValue(null);
      expect(
        await service.removeMember('group-1', 'non-member'),
      ).toBeNull();
      expect(mockPrisma.groupMember.delete).not.toHaveBeenCalled();
    });
  });
});