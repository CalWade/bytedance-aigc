import { Injectable, NotFoundException } from "@nestjs/common";
import { Prompt } from "@prisma/client";

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
}
