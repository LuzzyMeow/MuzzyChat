import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsEnum(['group', 'dm'])
  type!: 'group' | 'dm';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}