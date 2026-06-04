import { IsIn, IsObject, IsOptional, IsString } from "class-validator";
import { DRAFT_TOOL_TYPES, type DraftToolType } from "@bytedance-aigc/shared";

/**
 * 外壳 DTO。Plan D1:input 内层结构按 tool 各异,这里只校验外壳,
 * service 入口手写 narrow(避免 class-transformer discriminator 复杂度)。
 */
export class ToolInvokeDto {
  @IsIn(DRAFT_TOOL_TYPES as readonly string[])
  tool!: DraftToolType;

  @IsObject()
  input!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  promptId?: string;
}
