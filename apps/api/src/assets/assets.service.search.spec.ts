import { AssetsService } from "./assets.service";
import { AssetTaggingService } from "./asset-tagging.service";
import { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "./storage/storage.service";

describe("AssetsService.search", () => {
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

  it("按 scene 过滤", async () => {
    await svc.search("u1", { scene: "办公室" });

    const calls = findMany.mock.calls as [{ where: Record<string, unknown> }][];
    const callArgs = calls[0][0];
    expect(callArgs.where.userId).toBe("u1");
    expect(callArgs.where.sceneTags).toEqual({ has: "办公室" });
  });

  it("按 subject 过滤", async () => {
    await svc.search("u1", { subject: "人物" });

    const calls = findMany.mock.calls as [{ where: Record<string, unknown> }][];
    const callArgs = calls[0][0];
    expect(callArgs.where.userId).toBe("u1");
    expect(callArgs.where.subjectTags).toEqual({ has: "人物" });
  });

  it("aiOnly:true", async () => {
    await svc.search("u1", { aiOnly: true });

    const calls = findMany.mock.calls as [{ where: Record<string, unknown> }][];
    const callArgs = calls[0][0];
    expect(callArgs.where.userId).toBe("u1");
    expect(callArgs.where.aiGenerated).toBe(true);
  });

  it("多过滤组合: scene + subject + aiOnly", async () => {
    await svc.search("u1", { scene: "办公室", subject: "人物", aiOnly: true });

    const calls = findMany.mock.calls as [{ where: Record<string, unknown> }][];
    const callArgs = calls[0][0];
    expect(callArgs.where.userId).toBe("u1");
    expect(callArgs.where.sceneTags).toEqual({ has: "办公室" });
    expect(callArgs.where.subjectTags).toEqual({ has: "人物" });
    expect(callArgs.where.aiGenerated).toBe(true);
  });
});
