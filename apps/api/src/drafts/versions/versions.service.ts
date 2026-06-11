import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DraftVersion, Prisma, VersionKind } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { CreateVersionKind } from "./dto/create-version.dto";

// 30 上限滚动:仅约束 AUTO 类型;NAMED + PUBLISHED 永不删。
const AUTO_RETENTION_LIMIT = 30;
// NAMED 防双击:同 draft 最近一个 NAMED 在 5 秒内则返回原版本(不重建)。
const NAMED_DEDUP_MS = 5 * 1000;

export type VersionDto = {
  id: string;
  kind: VersionKind;
  note: string | null;
  wordCount: number;
  createdAt: Date;
};

export type VersionDetailDto = VersionDto & {
  snapshot: Prisma.JsonValue;
};

@Injectable()
export class VersionsService {
  private readonly logger = new Logger(VersionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(draftId: string): Promise<VersionDto[]> {
    const rows = await this.prisma.draftVersion.findMany({
      where: { draftId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        note: true,
        wordCount: true,
        createdAt: true,
      },
    });
    return rows;
  }

  async findOne(draftId: string, versionId: string): Promise<VersionDetailDto> {
    const v = await this.prisma.draftVersion.findUnique({ where: { id: versionId } });
    if (!v || v.draftId !== draftId) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    return {
      id: v.id,
      kind: v.kind,
      note: v.note,
      wordCount: v.wordCount,
      createdAt: v.createdAt,
      snapshot: v.snapshot,
    };
  }

  /**
   * 显式建版本。Phase 2.14 起统一处理 NAMED + OFFLINE_CONFLICT 两类:
   * - NAMED:用户主动命名版本,snapshot 取当前 draft.body(由调用方传入),
   *   不允许自带 snapshot(controller 已用 draft.body),5 秒防双击。
   * - OFFLINE_CONFLICT:离线编辑回到线上发现冲突,把本地稿存为独立版本,
   *   必须自带 snapshot,不走防双击。
   */
  async createNamed(
    draftId: string,
    snapshot: Prisma.JsonValue,
    note: string | undefined,
    options: { kind?: CreateVersionKind; snapshot?: Prisma.JsonValue } = {},
  ): Promise<VersionDto> {
    const kind = options.kind ?? CreateVersionKind.NAMED;
    if (kind === CreateVersionKind.OFFLINE_CONFLICT && options.snapshot === undefined) {
      throw new BadRequestException("kind=OFFLINE_CONFLICT 必须带 snapshot");
    }
    if (kind === CreateVersionKind.NAMED && options.snapshot !== undefined) {
      throw new BadRequestException("kind=NAMED 不允许携带 snapshot");
    }
    const finalSnapshot = options.snapshot ?? snapshot;
    if (kind === CreateVersionKind.NAMED) {
      const recent = await this.prisma.draftVersion.findFirst({
        where: { draftId, kind: VersionKind.NAMED },
        orderBy: { createdAt: "desc" },
      });
      if (recent && Date.now() - recent.createdAt.getTime() < NAMED_DEDUP_MS) {
        return this.toDto(recent);
      }
    }
    const created = await this.prisma.draftVersion.create({
      data: {
        draftId,
        kind:
          kind === CreateVersionKind.OFFLINE_CONFLICT
            ? VersionKind.OFFLINE_CONFLICT
            : VersionKind.NAMED,
        snapshot: finalSnapshot as Prisma.InputJsonValue,
        note: note?.trim() || null,
        wordCount: this.countWords(finalSnapshot),
      },
    });
    return this.toDto(created);
  }

  /**
   * 恢复指定版本到 Draft.body,version 自增 +1。
   * 不自动建新版本(下次 PATCH 走 5 分钟节流的 AUTO 自然兜底)。
   */
  async restore(
    draftId: string,
    versionId: string,
  ): Promise<{ id: string; body: Prisma.JsonValue }> {
    const v = await this.prisma.draftVersion.findUnique({ where: { id: versionId } });
    if (!v || v.draftId !== draftId) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    const updated = await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        body: v.snapshot as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    return { id: updated.id, body: updated.body };
  }

  /**
   * 自动快照:5 分钟节流 + 完成后做 30 上限滚动删。
   * 不抛错(由调用方 update 钩子 try/catch 兜底,但这里也保守)。
   */
  async snapshotAuto(draftId: string, snapshot: Prisma.JsonValue): Promise<void> {
    await this.prisma.draftVersion.create({
      data: {
        draftId,
        kind: VersionKind.AUTO,
        snapshot: snapshot as Prisma.InputJsonValue,
        wordCount: this.countWords(snapshot),
      },
    });
    await this.pruneAutoOverflow(draftId);
  }

  /**
   * 发布时无条件建 PUBLISHED 版本。
   */
  async snapshotPublished(draftId: string, snapshot: Prisma.JsonValue): Promise<void> {
    await this.prisma.draftVersion.create({
      data: {
        draftId,
        kind: VersionKind.PUBLISHED,
        snapshot: snapshot as Prisma.InputJsonValue,
        wordCount: this.countWords(snapshot),
      },
    });
  }

  /**
   * 滚动删:仅 AUTO 类型,保留最新 N 个,其余删除。
   * NAMED + PUBLISHED 不进 query,永不删。
   */
  private async pruneAutoOverflow(draftId: string): Promise<void> {
    const overflow = await this.prisma.draftVersion.findMany({
      where: { draftId, kind: VersionKind.AUTO },
      orderBy: { createdAt: "desc" },
      skip: AUTO_RETENTION_LIMIT,
      select: { id: true },
    });
    if (overflow.length === 0) return;
    await this.prisma.draftVersion.deleteMany({
      where: { id: { in: overflow.map((r) => r.id) } },
    });
  }

  /**
   * 字数:递归取 ProseMirror JSON 里 type === 'text' 的 .text 字段总长。
   * 中英混合按 JS 字符数(够用,不要求精确)。
   */
  private countWords(snapshot: Prisma.JsonValue): number {
    let total = 0;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && typeof n.text === "string") {
        total += n.text.length;
      }
      if (Array.isArray(n.content)) {
        for (const child of n.content) walk(child);
      }
    };
    walk(snapshot);
    return total;
  }

  private toDto(v: DraftVersion): VersionDto {
    return {
      id: v.id,
      kind: v.kind,
      note: v.note,
      wordCount: v.wordCount,
      createdAt: v.createdAt,
    };
  }
}
