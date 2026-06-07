import {
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import { UserGuard } from "../auth/user.guard";
import { AssetsService } from "./assets.service";

@Controller("assets")
@UseGuards(UserGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async upload(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    const asset = await this.assets.upload(user.sub, file);
    return {
      id: asset.id,
      key: asset.key,
      url: asset.url,
      mime: asset.mime,
      size: asset.size,
    };
  }

  @Get("mine")
  async listMine(@CurrentUser() user: JwtPayload, @Query("limit") limit?: string) {
    const n = limit ? Math.max(1, Math.min(100, Number.parseInt(limit, 10))) : 20;
    const items = await this.assets.listMine(user.sub, Number.isFinite(n) ? n : 20);
    return { items };
  }
}
