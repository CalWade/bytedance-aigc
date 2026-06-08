import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Draft, Prisma } from "@prisma/client";
import { VERSION_CONFLICT } from "@bytedance-aigc/shared";

import { PrismaService } from "../prisma/prisma.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";
import { VersionsService } from "./versions/versions.service";

@Injectable()
export class DraftsService {
  private readonly logger = new Logger(DraftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: VersionsService,
  ) {}

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

  /**
   * Phase 2.15:已 PUBLISHED 的稿件切回 DRAFT,作者继续二次编辑。
   * 显式状态转移端点(不复用 PATCH),version+1 让任何 /post/:id 客户端缓存自洽失效。
   */
  async edit(
    id: string,
    authorId: string,
  ): Promise<{ id: string; status: "DRAFT"; version: number }> {
    const cur = await this.assertAuthor(id, authorId);
    if (cur.status !== "PUBLISHED") {
      throw new ConflictException({
        code: "EDIT_NOT_ALLOWED",
        message: "仅 PUBLISHED 状态可进入二次编辑",
      });
    }
    const updated = await this.prisma.draft.update({
      where: { id },
      data: { status: "DRAFT", version: { increment: 1 } },
    });
    return { id: updated.id, status: "DRAFT", version: updated.version };
  }

  async update(id: string, authorId: string, dto: UpdateDraftDto): Promise<Draft> {
    const cur = await this.assertAuthor(id, authorId);
    // Phase 2.14:乐观并发。客户端带 baseVersion 时,后端比对当前 DB 版本;
    // 不一致 → 409 + VERSION_CONFLICT,前端进冲突 fork 流。不传则走老路径。
    if (dto.baseVersion !== undefined && dto.baseVersion !== cur.version) {
      throw new ConflictException({
        message: VERSION_CONFLICT,
        payload: {
          currentVersion: cur.version,
          title: cur.title,
          body: cur.body,
          updatedAt: cur.updatedAt.toISOString(),
        },
      });
    }
    const data: Prisma.DraftUpdateInput = {
      version: { increment: 1 },
    };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body as Prisma.InputJsonValue;
    const updated = await this.prisma.draft.update({ where: { id }, data });
    // WHY: 自动快照失败不能阻塞 update 主流程(用户的草稿是钱,版本是奢侈品)。
    // 5 分钟节流在 versions.service 内部判断。
    if (dto.body !== undefined) {
      try {
        await this.versions.snapshotAuto(id, updated.body);
      } catch (err) {
        this.logger.error(`snapshotAuto failed for draft ${id}`, err as Error);
      }
    }
    return updated;
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
    // WHY: 在状态机切到 PUBLISHED 之前快照,语义上"发布瞬间"。
    // 失败也不阻塞发布(同 update 钩子,版本是辅助产物)。
    try {
      await this.versions.snapshotPublished(id, draft.body);
    } catch (err) {
      this.logger.error(`snapshotPublished failed for draft ${id}`, err as Error);
    }
    const updated = await this.prisma.draft.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    return { id: updated.id, publishedAt: updated.publishedAt as Date };
  }
}
