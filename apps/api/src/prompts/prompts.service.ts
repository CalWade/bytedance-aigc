import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DraftToolType, Prisma, Prompt } from "@prisma/client";

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
        ...(query.tool ? { tool: query.tool } : {}),
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
    await this.assertOwnPrivate(id, userSub);
    return this.prisma.prompt.update({
      where: { id },
      data: {
        ...(dto.systemPrompt !== undefined ? { systemPrompt: dto.systemPrompt } : {}),
        ...(dto.params !== undefined ? { params: dto.params as Prisma.InputJsonValue } : {}),
        ...(dto.fewShots !== undefined
          ? { fewShots: dto.fewShots as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.designNote !== undefined ? { designNote: dto.designNote } : {}),
      },
    });
  }

  async deleteOne(id: string, userSub: string): Promise<void> {
    await this.assertOwnPrivate(id, userSub);
    await this.prisma.prompt.delete({ where: { id } });
  }

  /** 仅自己的 PRIVATE 才能改/删;PLATFORM 一律 403,别人 PRIVATE 也 403。 */
  private async assertOwnPrivate(id: string, userSub: string): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);
    if (prompt.owner !== "PRIVATE" || prompt.authorId !== userSub) {
      throw new ForbiddenException("Prompt not editable");
    }
    return prompt;
  }
}
