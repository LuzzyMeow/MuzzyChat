import { Test, TestingModule } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { PrismaService } from '../prisma/prisma.service';

// Minimal type for the mock that satisfies PrismaService usage in AgentService
interface MockPrismaTx {
  agent: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

describe('AgentService', () => {
  let service: AgentService;

  // Interactive transaction mock: $transaction(cb) executes cb(tx) where tx === mockPrisma
  const mockPrisma: MockPrismaTx & { $transaction: jest.Mock } = {
    agent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(
      (cb: (_tx: MockPrismaTx) => unknown): unknown => cb(mockPrisma),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all non-deleted agents ordered by createdAt desc', async () => {
      const agents = [{ id: '1', name: 'Test' }];
      mockPrisma.agent.findMany.mockResolvedValue(agents);

      const result = await service.findAll();
      expect(result).toEqual(agents);
      expect(mockPrisma.agent.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        omit: { deletedAt: true },
      });
    });
  });

  describe('findById', () => {
    it('should find agent by id', async () => {
      const agent = { id: '1', name: 'Test' };
      mockPrisma.agent.findFirst.mockResolvedValue(agent);

      const result = await service.findById('1');
      expect(result).toEqual(agent);
    });

    it('should return null when not found', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create agent with provided fields', async () => {
      const dto = { name: 'NewAgent', systemPrompt: 'You are helpful.' };
      const created = { id: '1', name: 'NewAgent', systemPrompt: 'You are helpful.', tools: [] };
      mockPrisma.agent.create.mockResolvedValue(created);

      const result = await service.create(dto);
      expect(result).toEqual(created);
      expect(mockPrisma.agent.create).toHaveBeenCalledWith({
        data: {
          name: 'NewAgent',
          avatarDescription: null,
          systemPrompt: 'You are helpful.',
          assignedModelId: null,
          tools: [],
        },
      });
    });

    it('should create agent with all optional fields', async () => {
      const dto = {
        name: 'FullAgent',
        systemPrompt: 'You are a coder.',
        avatarDescription: 'A friendly robot',
        assignedModelId: 'model-1',
        tools: ['read_file', 'write_file'],
      };
      mockPrisma.agent.create.mockResolvedValue({ id: '2', ...dto });

      const result = await service.create(dto);
      expect(result).toEqual({ id: '2', ...dto });
      expect(mockPrisma.agent.create).toHaveBeenCalledWith({
        data: dto,
      });
    });
  });

  describe('update', () => {
    it('should update existing agent within transaction', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: '1', name: 'Old' });
      mockPrisma.agent.update.mockResolvedValue({ id: '1', name: 'New' });

      const result = await service.update('1', { name: 'New' });
      expect(result).toEqual({ id: '1', name: 'New' });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: null },
      });
      expect(mockPrisma.agent.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { name: 'New' },
      });
    });

    it('should return null when agent not found', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const result = await service.update('nonexistent', { name: 'New' });
      expect(result).toBeNull();
      // Verify update was never called since agent was not found
      expect(mockPrisma.agent.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft delete agent within transaction', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: '1' });
      mockPrisma.agent.update.mockResolvedValue({ id: '1', deletedAt: new Date() });

      const result = await service.remove('1');
      expect(result).toBeDefined();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.agent.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should return null when agent not found', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const result = await service.remove('nonexistent');
      expect(result).toBeNull();
      expect(mockPrisma.agent.update).not.toHaveBeenCalled();
    });

    it('should return null when agent is already soft-deleted', async () => {
      // findFirst with deletedAt: null will not find a deleted agent
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      const result = await service.remove('already-deleted');
      expect(result).toBeNull();
      expect(mockPrisma.agent.update).not.toHaveBeenCalled();
    });
  });
});