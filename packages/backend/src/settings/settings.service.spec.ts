import { Test, TestingModule } from "@nestjs/testing";
import { SettingsService } from "./settings.service";
import { PrismaService } from "../prisma/prisma.service";

describe("SettingsService", () => {
  let service: SettingsService;
  let prisma: PrismaService;

  const mockSetting = { key: "test.key", value: "test-value", updatedAt: new Date() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: PrismaService,
          useValue: {
            settings: {
              findUnique: jest.fn().mockResolvedValue(mockSetting),
              findMany: jest.fn().mockResolvedValue([mockSetting]),
              upsert: jest.fn().mockResolvedValue(mockSetting),
              delete: jest.fn().mockResolvedValue(mockSetting),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it("should get a setting value", async () => {
    const result = await service.get("test.key");
    expect(result).toBe("test-value");
  });

  it("should return null for missing setting", async () => {
    (prisma.settings.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const result = await service.get("missing.key");
    expect(result).toBeNull();
  });

  it("should set a setting value", async () => {
    const result = await service.set("test.key", "new-value");
    expect(result).toEqual({ key: "test.key", value: "test-value" });
  });

  it("should get all settings", async () => {
    const result = await service.getAll();
    expect(result).toEqual({ "test.key": "test-value" });
  });

  it("should delete a setting", async () => {
    await service.delete("test.key");
    expect(prisma.settings.delete).toHaveBeenCalledWith({ where: { key: "test.key" } });
  });
});
