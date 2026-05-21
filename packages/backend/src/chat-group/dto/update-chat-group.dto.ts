import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateChatGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsEnum(['parallel', 'supervisor'])
  orchestrationMode?: 'parallel' | 'supervisor';

  @IsOptional()
  @IsBoolean()
  dynamicDiscussionEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  supervisorAgentId?: string | null;
}