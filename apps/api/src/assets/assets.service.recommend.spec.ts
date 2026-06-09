import { AssetsService } from "./assets.service";
import { AssetTaggingService } from "./asset-tagging.service";
import { PrismaService } from "../prisma/prisma.service";
import type { Asset } from "@prisma/client";
import type { StorageService } from "./storage/storage.service";

function makeAsset(overrides: Partial<Asset> & { id: string }): Asset {
  return {
    userId: "u1",
    key: `key-${overrides.id}`,
    url: `https://mock.local/${overrides.id}`,
    mime: "image/png",
    size: 100,
    aiGenerated: false,
    aiPrompt: null,
    sceneTags: [],
    subjectTags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe("AssetsService.recommendForBody", () => {
  let findMany: jest.Mock;
  let svc: AssetsService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      asset: { create: jest.fn(), update: jest.fn(), findMany },
    };
    const storage = {
      put: jest.fn().mockResolvedValue({ url: "https://mock.local/k" }),
    } as unknown as StorageService;
    const tagging = { tag: jest.fn() };
    svc = new AssetsService(
      prisma as unknown as PrismaService,
      storage,
      tagging as unknown as AssetTaggingService,
    );
  });

  it("body 含某 tag → 该 asset 分高", async () => {
    const a1 = makeAsset({ id: "a1", sceneTags: ["办公室"], subjectTags: ["人物"] });
    const a2 = makeAsset({ id: "a2", sceneTags: ["户外"], subjectTags: ["风景"] });
    findMany.mockResolvedValue([a1, a2]);

    const results = await svc.recommendForBody("u1", "在办公室里的人物照片");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a1");
    expect(results[0].score).toBe(2); // 办公室 + 人物
  });

  it("body 无任何 tag → 返空列表", async () => {
    const a1 = makeAsset({ id: "a1", sceneTags: ["办公室"], subjectTags: ["人物"] });
    findMany.mockResolvedValue([a1]);

    const results = await svc.recommendForBody("u1", "这是一篇关于编程的文章");
    expect(results).toEqual([]);
  });

  it("topN 限制生效", async () => {
    const assets = [
      makeAsset({ id: "a1", sceneTags: ["办公室"], subjectTags: ["人物"] }),
      makeAsset({ id: "a2", sceneTags: ["办公室"], subjectTags: ["人物"] }),
      makeAsset({ id: "a3", sceneTags: ["办公室"], subjectTags: [] }),
    ];
    findMany.mockResolvedValue(assets);

    const results = await svc.recommendForBody("u1", "办公室里的人物", 2);
    expect(results.length).toBe(2);
  });
});
