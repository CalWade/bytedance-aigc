import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  computeScore,
  hotnessMockBase,
  normalizeHotness,
  TAU_HOURS,
  WINDOW_HOURS,
  DEFAULT_FEED_WEIGHTS,
  type FeedMode,
  type FeedWeights,
  type MeWorksItem,
  type PostDto,
  type Scoreable,
} from "@bytedance-aigc/shared";
import { PrismaService } from "../prisma/prisma.service";
import { decodeCursor, encodeCursor, weightsEqual } from "./cursor";

const DEFAULT_LIMIT = 10;

interface GetFeedOpts {
  mode: FeedMode;
  cursor?: string;
  limit?: number;
  weights?: Partial<FeedWeights>;
}

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(opts: GetFeedOpts): Promise<{ items: PostDto[]; nextCursor: string | null }> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const weights: FeedWeights = {
      alpha: opts.weights?.alpha ?? DEFAULT_FEED_WEIGHTS.alpha,
      beta: opts.weights?.beta ?? DEFAULT_FEED_WEIGHTS.beta,
      gamma: opts.weights?.gamma ?? DEFAULT_FEED_WEIGHTS.gamma,
    };

    let startRank = 0;
    if (opts.cursor) {
      let decoded;
      try {
        decoded = decodeCursor(opts.cursor);
      } catch {
        throw new BadRequestException({ code: "CURSOR_INVALID", message: "cursor 解析失败" });
      }
      if (!weightsEqual(decoded.weights, weights)) {
        throw new BadRequestException({
          code: "CURSOR_WEIGHTS_MISMATCH",
          message: "权重已变更,请回到第一页",
        });
      }
      startRank = decoded.rank;
    }

    const now = new Date();
    const windowMs = WINDOW_HOURS[opts.mode] * 3600_000;
    const since = new Date(now.getTime() - windowMs);

    // Phase 2.15:二发期间(status=DRAFT/REVIEWING + publishedBody 非空)
    // 老线上版仍在 feed 里可见,直到新版本通过 publish() 覆盖 publishedBody。
    const drafts = await this.prisma.draft.findMany({
      where: {
        publishedAt: { gte: since },
        OR: [
          { status: "PUBLISHED" },
          { status: { in: ["DRAFT", "REVIEWING"] }, publishedBody: { not: Prisma.JsonNull } },
        ],
      },
      include: {
        author: { select: { id: true, handle: true } },
        lastReview: { select: { quality: true } },
      },
    });

    const scoreables: (Scoreable & { draft: (typeof drafts)[number] })[] = drafts.map((d) => {
      // PHASE_2_5_REPLACE_HERE: 把 hotnessMockBase 换成基于 PostStat 的真实加权
      const hotnessRaw = hotnessMockBase(d.id);
      const q = readQualityOverall(d.lastReview?.quality);
      return {
        id: d.id,
        publishedAt: d.publishedAt ?? d.updatedAt,
        qualityOverall: q,
        hotnessRaw,
        draft: d,
      };
    });

    const hotnessPool = scoreables.map((s) => s.hotnessRaw);
    const tauHours = TAU_HOURS[opts.mode];

    const ranked = scoreables
      .map((s) => ({ s, score: computeScore(s, { weights, tauHours, now, hotnessPool }) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const pa = a.s.publishedAt.getTime();
        const pb = b.s.publishedAt.getTime();
        if (pa !== pb) return pb - pa;
        return a.s.id.localeCompare(b.s.id);
      });

    const slice = ranked.slice(startRank, startRank + limit);
    const items: PostDto[] = slice.map(({ s }) => toPostDto(s.draft, s.hotnessRaw, hotnessPool));

    const endRank = startRank + slice.length;
    const nextCursor = endRank < ranked.length ? encodeCursor({ rank: endRank, weights }) : null;
    return { items, nextCursor };
  }

  async getPostDetail(id: string) {
    const draft = await this.prisma.draft.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, handle: true } },
        lastReview: { select: { quality: true, recommendation: true } },
      },
    });
    if (!draft) return null;
    if (draft.status === "OFFLINE") return null;
    // Phase 2.15:PUBLISHED 直读;DRAFT/REVIEWING 但 publishedBody 非空(二发期间)
    // 仍可见 — 老线上版保留显示直到新版本通过 publish() 覆盖。
    const isLive = draft.status === "PUBLISHED" || draft.publishedBody !== null;
    if (!isLive) return null;
    if (draft.lastReview?.recommendation === "BLOCK") return null;
    return draft;
  }

  async getAuthorPosts(authorId: string, limit = DEFAULT_LIMIT) {
    // Phase 2.15:二发期间老线上版保留可见(同 getFeed 的 B-path)
    const drafts = await this.prisma.draft.findMany({
      where: {
        authorId,
        OR: [
          { status: "PUBLISHED" },
          { status: { in: ["DRAFT", "REVIEWING"] }, publishedBody: { not: Prisma.JsonNull } },
        ],
      },
      include: {
        author: { select: { id: true, handle: true } },
        lastReview: { select: { quality: true } },
      },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
    const hotnessPool = drafts.map((d) => hotnessMockBase(d.id));
    return drafts.map((d) => toPostDto(d, hotnessMockBase(d.id), hotnessPool));
  }

  async getMyWorks(
    userId: string,
    status: "DRAFT" | "REVIEWING" | "PUBLISHED" | "OFFLINE" | "ALL",
    limit = 20,
  ): Promise<MeWorksItem[]> {
    const where: { authorId: string; status?: "DRAFT" | "REVIEWING" | "PUBLISHED" | "OFFLINE" } = {
      authorId: userId,
    };
    if (status !== "ALL") where.status = status;
    const drafts = await this.prisma.draft.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        mode: true,
        publishedAt: true,
        updatedAt: true,
        offlineReason: true,
        offlineAt: true,
        lastReview: { select: { quality: true, recommendation: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return drafts.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      mode: d.mode,
      publishedAt: d.publishedAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
      qualityOverall: readQualityOverall(d.lastReview?.quality),
      recommendation: d.lastReview?.recommendation ?? null,
      offlineReason: d.offlineReason ?? null,
      offlineAt: d.offlineAt?.toISOString() ?? null,
    }));
  }
}

function readQualityOverall(quality: unknown): number {
  if (typeof quality !== "object" || quality === null) return 0;
  const v = (quality as Record<string, unknown>).overall;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function toPostDto(
  draft: {
    id: string;
    title: string;
    publishedTitle: string | null;
    authorId: string;
    publishedAt: Date | null;
    updatedAt: Date;
    body: unknown;
    publishedBody: unknown;
    author: { id: string; handle: string };
    lastReview: { quality: unknown } | null;
  },
  hotnessRaw: number,
  hotnessPool: number[],
): PostDto {
  const hotnessMock = normalizeHotness(hotnessRaw, hotnessPool);
  return {
    id: draft.id,
    title: draft.publishedTitle ?? draft.title,
    authorId: draft.authorId,
    authorHandle: draft.author.handle,
    publishedAt: (draft.publishedAt ?? draft.updatedAt).toISOString(),
    qualityOverall: readQualityOverall(draft.lastReview?.quality),
    hotnessMock,
    coverIndex: pickCoverIndex(draft.id),
    excerpt: extractExcerpt(draft.publishedBody ?? draft.body),
  };
}

function pickCoverIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 5) + 1;
}

function extractExcerpt(body: unknown): string {
  return collectText(body).slice(0, 80);
}

function collectText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(collectText).join("");
  return "";
}
