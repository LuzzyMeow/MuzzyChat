import { IsString, IsOptional, IsArray, IsNotEmpty, MaxLength } from 'class-validator';

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
  @MaxLength(4000)
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  assignedModelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];
}