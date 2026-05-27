import { IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}
