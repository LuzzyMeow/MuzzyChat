import { IsString, IsOptional, IsArray, IsNotEmpty, MaxLength, ValidateIf } from 'class-validator';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarDescription?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  systemPrompt?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  assignedModelId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];
}