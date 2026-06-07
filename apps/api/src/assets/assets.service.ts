import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Asset } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { STORAGE_SERVICE, type StorageService } from "./storage/storage.service";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async upload(userId: string, file: Express.Multer.File): Promise<Asset> {
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

    const { url } = await this.storage.put(key, file.buffer, file.mimetype);

    return this.prisma.asset.create({
      data: {
        userId,
        key,
        url,
        mime: file.mimetype,
        size: file.size,
      },
    });
  }

  async listMine(userId: string, limit = 20): Promise<Asset[]> {
    return this.prisma.asset.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });
  }
}
