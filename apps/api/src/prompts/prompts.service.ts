import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DraftToolType, Prisma, Prompt, PromptSnapshot } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ListPromptsQueryDto } from "./dto/list-prompts-query.dto";
import type { UpdatePromptDto } from "./dto/update-prompt.dto";

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPromptsQueryDto): Promise<Prompt[]> {
    return this.prisma.prompt.findMany({
      where: {
        owner: "PLATFORM",
        ...(query.tool
          ? { tool: query.tool }
          : {
              tool: { notIn: ["SAFETY_REVIEW", "QUALITY_REVIEW", "SAFE_REWRITE", "IMAGE_REVIEW"] },
            }),
      },
      orderBy: [{ tool: "asc" }, { createdAt: "asc" }],
    });
  }

  async findOne(id: string): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) {
      throw new NotFoundException(`Prompt ${id} not found`);
    }
    return prompt;
  }

  /**
   * Task 7 用:无 promptId 时取 tool 的"默认款"。优先 PLATFORM + isStarter:true
   * 唯一命中;若 starter 缺失(理论不应发生,fixtures 9 条都有)回退 PLATFORM
   * 该 tool 任意首条;再缺失抛 NotFound。
   */
  async findDefaultByTool(tool: DraftToolType): Promise<Prompt> {
    const starter = await this.prisma.prompt.findFirst({
      where: { owner: "PLATFORM", tool, isStarter: true },
      orderBy: { createdAt: "asc" },
    });
    if (starter) return starter;

    const fallback = await this.prisma.prompt.findFirst({
      where: { owner: "PLATFORM", tool },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      throw new NotFoundException(`No platform prompt for tool ${tool}`);
    }
    return fallback;
  }

  /**
   * Task 7 用:promptId 指定时,必须满足
   *   (PLATFORM)  ||  (PRIVATE && authorId === userSub)
   * 且 prompt.tool === expectedTool,否则 403。Prompt 不存在 → 404。
   */
  async findOneOwnedOrPlatformForTool(
    promptId: string,
    userSub: string,
    expectedTool: DraftToolType,
  ): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findUnique({ where: { id: promptId } });
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }
    if (prompt.tool !== expectedTool) {
      throw new ForbiddenException(`Prompt tool ${prompt.tool} mismatches ${expectedTool}`);
    }
    if (prompt.owner === "PLATFORM") return prompt;
    if (prompt.owner === "PRIVATE" && prompt.authorId === userSub) return prompt;
    throw new ForbiddenException("Prompt not accessible");
  }

  /* ---------- Task 8: 私有 Prompt CRUD ---------- */

  async listPrivate(userSub: string): Promise<Prompt[]> {
    return this.prisma.prompt.findMany({
      where: { owner: "PRIVATE", authorId: userSub },
      orderBy: [{ tool: "asc" }, { createdAt: "asc" }],
    });
  }

  /**
   * 平台 prompt → 复制为该用户的 PRIVATE 副本。sourcePromptId 钉死溯源,
   * isStarter 一律 false(私有副本不参与默认款选取)。
   */
  async copyToPrivate(platformId: string, userSub: string): Promise<Prompt> {
    const source = await this.prisma.prompt.findUnique({ where: { id: platformId } });
    if (!source) throw new NotFoundException(`Prompt ${platformId} not found`);
    if (
      source.tool === "SAFETY_REVIEW" ||
      source.tool === "QUALITY_REVIEW" ||
      source.tool === "SAFE_REWRITE" ||
      source.tool === "IMAGE_REVIEW"
    ) {
      throw new BadRequestException("此 Prompt 由平台独占,不可复制为私人副本");
    }
    if (source.owner !== "PLATFORM") {
      throw new BadRequestException("Only PLATFORM prompts can be copied");
    }
    return this.prisma.prompt.create({
      data: {
        owner: "PRIVATE",
        authorId: userSub,
        tool: source.tool,
        name: source.name,
        systemPrompt: source.systemPrompt,
        params: source.params as object,
        fewShots: source.fewShots as object,
        designNote: source.designNote,
        isStarter: false,
        sourcePromptId: source.id,
      },
    });
  }

  async update(id: string, userSub: string, dto: UpdatePromptDto): Promise<Prompt> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assertOwnPrivate(id, userSub, tx);
      return this.writeWithSnapshot(tx, current, {
        ...(dto.systemPrompt !== undefined ? { systemPrompt: dto.systemPrompt } : {}),
        ...(dto.params !== undefined ? { params: dto.params as Prisma.InputJsonValue } : {}),
        ...(dto.fewShots !== undefined
          ? { fewShots: dto.fewShots as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.designNote !== undefined ? { designNote: dto.designNote } : {}),
      });
    });
  }

  /**
   * Phase 2.17:在事务内
   *  1) 把 current 写一条 snapshot
   *  2) 裁剪 snapshot 到最近 3 条
   *  3) 用 patch 更新 prompt
   * update 与 restoreSnapshot 共用此方法,避免事务嵌套。
   */
  private async writeWithSnapshot(
    tx: Prisma.TransactionClient,
    current: Prompt,
    patch: Prisma.PromptUpdateInput,
  ): Promise<Prompt> {
    await tx.promptSnapshot.create({
      data: {
        promptId: current.id,
        systemPrompt: current.systemPrompt,
        params: current.params as Prisma.InputJsonValue,
        fewShots: current.fewShots as Prisma.InputJsonValue,
        designNote: current.designNote,
      },
    });
    // 裁剪到 3:保留最新 3 条,删更旧的(理论 update 前 ≤3,新插入后 ≤4,overflow 至多 1)
    const overflow = await tx.promptSnapshot.findMany({
      where: { promptId: current.id },
      orderBy: { createdAt: "desc" },
      skip: 3,
      select: { id: true },
    });
    if (overflow.length > 0) {
      await tx.promptSnapshot.deleteMany({
        where: { id: { in: overflow.map((s) => s.id) } },
      });
    }
    return tx.prompt.update({ where: { id: current.id }, data: patch });
  }

  async deleteOne(id: string, userSub: string): Promise<void> {
    await this.assertOwnPrivate(id, userSub);
    await this.prisma.prompt.delete({ where: { id } });
  }

  /** Phase 2.17:列最近 3 条快照(desc by createdAt)。仅作者本人可调。 */
  async listSnapshots(promptId: string, userSub: string): Promise<PromptSnapshot[]> {
    await this.assertOwnPrivate(promptId, userSub);
    return this.prisma.promptSnapshot.findMany({
      where: { promptId },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
  }

  /** Phase 2.17:用快照内容走 update 路径 — 当前状态自然入新快照。 */
  async restoreSnapshot(promptId: string, snapId: string, userSub: string): Promise<Prompt> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assertOwnPrivate(promptId, userSub, tx);
      const snap = await tx.promptSnapshot.findFirst({
        where: { id: snapId, promptId },
      });
      if (!snap) {
        throw new NotFoundException(`Snapshot ${snapId} not found for prompt ${promptId}`);
      }
      return this.writeWithSnapshot(tx, current, {
        systemPrompt: snap.systemPrompt,
        params: snap.params as Prisma.InputJsonValue,
        fewShots: snap.fewShots as Prisma.InputJsonValue,
        designNote: snap.designNote,
      });
    });
  }

  /** 仅自己的 PRIVATE 才能改/删/列快照/回滚;PLATFORM 一律 403,别人 PRIVATE 也 403。 */
  private async assertOwnPrivate(
    id: string,
    userSub: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Prompt> {
    const prompt = await db.prompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);
    if (prompt.owner !== "PRIVATE" || prompt.authorId !== userSub) {
      throw new ForbiddenException("Prompt not editable");
    }
    return prompt;
  }
}
