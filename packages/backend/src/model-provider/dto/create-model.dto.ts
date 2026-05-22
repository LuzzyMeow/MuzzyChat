import { IsString, IsOptional, IsBoolean, IsInt, IsArray, IsNotEmpty, MaxLength } from "class-validator";

export class CreateModelDto {
  @IsString()
  @IsNotEmpty()
  modelId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

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
