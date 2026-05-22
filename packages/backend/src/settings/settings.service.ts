import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.settings.findUnique({
      where: { key },
    });
    return setting?.value ?? null;
  }

  async set(key: string, value: string): Promise<{ key: string; value: string }> {
    const setting = await this.prisma.settings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return { key: setting.key, value: setting.value };
  }

  async delete(key: string): Promise<void> {
    await this.prisma.settings.delete({ where: { key } });
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.prisma.settings.findMany();
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  }
}
