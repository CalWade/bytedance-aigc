import { SENSITIVE_CATEGORIES as SENSITIVE_CATEGORIES_FOR_TEST } from "@bytedance-aigc/shared";

import { LlmClient } from "../llm/llm.client";
import { PrismaService } from "../prisma/prisma.service";
import { PromptsService } from "../prompts/prompts.service";
import { DraftsService } from "../drafts/drafts.service";
import { ReviewService } from "./review.service";
import { StreamSessionStore } from "./stream-session";
import { DEMO_AUTHOR_ID } from "../../prisma/fixtures";

const ALL_LOW_SAFETY = JSON.stringify({
  dimensions: [
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "false_advertising", score: 0, severity: "low", hits: [], reason: "无" },
  ],
});

const HIGH_QUALITY = JSON.stringify({
  dimensions: [
    { key: "content_value", score: 90, reason: "好" },
    { key: "expression", score: 88, reason: "好" },
    { key: "reader_experience", score: 85, reason: "好" },
    { key: "viral_potential", score: 82, reason: "好" },
  ],
});

const LOW_QUALITY = JSON.stringify({
  dimensions: [
    { key: "content_value", score: 50, reason: "弱" },
    { key: "expression", score: 50, reason: "弱" },
    { key: "reader_experience", score: 50, reason: "弱" },
    { key: "viral_potential", score: 50, reason: "弱" },
  ],
});

function makeService(safetyRaw: string, qualityRaw: string) {
  const drafts = {
    assertAuthor: jest.fn().mockResolvedValue({
      title: "标题",
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
      },
    }),
  } as unknown as DraftsService;
  const llm = {
    chat: jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(safetyRaw))
      .mockImplementationOnce(() => Promise.resolve(qualityRaw)),
  } as unknown as LlmClient;
  const prompts = {
    findDefaultByTool: jest.fn().mockResolvedValue({ systemPrompt: "你是审核员", params: {} }),
  } as unknown as PromptsService;
  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        review: {
          create: jest.fn().mockResolvedValue({
            id: "r1",
            stage: "PREFLIGHT",
            safety: {},
            quality: {},
            recommendation: "ALLOW",
            modelMeta: {},
            createdAt: new Date(),
          }),
        },
        draft: { update: jest.fn().mockResolvedValue({}) },
      }),
    ),
  } as unknown as PrismaService;
  const store = new StreamSessionStore();
  return new ReviewService(drafts, prisma, llm, prompts, store);
}

