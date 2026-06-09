import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsString, MaxLength, MinLength } from "class-validator";

import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import { UserGuard } from "../auth/user.guard";
import { AssetsService } from "./assets.service";

class GenerateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  prompt!: string;
}

class RecommendDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

@Controller("assets")
@UseGuards(UserGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Query("aiDeclared") aiDeclared?: string,
  ) {
    const asset = await this.assets.upload(user.sub, file, {
      aiDeclared: aiDeclared === "true",
    });
    return {
      id: asset.id,
      key: asset.key,
      url: asset.url,
      mime: asset.mime,
      size: asset.size,
      reviewStatus: asset.reviewStatus,
    };
  }

  @Get("mine")
  async listMine(@CurrentUser() user: JwtPayload, @Query("limit") limit?: string) {
    const n = limit ? Math.max(1, Math.min(100, Number.parseInt(limit, 10))) : 20;
    const items = await this.assets.listMine(user.sub, Number.isFinite(n) ? n : 20);
    return { items };
  }

  @Post("generate")
  async generate(@CurrentUser() user: JwtPayload, @Body() dto: GenerateDto) {
    const asset = await this.assets.generateAi(user.sub, dto.prompt);
    return {
      id: asset.id,
      key: asset.key,
      url: asset.url,
      mime: asset.mime,
      size: asset.size,
      aiGenerated: asset.aiGenerated,
      aiPrompt: asset.aiPrompt,
      sceneTags: asset.sceneTags,
      subjectTags: asset.subjectTags,
      reviewStatus: asset.reviewStatus,
    };
  }

  @Get("search")
  async search(
    @CurrentUser() user: JwtPayload,
    @Query("scene") scene?: string,
    @Query("subject") subject?: string,
    @Query("aiOnly") aiOnly?: string,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    const items = await this.assets.search(user.sub, {
      scene: scene || undefined,
      subject: subject || undefined,
      aiOnly: aiOnly === "true",
      limit: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    });
    return { items };
  }

  @Post("recommend")
  async recommend(@CurrentUser() user: JwtPayload, @Body() dto: RecommendDto) {
    const items = await this.assets.recommendForBody(user.sub, dto.body);
    return { items };
  }

  /** PRD §4.6.1 插入文章前合规校验 */
  @Post(":id/check-for-insert")
  async checkForInsert(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.assets.checkForInsert(user.sub, id);
  }
}
