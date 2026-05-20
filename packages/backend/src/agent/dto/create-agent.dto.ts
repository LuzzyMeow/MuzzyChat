import { IsString, IsOptional, IsArray, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarDescription?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  systemPrompt!: string;

  @IsOptional()
  @IsString()
  assignedModelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];
}