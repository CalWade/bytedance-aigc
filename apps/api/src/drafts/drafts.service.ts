import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Draft, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(authorId: string, dto: CreateDraftDto): Promise<Draft> {
    return this.prisma.draft.create({
      data: {
        authorId,
        title: dto.title,
        body: dto.body as Prisma.InputJsonValue,
        mode: dto.mode,
      },
    });
  }

  async list(): Promise<Draft[]> {
    return this.prisma.draft.findMany({
      orderBy: { updatedAt: "desc" },
    });
  }

  async findByAuthor(authorId: string): Promise<Draft[]> {
    return this.prisma.draft.findMany({
      where: { authorId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: string): Promise<Draft> {
    const draft = await this.prisma.draft.findUnique({ where: { id } });
    if (!draft) {
      throw new NotFoundException(`Draft ${id} not found`);
    }
    return draft;
  }

  /**
   * 校验草稿存在且作者匹配,常被 update / outline / sections / tools 几路共用。
   * Plan Task 4 抽出后置为 public(YAGNI:写 helper 类不如改两个字符)。
   */
  async assertAuthor(id: string, authorId: string): Promise<Draft> {
    const draft = await this.prisma.draft.findUnique({ where: { id } });
    if (!draft) {
      throw new NotFoundException(`Draft ${id} not found`);
    }
    if (draft.authorId !== authorId) {
      throw new ForbiddenException("Not the draft author");
    }
    return draft;
  }

  async update(id: string, authorId: string, dto: UpdateDraftDto): Promise<Draft> {
    await this.assertAuthor(id, authorId);
    const data: Prisma.DraftUpdateInput = {
      version: { increment: 1 },
    };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body as Prisma.InputJsonValue;
    return this.prisma.draft.update({ where: { id }, data });
  }

  /**
   * Phase 2.3 — 草稿发布。状态机:必须有最近一次 PREFLIGHT review,
   * 推荐值不能是 BLOCK,且 24h 内有效;否则 409 + code 区分原因。
   */
  async publish(id: string, authorId: string): Promise<{ id: string; publishedAt: Date }> {
    await this.assertAuthor(id, authorId);
    const draft = await this.prisma.draft.findUnique({
      where: { id },
      include: { lastReview: true },
    });
    if (!draft) {
      throw new NotFoundException(`Draft ${id} not found`);
    }
    const r = draft.lastReview;
    if (!r || r.stage !== "PREFLIGHT") {
      throw new ConflictException({ code: "PREFLIGHT_REQUIRED", message: "请先点预检" });
    }
    if (r.recommendation === "BLOCK") {
      throw new ConflictException({
        code: "PREFLIGHT_BLOCKED",
        message: "上次预检结果为 BLOCK,请修改后重试",
      });
    }
    if (Date.now() - r.createdAt.getTime() > 24 * 3600 * 1000) {
      throw new ConflictException({
        code: "PREFLIGHT_EXPIRED",
        message: "预检结果已过 24 小时,请重新预检",
      });
    }
    const updated = await this.prisma.draft.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    return { id: updated.id, publishedAt: updated.publishedAt as Date };
  }
}
