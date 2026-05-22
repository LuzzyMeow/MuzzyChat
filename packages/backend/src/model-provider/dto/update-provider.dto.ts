import { IsString, IsOptional, MaxLength } from "class-validator";

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  apiBase?: string;

  @IsOptional()
  @IsString()
  apiKeyEncrypted?: string;
}
