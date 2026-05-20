import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  const mock$connect = jest.fn().mockResolvedValue(undefined);
  const mock$disconnect = jest.fn().mockResolvedValue(undefined);
  const mockPoolEnd = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);

    service.$connect = mock$connect;
    service.$disconnect = mock$disconnect;
    (service as any).pool = { end: mockPoolEnd };

    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw if DATABASE_URL is not set', () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    expect(() => {
      new (require('./prisma.service').PrismaService)();
    }).toThrow('DATABASE_URL environment variable is not set');

    process.env.DATABASE_URL = original;
  });

  it('should connect on module init', async () => {
    await service.onModuleInit();
    expect(mock$connect).toHaveBeenCalled();
  });

  it('should disconnect and close pool on module destroy', async () => {
    await service.onModuleDestroy();
    expect(mock$disconnect).toHaveBeenCalled();
    expect(mockPoolEnd).toHaveBeenCalled();
  });
});
