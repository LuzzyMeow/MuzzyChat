import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';

interface MockPrismaTx {
  conversation: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

describe('ConversationService', () => {
  let service: ConversationService;

  const mockPrisma: MockPrismaTx & { $transaction: jest.Mock } = {
    conversation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(
      (cb: (_tx: MockPrismaTx) => Promise<unknown>) => cb(mockPrisma),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all non-deleted conversations ordered by createdAt desc', async () => {
      const conversations = [
        { id: '1', type: 'group', title: 'Test Group' },
      ];
      mockPrisma.conversation.findMany.mockResolvedValue(conversations);

      const result = await service.findAll();
      expect(result).toEqual(conversations);
      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        omit: { deletedAt: true },
      });
    });
  });

  describe('findById', () => {
    it('should find conversation by id', async () => {
      const conv = { id: '1', type: 'dm', title: 'DM' };
      mockPrisma.conversation.findFirst.mockResolvedValue(conv);
      expect(await service.findById('1')).toEqual(conv);
    });

    it('should return null when not found', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(null);
      expect(await service.findById('nonexistent')).toBeNull();
    });
  });

  describe('create', () => {
    it('should create conversation with type and optional title', async () => {
      const dto = { type: 'group' as const, title: 'My Group' };
      const created = { id: '1', ...dto };
      mockPrisma.conversation.create.mockResolvedValue(created);

      const result = await service.create(dto);
      expect(result).toEqual(created);
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'group', title: 'My Group' },
      });
    });

    it('should create conversation without title', async () => {
      const dto = { type: 'dm' as const };
      const created = { id: '2', type: 'dm', title: null };
      mockPrisma.conversation.create.mockResolvedValue(created);

      const result = await service.create(dto);
      expect(result).toEqual(created);
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'dm', title: null },
      });
    });
  });

  describe('update', () => {
    it('should update existing conversation', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue({
        id: '1',
        title: 'Old',
      });
      mockPrisma.conversation.update.mockResolvedValue({
        id: '1',
        title: 'New',
      });

      const result = await service.update('1', { title: 'New' });
      expect(result).toEqual({ id: '1', title: 'New' });
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: null },
        data: { title: 'New' },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(null);
      expect(await service.update('nonexistent', { title: 'New' })).toBeNull();
      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft delete conversation', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue({ id: '1' });
      mockPrisma.conversation.update.mockResolvedValue({
        id: '1',
        deletedAt: new Date(),
      });

      const result = await service.remove('1');
      expect(result).toBeDefined();
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(null);
      expect(await service.remove('nonexistent')).toBeNull();
      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });
  });
});