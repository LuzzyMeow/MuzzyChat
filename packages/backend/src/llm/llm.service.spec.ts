import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { PrismaService } from '../prisma/prisma.service';

interface MockPrismaTx {
  providerModel: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
}

describe('LlmService', () => {
  let service: LlmService;

  const mockPrisma: MockPrismaTx & { $transaction: jest.Mock } = {
    providerModel: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefaultModelByRole', () => {
    it('should resolve big model from roleHints', async () => {
      const providerModel = {
        id: 'pm-1',
        modelId: 'gpt-4o',
        displayName: 'GPT-4o',
        tokenLimit: 4096,
        contextWindow: 128000,
        provider: {
          id: 'p-1',
          name: 'OpenAI',
          apiBase: 'https://api.openai.com/v1',
          apiKeyEncrypted: 'sk-test',
        },
      };
      mockPrisma.providerModel.findMany.mockResolvedValue([providerModel]);
      // findUnique is called by getModelByProviderModelId → resolveConfig
      mockPrisma.providerModel.findUnique.mockResolvedValue(providerModel);

      const model = await service.getDefaultModelByRole('big');
      expect(model).toBeDefined();
      expect(mockPrisma.providerModel.findMany).toHaveBeenCalledWith({
        where: { roleHints: { has: 'big' } },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
    });

    it('should throw when no model matches the role', async () => {
      mockPrisma.providerModel.findMany.mockResolvedValue([]);

      await expect(
        service.getDefaultModelByRole('small'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getModelByProviderModelId', () => {
    it('should cache and reuse model instances', async () => {
      const providerModel = {
        id: 'pm-2',
        modelId: 'claude-3',
        displayName: 'Claude 3',
        tokenLimit: 4096,
        contextWindow: 200000,
        provider: {
          id: 'p-2',
          name: 'Anthropic',
          apiBase: 'https://api.anthropic.com',
          apiKeyEncrypted: 'sk-ant-test',
        },
      };
      mockPrisma.providerModel.findUnique.mockResolvedValue(providerModel);

      const modelA = await service.getModelByProviderModelId('pm-2');
      const modelB = await service.getModelByProviderModelId('pm-2');

      expect(modelA).toBe(modelB);
      // findUnique called only once for the cache miss
      expect(mockPrisma.providerModel.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should throw when provider model is not found', async () => {
      mockPrisma.providerModel.findUnique.mockResolvedValue(null);

      await expect(
        service.getModelByProviderModelId('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invoke', () => {
    it('should invoke model and return string content', async () => {
      const mockModel = {
        invoke: jest.fn().mockResolvedValue({ content: 'Hello, world!' }),
      };

      const result = await service.invoke(mockModel as never, []);
      expect(result).toBe('Hello, world!');
    });

    it('should serialize non-string content to JSON', async () => {
      const mockModel = {
        invoke: jest.fn().mockResolvedValue({ content: { key: 'value' } }),
      };

      const result = await service.invoke(mockModel as never, []);
      expect(result).toBe('{"key":"value"}');
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear model cache', async () => {
      const providerModel = {
        id: 'pm-3',
        modelId: 'test-model',
        displayName: 'Test Model',
        tokenLimit: 1000,
        contextWindow: 8000,
        provider: {
          id: 'p-3',
          name: 'Test',
          apiBase: 'https://test.com',
          apiKeyEncrypted: 'sk-test',
        },
      };
      mockPrisma.providerModel.findUnique.mockResolvedValue(providerModel);

      await service.getModelByProviderModelId('pm-3');
      // Cache should be populated
      expect(mockPrisma.providerModel.findUnique).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();

      // After destroy, a new call should re-fetch
      await service.getModelByProviderModelId('pm-3');
      expect(mockPrisma.providerModel.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});