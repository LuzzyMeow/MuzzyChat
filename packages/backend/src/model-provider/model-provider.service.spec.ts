import { Test, TestingModule } from "@nestjs/testing";
import { ModelProviderService } from "./model-provider.service";
import { PrismaService } from "../prisma/prisma.service";
import { BadRequestException } from "@nestjs/common";

describe("ModelProviderService", () => {
  let service: ModelProviderService;
  let prisma: PrismaService;

  const mockProvider = {
    id: "prov_001",
    name: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    apiKeyEncrypted: "sk-test",
    createdAt: new Date(),
    updatedAt: new Date(),
    models: [],
  };

  const mockModel = {
    id: "model_001",
    providerId: "prov_001",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    tokenLimit: null,
    contextWindow: null,
    supportsFunctionCalling: true,
    roleHints: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelProviderService,
        {
          provide: PrismaService,
          useValue: {
            modelProvider: {
              findMany: jest.fn().mockResolvedValue([mockProvider]),
              findUnique: jest.fn().mockResolvedValue(mockProvider),
              create: jest.fn().mockResolvedValue(mockProvider),
              update: jest.fn().mockResolvedValue(mockProvider),
              delete: jest.fn().mockResolvedValue(mockProvider),
            },
            providerModel: {
              findMany: jest.fn().mockResolvedValue([mockModel]),
              findUnique: jest.fn().mockResolvedValue(mockModel),
              create: jest.fn().mockResolvedValue(mockModel),
              update: jest.fn().mockResolvedValue(mockModel),
              delete: jest.fn().mockResolvedValue(mockModel),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ModelProviderService>(ModelProviderService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe("Providers", () => {
    it("should list all providers", async () => {
      const result = await service.findAllProviders();
      expect(result).toEqual([mockProvider]);
      expect(prisma.modelProvider.findMany).toHaveBeenCalled();
    });

    it("should find provider by id", async () => {
      const result = await service.findProviderById("prov_001");
      expect(result).toEqual(mockProvider);
    });

    it("should create provider", async () => {
      const dto = { name: "OpenAI", apiBase: "https://api.openai.com/v1", apiKeyEncrypted: "sk-test" };
      const result = await service.createProvider(dto);
      expect(result).toEqual(mockProvider);
    });

    it("should update provider", async () => {
      const dto = { name: "Updated" };
      const result = await service.updateProvider("prov_001", dto);
      expect(result).toEqual(mockProvider);
    });

    it("should remove provider", async () => {
      const result = await service.removeProvider("prov_001");
      expect(result).toEqual(mockProvider);
    });
  });

  describe("Models", () => {
    it("should list models by provider", async () => {
      const result = await service.findModelsByProvider("prov_001");
      expect(result).toEqual([mockModel]);
    });

    it("should create model for provider", async () => {
      // Mock provider exists check
      (prisma.modelProvider.findUnique as jest.Mock).mockResolvedValueOnce(mockProvider);

      const dto = { modelId: "gpt-4o", displayName: "GPT-4o" };
      const result = await service.createModel("prov_001", dto);
      expect(result).toEqual(mockModel);
    });

    it("should throw when creating model for non-existent provider", async () => {
      (prisma.modelProvider.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const dto = { modelId: "gpt-4o", displayName: "GPT-4o" };
      await expect(service.createModel("prov_none", dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
