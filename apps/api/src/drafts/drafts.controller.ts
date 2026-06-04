import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  RequestMethod,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import { Draft } from "@prisma/client";
import type { OutlineItem } from "@bytedance-aigc/shared";
import { Observable } from "rxjs";

import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import { UserGuard } from "../auth/user.guard";
import { DraftsService } from "./drafts.service";
import { OutlineService } from "./outline.service";
import { SectionsService, type StreamMessageEvent } from "./sections.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { OutlineRequestDto } from "./dto/outline-request.dto";
import { SectionsStreamDto } from "./dto/sections-stream.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";

@Controller("drafts")
@UseGuards(UserGuard)
export class DraftsController {
  constructor(
    private readonly drafts: DraftsService,
    private readonly outline: OutlineService,
    private readonly sections: SectionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDraftDto): Promise<Draft> {
    return this.drafts.create(user.sub, dto);
  }

  @Get()
  list(): Promise<Draft[]> {
    return this.drafts.list();
  }

  @Get("mine")
  findMine(@CurrentUser() user: JwtPayload): Promise<Draft[]> {
    return this.drafts.findByAuthor(user.sub);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<Draft> {
    return this.drafts.findOne(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDraftDto,
  ): Promise<Draft> {
    return this.drafts.update(id, user.sub, dto);
  }

  @Post(":id/outline")
  @HttpCode(HttpStatus.OK)
  generateOutline(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OutlineRequestDto,
  ): Promise<{ sections: OutlineItem[] }> {
    return this.outline.generate(id, user.sub, dto);
  }

  // @Sse 第二参显式声明 POST,让 NestJS 11 把 SSE 路由挂到 POST 而非默认 GET。
  // 选 POST 因为 sections 数组放 query 太长,而 EventSource 又不支持 GET 自定义 header
  // (鉴权 token 必须 fetch + ReadableStream 走 Authorization,与 POST 天然一致)。
  @Sse(":id/sections/stream", { [METHOD_METADATA]: RequestMethod.POST })
  @HttpCode(HttpStatus.OK)
  streamSections(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SectionsStreamDto,
  ): Promise<Observable<StreamMessageEvent>> {
    return this.sections.stream(id, user.sub, dto);
  }
}
