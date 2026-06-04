import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DraftToolType, Prompt } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ListPromptsQueryDto } from "./dto/list-prompts-query.dto";

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
}
