/**
 * Phase 2.17 §6.1 case 3 — update 失败时 snapshot 不留(事务回滚契约)
 *
 * 该用例无法在 prompts.service.spec.ts(真实 Prisma)中表达,因为很难强制 prisma.update
 * 在事务中途抛错。这里用 mocked PrismaService 验证 service 层的"先 snapshot.create,
 * 后 prompt.update,update 抛错则整事务向上传播"的顺序契约。
 *
 * Postgres real transaction semantics guarantee the snapshot row is rolled back;
 * this test verifies the service-layer ordering and propagation contract.
 */
import { PrismaService } from "../prisma/prisma.service";
import { PromptsService } from "./prompts.service";

describe("PromptsService.update 事务回滚契约 (Phase 2.17 §6.1 case 3)", () => {
  it("tx.prompt.update 抛错时:snapshot.create 已被先调用,且错误向上传播", async () => {
    const promptId = "p1";
    const userId = "u1";

    const currentPrompt = {
      id: promptId,
      owner: "PRIVATE",
      authorId: userId,
      tool: "REWRITE_FLUENT",
      name: "私有副本",
      systemPrompt: "原 system",
      params: {},
      fewShots: [],
      designNote: null,
      isStarter: false,
      sourcePromptId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const callOrder: string[] = [];

    const snapshotCreate = jest.fn(() => {
      callOrder.push("snapshot.create");
      return Promise.resolve({ id: "s1" });
    });
    const snapshotFindMany = jest.fn(() => Promise.resolve([]));
    const snapshotDeleteMany = jest.fn(() => Promise.resolve({ count: 0 }));

    const promptFindUnique = jest.fn(() => Promise.resolve(currentPrompt));
    const promptUpdate = jest.fn(() => {
      callOrder.push("prompt.update");
      return Promise.reject(new Error("simulated mid-transaction failure"));
    });

    const tx = {
      prompt: { findUnique: promptFindUnique, update: promptUpdate },
      promptSnapshot: {
        create: snapshotCreate,
        findMany: snapshotFindMany,
        deleteMany: snapshotDeleteMany,
      },
    };

    // 真实 Prisma $transaction 在 callback 抛错时 rollback 并 reject 外层 Promise。
    // 这里直接把 callback 跑一遍并把错误向上传播,以建模该契约。
    const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const prisma = {
      $transaction,
    } as unknown as PrismaService;

    const service = new PromptsService(prisma);

    await expect(service.update(promptId, userId, { systemPrompt: "新 system" })).rejects.toThrow(
      "simulated mid-transaction failure",
    );

    // 顺序契约:snapshot 必须在 update 之前被调用(spec §3.3)。
    expect(callOrder).toEqual(["snapshot.create", "prompt.update"]);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);
    expect(promptUpdate).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
