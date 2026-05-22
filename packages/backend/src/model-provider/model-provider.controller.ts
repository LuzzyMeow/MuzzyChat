import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ModelProviderService } from "./model-provider.service";
import {
  CreateProviderDto,
  UpdateProviderDto,
  CreateModelDto,
  UpdateModelDto,
} from "./dto";

@Controller("providers")
export class ModelProviderController {
  constructor(private readonly service: ModelProviderService) {}

  // ─── Provider endpoints ──────────────────────────────────────

  @Get()
  async findAllProviders() {
    return this.service.findAllProviders();
  }

  @Get(":id")
  async findProviderById(@Param("id") id: string) {
    const provider = await this.service.findProviderById(id);
    if (!provider) {
      throw new NotFoundException(`Provider ${id} not found`);
    }
    return provider;
  }

  @Post()
  async createProvider(@Body() dto: CreateProviderDto) {
    return this.service.createProvider(dto);
  }

  @Patch(":id")
  async updateProvider(
    @Param("id") id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    try {
      return await this.service.updateProvider(id, dto);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new NotFoundException(`Provider ${id} not found`);
    }
  }

  @Delete(":id")
  async removeProvider(@Param("id") id: string) {
    try {
      return await this.service.removeProvider(id);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new NotFoundException(`Provider ${id} not found`);
    }
  }

  // ─── Model endpoints (nested under provider) ─────────────────

  @Get(":providerId/models")
  async findModels(@Param("providerId") providerId: string) {
    // Verify provider exists
    const provider = await this.service.findProviderById(providerId);
    if (!provider) {
      throw new NotFoundException(`Provider ${providerId} not found`);
    }
    return this.service.findModelsByProvider(providerId);
  }

  @Post(":providerId/models")
  async createModel(
    @Param("providerId") providerId: string,
    @Body() dto: CreateModelDto,
  ) {
    return this.service.createModel(providerId, dto);
  }

  @Patch(":providerId/models/:id")
  async updateModel(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() dto: UpdateModelDto,
  ) {
    // Verify model belongs to provider
    const model = await this.service.findModelById(id);
    if (!model || model.providerId !== providerId) {
      throw new NotFoundException(
        `Model ${id} not found under provider ${providerId}`,
      );
    }
    return this.service.updateModel(id, dto);
  }

  @Delete(":providerId/models/:id")
  async removeModel(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
  ) {
    // Verify model belongs to provider
    const model = await this.service.findModelById(id);
    if (!model || model.providerId !== providerId) {
      throw new NotFoundException(
        `Model ${id} not found under provider ${providerId}`,
      );
    }
    return this.service.removeModel(id);
  }
}
