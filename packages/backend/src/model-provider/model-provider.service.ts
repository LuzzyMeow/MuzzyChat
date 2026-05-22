import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateProviderDto } from "./dto/create-provider.dto";
import type { UpdateProviderDto } from "./dto/update-provider.dto";
import type { CreateModelDto } from "./dto/create-model.dto";
import type { UpdateModelDto } from "./dto/update-model.dto";

@Injectable()
export class ModelProviderService {
  private readonly logger = new Logger(ModelProviderService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Provider CRUD ───────────────────────────────────────────

  async findAllProviders() {
    return this.prisma.modelProvider.findMany({
      include: { models: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findProviderById(id: string) {
    return this.prisma.modelProvider.findUnique({
      where: { id },
      include: { models: true },
    });
  }

  async createProvider(dto: CreateProviderDto) {
    try {
      return await this.prisma.modelProvider.create({
        data: dto,
        include: { models: true },
      });
    } catch (error) {
      this.handlePrismaError(error, "Provider");
    }
  }

  async updateProvider(id: string, dto: UpdateProviderDto) {
    try {
      return await this.prisma.modelProvider.update({
        where: { id },
        data: dto,
        include: { models: true },
      });
    } catch (error) {
      this.handlePrismaError(error, "Provider");
    }
  }

  async removeProvider(id: string) {
    try {
      return await this.prisma.modelProvider.delete({
        where: { id },
      });
    } catch (error) {
      this.handlePrismaError(error, "Provider");
    }
  }

  // ─── Model CRUD ──────────────────────────────────────────────

  async findModelsByProvider(providerId: string) {
    return this.prisma.providerModel.findMany({
      where: { providerId },
      orderBy: { createdAt: "asc" },
    });
  }

  async findModelById(id: string) {
    return this.prisma.providerModel.findUnique({
      where: { id },
      include: { provider: true },
    });
  }

  async createModel(providerId: string, dto: CreateModelDto) {
    // Verify provider exists
    const provider = await this.prisma.modelProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new BadRequestException(`Provider ${providerId} not found`);
    }

    try {
      return await this.prisma.providerModel.create({
        data: { ...dto, providerId },
      });
    } catch (error) {
      this.handlePrismaError(error, "Model");
    }
  }

  async updateModel(id: string, dto: UpdateModelDto) {
    try {
      return await this.prisma.providerModel.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      this.handlePrismaError(error, "Model");
    }
  }

  async removeModel(id: string) {
    try {
      return await this.prisma.providerModel.delete({
        where: { id },
      });
    } catch (error) {
      this.handlePrismaError(error, "Model");
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private handlePrismaError(
    error: unknown,
    entity: "Provider" | "Model",
  ): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2025"
    ) {
      throw new BadRequestException(`${entity} not found`);
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new BadRequestException(
        `${entity} with this identifier already exists`,
      );
    }
    this.logger.error(`Failed to operate on ${entity}`, error);
    throw error;
  }
}
