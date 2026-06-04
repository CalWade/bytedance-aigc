import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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
}
