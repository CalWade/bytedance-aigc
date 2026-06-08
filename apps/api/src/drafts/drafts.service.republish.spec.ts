import { Test } from "@nestjs/testing";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { DraftsService } from "./drafts.service";
import { VersionsService } from "./versions/versions.service";
import { PrismaService } from "../prisma/prisma.service";

describe("DraftsService.edit() — 二次编辑入口", () => {
  let service: DraftsService;
  let prisma: { draft: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      draft: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        DraftsService,
        { provide: PrismaService, useValue: prisma },
        { provide: VersionsService, useValue: {} },
      ],
    }).compile();
    service = module.get(DraftsService);
  });

  it("PUBLISHED → DRAFT,version+1", async () => {
    prisma.draft.findUnique.mockResolvedValue({
      id: "d1",
      authorId: "u1",
      status: "PUBLISHED",
      version: 5,
    });
    prisma.draft.update.mockResolvedValue({ id: "d1", status: "DRAFT", version: 6 });

    const r = await service.edit("d1", "u1");
    expect(r).toEqual({ id: "d1", status: "DRAFT", version: 6 });
    expect(prisma.draft.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "DRAFT", version: { increment: 1 } },
    });
  });

  it("DRAFT 状态 → 409 EDIT_NOT_ALLOWED", async () => {
    prisma.draft.findUnique.mockResolvedValue({
      id: "d1",
      authorId: "u1",
      status: "DRAFT",
      version: 1,
    });
    await expect(service.edit("d1", "u1")).rejects.toMatchObject({
      response: { code: "EDIT_NOT_ALLOWED" },
      status: 409,
    });
  });

  it("OFFLINE 状态 → 409 EDIT_NOT_ALLOWED", async () => {
    prisma.draft.findUnique.mockResolvedValue({
      id: "d1",
      authorId: "u1",
      status: "OFFLINE",
      version: 7,
    });
    await expect(service.edit("d1", "u1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("非作者 → 403", async () => {
    prisma.draft.findUnique.mockResolvedValue({
      id: "d1",
      authorId: "u1",
      status: "PUBLISHED",
      version: 5,
    });
    await expect(service.edit("d1", "OTHER_USER")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
