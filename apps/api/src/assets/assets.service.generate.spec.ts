import { AssetsService } from "./assets.service";
import { AssetTaggingService } from "./asset-tagging.service";
import { PrismaService } from "../prisma/prisma.service";
import { BadRequestException } from "@nestjs/common";
import type { StorageService } from "./storage/storage.service";

describe("AssetsService.generateAi", () => {
  let createMock: jest.Mock;
  let storage: StorageService;
  let tagging: { tag: jest.Mock };

  beforeEach(() => {
    createMock = jest.fn().mockResolvedValue({
      id: "asset1",
      userId: "u1",
      key: "users/u1/ai/uuid.png",
      url: "https://placehold.co/512x512/e0e0e0/333?text=AI+Generated",
      mime: "image/png",
      size: 0,
      aiGenerated: true,
      aiPrompt: "a cat in office",
      sceneTags: [],
      subjectTags: [],
      createdAt: new Date(),
    });
    storage = { put: jest.fn().mockResolvedValue({ url: "https://mock.local/k" }) };
    tagging = { tag: jest.fn() };
  });

  function makeService(): AssetsService {
    const updateMock = jest.fn().mockResolvedValue({
      id: "asset1",
      userId: "u1",
      key: "users/u1/ai/uuid.png",
      url: "https://placehold.co/512x512/e0e0e0/333?text=AI+Generated",
      mime: "image/png",
      size: 0,
      aiGenerated: true,
      aiPrompt: "a cat in office",
      sceneTags: ["办公室"],
      subjectTags: ["动物"],
      createdAt: new Date(),
    });
    const prisma = {
      asset: {
        create: createMock,
        update: updateMock,
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
    };
    return new AssetsService(
      prisma as unknown as PrismaService,
      storage,
      tagging as unknown as AssetTaggingService,
    );
  }

  it("正常生成 AI asset", async () => {
    tagging.tag.mockResolvedValue({ sceneTags: ["办公室"], subjectTags: ["动物"] });
    const svc = makeService();

    const result = await svc.generateAi("u1", "a cat in office");

    expect(result.aiGenerated).toBe(true);
    expect(result.aiPrompt).toBe("a cat in office");
    expect(result.sceneTags).toEqual(["办公室"]);
    expect(result.subjectTags).toEqual(["动物"]);

    const createCalls = createMock.mock.calls as [{ data: Record<string, unknown> }][];
    const createData = createCalls[0][0].data;
    expect(createData.aiGenerated).toBe(true);
    expect(createData.aiPrompt).toBe("a cat in office");
    expect(createData.mime).toBe("image/png");
    expect(createData.size).toBe(0);
  });

  it("prompt 空 → BadRequest", async () => {
    const svc = makeService();

    await expect(svc.generateAi("u1", "")).rejects.toThrow(BadRequestException);
    await expect(svc.generateAi("u1", "   ")).rejects.toThrow(BadRequestException);
  });

  it("prompt 超 500 字 → BadRequest", async () => {
    const svc = makeService();

    const longPrompt = "a".repeat(501);
    await expect(svc.generateAi("u1", longPrompt)).rejects.toThrow(BadRequestException);
  });
});
