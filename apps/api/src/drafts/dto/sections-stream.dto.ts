import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

class OutlineItemDto {
  @IsString() heading!: string;
  @IsString() summary!: string;
  @IsOptional() @IsString() hint?: string;
}

/**
 * SSE 流式 sections 入参。前端在 outline 阶段拿到 sections 数组,
 * 这里把它整段回传(不入库),后端按节生成正文。
 * cursor 可选:断流续传场景下的下一个待生成 section index。
 */
export class SectionsStreamDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OutlineItemDto)
  sections!: OutlineItemDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  cursor?: number;
}
