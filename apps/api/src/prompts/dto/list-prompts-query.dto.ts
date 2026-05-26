import { IsEnum, IsOptional } from "class-validator";
import { DraftToolType } from "@prisma/client";

export class ListPromptsQueryDto {
  @IsOptional()
  @IsEnum(DraftToolType)
  tool?: DraftToolType;
}
