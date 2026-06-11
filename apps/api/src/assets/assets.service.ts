import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Asset } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { AssetReviewResult, AssetReviewService } from "./asset-review.service";
import { AssetTaggingService } from "./asset-tagging.service";
import { STORAGE_SERVICE, type StorageService } from "./storage/storage.service";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const AI_IMAGE_URL = "https://placehold.co/512x512/e0e0e0/333?text=AI+Generated";

interface UploadOptions {
  tagSync?: boolean;
  aiDeclared?: boolean;
}

interface SearchParams {
  scene?: string;
  subject?: string;
  aiOnly?: boolean;
  limit?: number;
}

export interface AssetWithScore extends Asset {
  score: number;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly taggingService: AssetTaggingService,
    private readonly reviewService: AssetReviewService,
  ) {}

  async upload(userId: string, file: Express.Multer.File, opts?: UploadOptions): Promise<Asset> {
    if (!file || !file.buffer) throw new BadRequestException("file required");
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(`unsupported mime: ${file.mimetype}`);
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`file too large: ${file.size} > ${MAX_BYTES}`);
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const ext = MIME_EXT[file.mimetype] ?? "bin";
    const key = `users/${userId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;

    // 先上传拿到 URL，供 GuardClient 图片内容审核使用
    const { url } = await this.storage.put(key, file.buffer, file.mimetype);

    // PRD §4.6.1 入库时合规校验（双层：GuardClient 图片内容 + LLM 元信息启发式）
    const review = await this.reviewService.reviewAsset({
      mime: file.mimetype,
      filename: file.originalname ?? "",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: opts?.aiDeclared ?? false,
      stage: "INGEST",
      imageUrl: url,
    });

    if (review.recommendation === "BLOCK") {
      throw new BadRequestException(`素材合规校验未通过: ${review.reason}`);
    }

    const reviewStatus = this.reviewService.recommendationToStatus(review.recommendation);
    const asset = await this.prisma.asset.create({
      data: {
        userId,
        key,
        url,
        mime: file.mimetype,
        size: file.size,
        reviewStatus,
        reviewNote: review.reason,
      },
    });

    // auto-tag: hint from filename (strip extension)
    const hint = file.originalname?.replace(/\.[^/.]+$/, "") ?? "";
    const tagPromise = this.taggingService
      .tag(hint)
      .then((tags) =>
        this.prisma.asset.update({
          where: { id: asset.id },
          data: { sceneTags: tags.sceneTags, subjectTags: tags.subjectTags },
        }),
      )
      .catch((err: Error) => {
        this.logger.warn(`auto-tag failed for asset ${asset.id}: ${err.message}`);
      });

    if (opts?.tagSync) {
      await tagPromise;
      // re-read to get updated tags
      return this.prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    }

    // fire-and-forget in production
    void tagPromise;

    return asset;
  }

  async listMine(userId: string, limit = 20): Promise<Asset[]> {
    return this.prisma.asset.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });
  }

  async generateAi(userId: string, prompt: string): Promise<Asset> {
    const trimmed = prompt?.trim();
    if (!trimmed) {
      throw new BadRequestException("prompt is required");
    }
    if (trimmed.length > 500) {
      throw new BadRequestException("prompt exceeds 500 characters");
    }

    // PRD §4.6.1 入库时合规校验 — AI 生图 aiDeclared 强制 true
    const review = await this.reviewService.reviewAsset({
      mime: "image/png",
      filename: "",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: true,
      aiDeclared: true,
      stage: "INGEST",
    });

    if (review.recommendation === "BLOCK") {
      throw new BadRequestException(`素材合规校验未通过: ${review.reason}`);
    }

    const key = `users/${userId}/ai/${randomUUID()}.png`;

    const reviewStatus = this.reviewService.recommendationToStatus(review.recommendation);
    const asset = await this.prisma.asset.create({
      data: {
        userId,
        key,
        url: AI_IMAGE_URL,
        mime: "image/png",
        size: 0,
        aiGenerated: true,
        aiPrompt: trimmed,
        reviewStatus,
        reviewNote: review.reason,
      },
    });

    // sync tag — prompt itself is a high-quality hint
    const tags = await this.taggingService.tag(trimmed);
    const updated = await this.prisma.asset.update({
      where: { id: asset.id },
      data: { sceneTags: tags.sceneTags, subjectTags: tags.subjectTags },
    });

    return updated;
  }

  async search(userId: string, params: SearchParams): Promise<Asset[]> {
    const where: Record<string, unknown> = { userId };

    if (params.scene) {
      where.sceneTags = { has: params.scene };
    }
    if (params.subject) {
      where.subjectTags = { has: params.subject };
    }
    if (params.aiOnly) {
      where.aiGenerated = true;
    }

    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    return this.prisma.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async remove(userId: string, assetId: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }
    if (asset.userId !== userId) {
      throw new ForbiddenException("Not your asset");
    }
    await this.prisma.asset.delete({ where: { id: assetId } });
  }

  async recommendForBody(userId: string, body: string, topN = 6): Promise<AssetWithScore[]> {
    const assets = await this.prisma.asset.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const scored: AssetWithScore[] = assets
      .map((asset) => {
        let score = 0;
        for (const tag of asset.sceneTags) {
          if (body.includes(tag)) score += 1;
        }
        for (const tag of asset.subjectTags) {
          if (body.includes(tag)) score += 1;
        }
        return { ...asset, score };
      })
      .filter((a) => a.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN);
  }

  /**
   * PRD §4.6.1 插入文章前合规校验:即便已在库,插入正文时再过一遍最新规则。
   * 返 WARN/ALLOW/BLOCK,作者可选择「换图 / 仍使用」。
   */
  async checkForInsert(userId: string, assetId: string): Promise<AssetReviewResult> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }
    if (asset.userId !== userId) {
      throw new ForbiddenException("Not your asset");
    }

    return this.reviewService.reviewAsset({
      mime: asset.mime,
      filename: asset.key.split("/").pop() ?? "",
      sceneTags: asset.sceneTags,
      subjectTags: asset.subjectTags,
      aiGenerated: asset.aiGenerated,
      aiDeclared: asset.aiGenerated,
      stage: "PRE_INSERT",
      imageUrl: asset.url,
    });
  }
}
