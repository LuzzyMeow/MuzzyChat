import { IsString, IsNotEmpty } from "class-validator";

export class UpsertSettingDto {
  @IsString()
  @IsNotEmpty()
  value!: string;
}
