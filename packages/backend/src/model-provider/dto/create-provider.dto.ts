import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class CreateProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsString()
  @IsNotEmpty()
  apiBase!: string;

  @IsString()
  @IsNotEmpty()
  apiKeyEncrypted!: string;
}
