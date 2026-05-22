import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { UpsertSettingDto } from "./dto";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getAll() {
    return this.settingsService.getAll();
  }

  @Get(":key")
  async get(@Param("key") key: string) {
    const value = await this.settingsService.get(key);
    if (value === null) {
      throw new NotFoundException(`Setting '${key}' not found`);
    }
    return { key, value };
  }

  @Put(":key")
  async set(
    @Param("key") key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.settingsService.set(key, dto.value);
  }

  @Delete(":key")
  async delete(@Param("key") key: string) {
    try {
      await this.settingsService.delete(key);
      return { success: true };
    } catch {
      throw new NotFoundException(`Setting '${key}' not found`);
    }
  }
}