describe("ReviewService.preflight", () => {
  it("全 low + 高质量 → ALLOW", async () => {
    const svc = makeService(ALL_LOW_SAFETY, HIGH_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("ALLOW");
  });

  it("safety 含 high → BLOCK", async () => {
    const high = JSON.stringify({
      dimensions: [
        { key: "pornography", score: 80, severity: "high", hits: ["..."], reason: "命中" },
        { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "false_advertising", score: 0, severity: "low", hits: [], reason: "无" },
      ],
    });
    const svc = makeService(high, HIGH_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });

  it("safety 含 medium → WARN", async () => {
    const med = JSON.stringify({
      dimensions: [
        { key: "pornography", score: 50, severity: "medium", hits: [], reason: "中" },
        { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
        { key: "false_advertising", score: 0, severity: "low", hits: [], reason: "无" },
      ],
    });
    const svc = makeService(med, HIGH_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("WARN");
  });

  it("safety 全 low + quality.overall<60 → WARN", async () => {
    const svc = makeService(ALL_LOW_SAFETY, LOW_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("WARN");
  });

  it("LLM 输出非 JSON → 默认按高风险 BLOCK", async () => {
    const svc = makeService("not json at all", HIGH_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });

  it("LLM 输出缺维度 → BLOCK", async () => {
    const partial = JSON.stringify({
      dimensions: [{ key: "pornography", score: 0, severity: "low" }],
    });
    const svc = makeService(partial, HIGH_QUALITY);
    const res = await svc.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });
});

describe("reviewPrompt (Phase 2.5 ①)", () => {
  const ALL_LOW_7CATS = JSON.stringify({
    dimensions: [
      { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
    ],
  });
  const POLITICS_HIGH_7CATS = JSON.stringify({
    dimensions: [
      { key: "politics", score: 90, severity: "high", hits: ["xxx"], reason: "命中" },
      { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
    ],
  });

  let service: ReviewService;
  let llm: { chat: jest.Mock };

  beforeEach(() => {
    const drafts = {} as unknown as DraftsService;
    llm = { chat: jest.fn() };
    const prompts = {
      findDefaultByTool: jest.fn().mockResolvedValue({ systemPrompt: "你是审核员", params: {} }),
    } as unknown as PromptsService;
    const prisma = {} as unknown as PrismaService;
    const store = new StreamSessionStore();
    service = new ReviewService(drafts, prisma, llm as unknown as LlmClient, prompts, store);
  });

  it("ALLOW happy path:全 low → recommendation ALLOW + hitCategories 空", async () => {
    llm.chat.mockResolvedValueOnce(ALL_LOW_7CATS);
    const res = await service.reviewPrompt("正常选题文本");
    expect(res.recommendation).toBe("ALLOW");
    expect(res.hitCategories).toEqual([]);
    expect(res.reviewId).toEqual(expect.any(String));
  });

  it("politics high → recommendation BLOCK + hitCategories 包含 politics", async () => {
    llm.chat.mockResolvedValueOnce(POLITICS_HIGH_7CATS);
    const res = await service.reviewPrompt("敏感选题");
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("politics");
  });

  it("system message 拼接规则库 prompt_hint(包含 politics/pornography 提示)", async () => {
    llm.chat.mockResolvedValueOnce(ALL_LOW_7CATS);
    await service.reviewPrompt("xxx");
    const firstCall = llm.chat.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>,
    ];
    const calledMessages = firstCall[0];
    const sys = calledMessages.find((m) => m.role === "system")?.content ?? "";
    expect(sys).toContain("politics");
    expect(sys).toContain("pornography");
  });
});

describe("reviewSection (Phase 2.5 ③)", () => {
  const SECTION_LOW = JSON.stringify({
    dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
      key,
      score: 0,
      severity: "low",
      hits: [],
      reason: "无",
    })),
  });
  const SECTION_HIGH_POLITICS = JSON.stringify({
    dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
      key,
      score: key === "politics" ? 90 : 0,
      severity: key === "politics" ? "high" : "low",
      hits: key === "politics" ? ["xxx"] : [],
      reason: key === "politics" ? "命中" : "无",
    })),
  });

  let service: ReviewService;
  let llm: { chat: jest.Mock };
  let store: StreamSessionStore;
  let reviewCreate: jest.Mock;

  beforeEach(() => {
    const drafts = {
      assertAuthor: jest.fn().mockResolvedValue({
        title: "标题",
        body: { type: "doc", content: [] },
      }),
    } as unknown as DraftsService;
    llm = { chat: jest.fn() };
    const prompts = {
      findDefaultByTool: jest.fn().mockResolvedValue({ systemPrompt: "你是审核员", params: {} }),
    } as unknown as PromptsService;
    reviewCreate = jest.fn().mockResolvedValue({
      id: "section-review-id",
      stage: "SECTION_INLINE",
      safety: {},
      quality: {},
      recommendation: "WARN",
      modelMeta: {},
      createdAt: new Date(),
    });
    const prisma = { review: { create: reviewCreate } } as unknown as PrismaService;
    store = new StreamSessionStore();
    store.__reset();
    service = new ReviewService(drafts, prisma, llm as unknown as LlmClient, prompts, store);
  });

  it("ALLOW 段落:不落 review,abortStream=false", async () => {
    llm.chat.mockResolvedValueOnce(SECTION_LOW);
    const res = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-allow-1",
      range: { from: 0, to: 50 },
      text: "正常段落内容。",
    });
    expect(res.recommendation).toBe("ALLOW");
    expect(res.abortStream).toBe(false);
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it("medium 段落:写 review + abortStream=false", async () => {
    const SECTION_MEDIUM = JSON.stringify({
      dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
        key,
        score: key === "vulgarity" ? 50 : 0,
        severity: key === "vulgarity" ? "medium" : "low",
        hits: [],
        reason: "",
      })),
    });
    llm.chat.mockResolvedValueOnce(SECTION_MEDIUM);
    const res = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-medium-1",
      range: { from: 0, to: 100 },
      text: "段落",
    });
    expect(res.recommendation).toBe("WARN");
    expect(res.severity).toBe("medium");
    expect(res.abortStream).toBe(false);
    expect(reviewCreate).toHaveBeenCalledTimes(1);
  });

  it("同 sessionId 连续 3 段 high → abortStream=true", async () => {
    llm.chat
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS);
    const sid = "sess-burst-1";
    const r1 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    const r2 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 51, to: 100 },
      text: "段 2",
    });
    const r3 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 101, to: 150 },
      text: "段 3",
    });
    expect(r1.abortStream).toBe(false);
    expect(r2.abortStream).toBe(false);
    expect(r3.abortStream).toBe(true);
  });

  it("不同 sessionId 隔离:互不累计", async () => {
    llm.chat
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS);
    const r1 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-A",
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    const r2 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-B",
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    expect(r1.abortStream).toBe(false);
    expect(r2.abortStream).toBe(false);
  });
});
