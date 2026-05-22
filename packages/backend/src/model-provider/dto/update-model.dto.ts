import { IsString, IsOptional, IsBoolean, IsInt, IsArray, MaxLength } from "class-validator";

export class UpdateModelDto {
  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsInt()
  tokenLimit?: number;

  @IsOptional()
  @IsInt()
  contextWindow?: number;

  @IsOptional()
  @IsBoolean()
  supportsFunctionCalling?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleHints?: string[];
}
