import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateChatGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsEnum(['parallel', 'supervisor'])
  orchestrationMode?: 'parallel' | 'supervisor';

  @IsOptional()
  @IsBoolean()
  dynamicDiscussionEnabled?: boolean;

  @IsOptional()
  @IsString()
  supervisorAgentId?: string;
}