import { SENSITIVE_CATEGORIES as SENSITIVE_CATEGORIES_FOR_TEST } from "@bytedance-aigc/shared";

import { LlmClient } from "../llm/llm.client";
import { GuardClient } from "../llm/guard.client";
import type { GuardResult } from "../llm/guard.client";
import { PrismaService } from "../prisma/prisma.service";
import { PromptsService } from "../prompts/prompts.service";
import { DraftsService } from "../drafts/drafts.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ReviewService } from "./review.service";
import { StreamSessionStore } from "./stream-session";
import { DEMO_AUTHOR_ID } from "../../prisma/fixtures";

const ALL_PASS_GUARD: GuardResult = { suggestion: "pass", details: [] };

const PORN_HIGH_GUARD: GuardResult = {
  suggestion: "block",
  details: [
    {
      type: "contentModeration",
      level: "high",
      suggestion: "block",
      labels: ["pornographic_adult"],
      confidence: 99.5,
    },
  ],
};

const ABUSE_MEDIUM_GUARD: GuardResult = {
  suggestion: "watch",
  details: [
    {
      type: "contentModeration",
      level: "medium",
      suggestion: "watch",
      labels: ["inappropriate_profanity"],
      confidence: 75.0,
    },
  ],
};

const DRUGS_HIGH_GUARD: GuardResult = {
  suggestion: "block",
  details: [
    {
      type: "contentModeration",
      level: "high",
      suggestion: "block",
      labels: ["contraband_drug"],
      confidence: 98.0,
    },
  ],
};

const SAFETY_ALL_LOW = JSON.stringify({
  dimensions: [
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "abuse", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "illicit_ads", score: 0, severity: "low", hits: [], reason: "无命中" },
  ],
});

const SAFETY_PORN_HIGH = JSON.stringify({
  dimensions: [
    { key: "pornography", score: 85, severity: "high", hits: ["色情内容"], reason: "色情推广" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "abuse", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "illicit_ads", score: 0, severity: "low", hits: [], reason: "无命中" },
  ],
});

const SAFETY_ABUSE_MEDIUM = JSON.stringify({
  dimensions: [
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "abuse", score: 60, severity: "medium", hits: ["辱骂"], reason: "轻度辱骂" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无命中" },
    { key: "illicit_ads", score: 0, severity: "low", hits: [], reason: "无命中" },
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

/**
 * 构造 ReviewService 及其 mock 依赖。
 * preflight 调用 2 次 llm.chat（安全+质量），其他方法调用 1 次（安全）。
 * 用 mockImplementation 区分：messages 含 QUALITY_REVIEW system prompt → 返回 qualityRaw，
 * 否则 → 返回 safetyRaw。
 */
function makeService(guardResult: GuardResult, qualityRaw: string, safetyRaw = SAFETY_ALL_LOW) {
  const drafts = {
    assertAuthor: jest.fn().mockResolvedValue({
      title: "测试文章标题",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "这是一篇用于单元测试的模拟文章正文内容，需要足够长的文字来确保质量评分的完整路径被正确触发和验证。",
              },
            ],
          },
        ],
      },
    }),
  } as unknown as DraftsService;
  const guard = {
    moderate: jest.fn().mockResolvedValue(guardResult),
  } as unknown as GuardClient;
  const llm = {
    chat: jest.fn().mockImplementation((messages: { role: string; content: string }[]) => {
      // quality path 的 system prompt 含 "4 个维度" 或 "质量"
      const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
      if (sysMsg.includes("质量") || sysMsg.includes("4 个维度") || sysMsg.includes("资深编辑")) {
        return Promise.resolve(qualityRaw);
      }
      return Promise.resolve(safetyRaw);
    }),
  } as unknown as LlmClient;
  const prompts = {
    findDefaultByTool: jest.fn().mockImplementation((tool: string) => {
      if (tool === "QUALITY_REVIEW") {
        return Promise.resolve({
          systemPrompt: "你是头条资深编辑。请对给定文章按 4 个维度打分",
          params: {},
        });
      }
      return Promise.resolve({ systemPrompt: "你是审核员", params: {} });
    }),
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
  const notifications = {
    create: jest.fn().mockResolvedValue({ id: "notif1" }),
  } as unknown as NotificationsService;
  return {
    service: new ReviewService(drafts, prisma, llm, guard, prompts, store, notifications),
    guard,
    llm,
    prisma,
    drafts,
    store,
    notifications,
  };
}

describe("ReviewService.preflight", () => {
  it("全 pass + 高质量 → ALLOW", async () => {
    const { service } = makeService(ALL_PASS_GUARD, HIGH_QUALITY);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("ALLOW");
  });

  it("Guard 返回 high → BLOCK", async () => {
    const { service } = makeService(PORN_HIGH_GUARD, HIGH_QUALITY);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });

  it("Guard 返回 medium → WARN", async () => {
    const { service } = makeService(ABUSE_MEDIUM_GUARD, HIGH_QUALITY);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("WARN");
  });

  it("safety 全 low + quality.overall<60 → WARN", async () => {
    const { service } = makeService(ALL_PASS_GUARD, LOW_QUALITY);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("WARN");
  });

  it("Guard API 抛错 → InternalServerErrorException", async () => {
    const { service, guard } = makeService(ALL_PASS_GUARD, HIGH_QUALITY);
    (guard.moderate as jest.Mock).mockRejectedValueOnce(new Error("timeout"));
    await expect(service.preflight("d1", "u1")).rejects.toThrow("审核失败,请稍后重试");
  });

  it("drugs 高危 → BLOCK", async () => {
    const { service } = makeService(DRUGS_HIGH_GUARD, HIGH_QUALITY);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });

  it("LLM 路检出 high 但 Guard pass → merge 后 BLOCK", async () => {
    const { service } = makeService(ALL_PASS_GUARD, HIGH_QUALITY, SAFETY_PORN_HIGH);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("BLOCK");
  });

  it("LLM 路检出 medium + Guard pass → WARN", async () => {
    const { service } = makeService(ALL_PASS_GUARD, HIGH_QUALITY, SAFETY_ABUSE_MEDIUM);
    const res = await service.preflight("d1", "u1");
    expect(res.recommendation).toBe("WARN");
  });
});

describe("reviewPrompt (Phase 2.5 ①)", () => {
  let service: ReviewService;
  let guard: { moderate: jest.Mock };
  let llm: { chat: jest.Mock };

  beforeEach(() => {
    const drafts = {} as unknown as DraftsService;
    guard = { moderate: jest.fn() };
    llm = { chat: jest.fn().mockResolvedValue(SAFETY_ALL_LOW) };
    const prompts = {
      findDefaultByTool: jest.fn().mockResolvedValue({ systemPrompt: "你是审核员", params: {} }),
    } as unknown as PromptsService;
    const prisma = {} as unknown as PrismaService;
    const store = new StreamSessionStore();
    const notifications = {
      create: jest.fn().mockResolvedValue({ id: "n1" }),
    } as unknown as NotificationsService;
    service = new ReviewService(
      drafts,
      prisma,
      llm as unknown as LlmClient,
      guard as unknown as GuardClient,
      prompts,
      store,
      notifications,
    );
  });

  it("ALLOW happy path:全 pass → recommendation ALLOW + hitCategories 空", async () => {
    guard.moderate.mockResolvedValueOnce(ALL_PASS_GUARD);
    const res = await service.reviewPrompt("正常选题文本");
    expect(res.recommendation).toBe("ALLOW");
    expect(res.hitCategories).toEqual([]);
    expect(res.reviewId).toEqual(expect.any(String));
  });

  it("pornography high → recommendation BLOCK + hitCategories 包含 pornography", async () => {
    guard.moderate.mockResolvedValueOnce(PORN_HIGH_GUARD);
    const res = await service.reviewPrompt("敏感选题");
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("pornography");
  });

  it("LLM 路检出 high → merge 后 BLOCK", async () => {
    guard.moderate.mockResolvedValueOnce(ALL_PASS_GUARD);
    llm.chat.mockResolvedValueOnce(SAFETY_PORN_HIGH);
    const res = await service.reviewPrompt("暗语选题");
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("pornography");
  });

  it("双路抛错 → fallback ALLOW + 不阻断作者", async () => {
    guard.moderate.mockRejectedValueOnce(new Error("network down"));
    llm.chat.mockRejectedValueOnce(new Error("llm down"));
    const res = await service.reviewPrompt("选题");
    expect(res.recommendation).toBe("ALLOW");
    expect(res.hitCategories).toEqual([]);
  });
});

describe("reviewSection (Phase 2.5 ③)", () => {
  const SECTION_LOW_GUARD: GuardResult = { suggestion: "pass", details: [] };
  const SECTION_HIGH_PORN_GUARD: GuardResult = PORN_HIGH_GUARD;
  const SECTION_MEDIUM_ABUSE_GUARD: GuardResult = ABUSE_MEDIUM_GUARD;

  let service: ReviewService;
  let guard: { moderate: jest.Mock };
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
    guard = { moderate: jest.fn() };
    llm = { chat: jest.fn().mockResolvedValue(SAFETY_ALL_LOW) };
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
    const notifications = {
      create: jest.fn().mockResolvedValue({ id: "n1" }),
    } as unknown as NotificationsService;
    service = new ReviewService(
      drafts,
      prisma,
      llm as unknown as LlmClient,
      guard as unknown as GuardClient,
      prompts,
      store,
      notifications,
    );
  });

  it("ALLOW 段落:不落 review,abortStream=false", async () => {
    guard.moderate.mockResolvedValueOnce(SECTION_LOW_GUARD);
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
    guard.moderate.mockResolvedValueOnce(SECTION_MEDIUM_ABUSE_GUARD);
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
    guard.moderate
      .mockResolvedValueOnce(SECTION_HIGH_PORN_GUARD)
      .mockResolvedValueOnce(SECTION_HIGH_PORN_GUARD)
      .mockResolvedValueOnce(SECTION_HIGH_PORN_GUARD);
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
    guard.moderate
      .mockResolvedValueOnce(SECTION_HIGH_PORN_GUARD)
      .mockResolvedValueOnce(SECTION_HIGH_PORN_GUARD);
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

  it("LLM 路检出 high + Guard pass → merge 后 BLOCK", async () => {
    guard.moderate.mockResolvedValueOnce(SECTION_LOW_GUARD);
    llm.chat.mockResolvedValueOnce(SAFETY_PORN_HIGH);
    const res = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-llm-1",
      range: { from: 0, to: 50 },
      text: "暗语段落",
    });
    expect(res.recommendation).toBe("BLOCK");
  });
});

describe("reviewPostPublish (Phase 2.6)", () => {
  let service: ReviewService;
  let guard: { moderate: jest.Mock };
  let llm: { chat: jest.Mock };

  beforeEach(() => {
    const drafts = {} as unknown as DraftsService;
    guard = { moderate: jest.fn() };
    llm = { chat: jest.fn().mockResolvedValue(SAFETY_ALL_LOW) };
    const prompts = {
      findDefaultByTool: jest.fn().mockResolvedValue({
        systemPrompt: "你是社区复审员",
        params: {},
      }),
    };
    const prisma = {} as unknown as PrismaService;
    const store = new StreamSessionStore();
    const notifications = {
      create: jest.fn().mockResolvedValue({ id: "n1" }),
    } as unknown as NotificationsService;
    service = new ReviewService(
      drafts,
      prisma,
      llm as unknown as LlmClient,
      guard as unknown as GuardClient,
      prompts as unknown as PromptsService,
      store,
      notifications,
    );
  });

  it("ALLOW happy path:全 pass → recommendation ALLOW + hitCategories 空", async () => {
    guard.moderate.mockResolvedValueOnce(ALL_PASS_GUARD);
    const res = await service.reviewPostPublish("正常文章内容");
    expect(res.recommendation).toBe("ALLOW");
    expect(res.hitCategories).toEqual([]);
    expect(typeof res.reason).toBe("string");
  });

  it("medium 命中 → WARN + hitCategories 含命中类目", async () => {
    guard.moderate.mockResolvedValueOnce(ABUSE_MEDIUM_GUARD);
    const res = await service.reviewPostPublish("内容");
    expect(res.recommendation).toBe("WARN");
    expect(res.hitCategories).toContain("abuse");
  });

  it("high 命中 → BLOCK", async () => {
    guard.moderate.mockResolvedValueOnce(PORN_HIGH_GUARD);
    const res = await service.reviewPostPublish("内容");
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("pornography");
  });

  it("LLM 路检出 high + Guard pass → merge 后 BLOCK", async () => {
    guard.moderate.mockResolvedValueOnce(ALL_PASS_GUARD);
    llm.chat.mockResolvedValueOnce(SAFETY_PORN_HIGH);
    const res = await service.reviewPostPublish("暗语内容");
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("pornography");
  });

  it("双路抛错 → fallback ALLOW + reason 含'审核复审失败'", async () => {
    guard.moderate.mockRejectedValueOnce(new Error("network down"));
    llm.chat.mockRejectedValueOnce(new Error("llm down"));
    const res = await service.reviewPostPublish("内容");
    expect(res.recommendation).toBe("ALLOW");
    expect(res.reason).toContain("审核复审失败");
    expect(res.hitCategories).toEqual([]);
  });

  it("text 为空 → 不调 Guard,直接 fallback ALLOW", async () => {
    const res = await service.reviewPostPublish("   ");
    expect(res.recommendation).toBe("ALLOW");
    expect(guard.moderate).not.toHaveBeenCalled();
  });
});

describe("mergeSafety", () => {
  let service: ReviewService;

  beforeEach(() => {
    const mocks = {
      drafts: {},
      prisma: {},
      llm: { chat: jest.fn() },
      guard: { moderate: jest.fn() },
      prompts: { findDefaultByTool: jest.fn() },
      store: new StreamSessionStore(),
      notifications: { create: jest.fn() },
    };
    service = new ReviewService(
      mocks.drafts as unknown as DraftsService,
      mocks.prisma as unknown as PrismaService,
      mocks.llm as unknown as LlmClient,
      mocks.guard as unknown as GuardClient,
      mocks.prompts as unknown as PromptsService,
      mocks.store,
      mocks.notifications as unknown as NotificationsService,
    );
  });

  it("Guard high + LLM low → 取 high", () => {
    // 通过间接方式测试：两个路径的结果合并
    const guardSafety = {
      overall: 0,
      dimensions: [
        {
          key: "pornography" as const,
          score: 85,
          severity: "high" as const,
          hits: ["色情"],
          reason: "Guard 检出",
        },
        {
          key: "gambling" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
        { key: "drugs" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "abuse" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "fraud" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        {
          key: "illicit_ads" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
      ],
    };
    const llmSafety = {
      overall: 100,
      dimensions: SAFETY_ALL_LOW ? JSON.parse(SAFETY_ALL_LOW).dimensions : [],
    };
    // Access private method via any
    const merged = (service as any).mergeSafety(guardSafety, llmSafety);
    expect(merged.dimensions[0].severity).toBe("high");
    expect(merged.dimensions[0].score).toBe(85);
    expect(merged.overall).toBe(15);
  });

  it("Guard low + LLM high → 取 high", () => {
    const guardSafety = {
      overall: 100,
      dimensions: [
        {
          key: "pornography" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
        {
          key: "gambling" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
        { key: "drugs" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "abuse" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "fraud" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        {
          key: "illicit_ads" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
      ],
    };
    const llmSafety = {
      overall: 0,
      dimensions: JSON.parse(SAFETY_PORN_HIGH).dimensions,
    };
    const merged = (service as any).mergeSafety(guardSafety, llmSafety);
    expect(merged.dimensions[0].severity).toBe("high");
    expect(merged.dimensions[0].hits).toContain("色情内容");
  });

  it("双路都命中不同维度 → 合并所有命中", () => {
    const guardSafety = {
      overall: 0,
      dimensions: [
        {
          key: "pornography" as const,
          score: 85,
          severity: "high" as const,
          hits: ["色情"],
          reason: "Guard 检出",
        },
        {
          key: "gambling" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
        { key: "drugs" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "abuse" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        { key: "fraud" as const, score: 0, severity: "low" as const, hits: [], reason: undefined },
        {
          key: "illicit_ads" as const,
          score: 0,
          severity: "low" as const,
          hits: [],
          reason: undefined,
        },
      ],
    };
    const llmSafety = {
      overall: 40,
      dimensions: JSON.parse(SAFETY_ABUSE_MEDIUM).dimensions,
    };
    const merged = (service as any).mergeSafety(guardSafety, llmSafety);
    expect(merged.dimensions[0].severity).toBe("high"); // pornography from Guard
    expect(merged.dimensions[3].severity).toBe("medium"); // abuse from LLM
    expect(merged.overall).toBe(15); // 100 - max(85, 60) = 15
  });
});

describe("emptyQuality (短内容跳过 LLM 质量评分)", () => {
  let service: ReviewService;

  beforeEach(() => {
    const mocks = {
      drafts: {},
      prisma: {},
      llm: { chat: jest.fn() },
      guard: { moderate: jest.fn() },
      prompts: { findDefaultByTool: jest.fn() },
      store: new StreamSessionStore(),
      notifications: { create: jest.fn() },
    };
    service = new ReviewService(
      mocks.drafts as unknown as DraftsService,
      mocks.prisma as unknown as PrismaService,
      mocks.llm as unknown as LlmClient,
      mocks.guard as unknown as GuardClient,
      mocks.prompts as unknown as PromptsService,
      mocks.store,
      mocks.notifications as unknown as NotificationsService,
    );
  });

  it("emptyQuality 返回 overall=0, 各维度 score=0", () => {
    const q = (service as any).emptyQuality() as ReviewQuality;
    expect(q.overall).toBe(0);
    expect(q.dimensions).toHaveLength(4);
    for (const d of q.dimensions) {
      expect(d.score).toBe(0);
      expect(d.reason).toContain("内容不足");
    }
    expect(q.note).toContain("正文过短");
  });

  it("overall=0 时 recommend 返回 WARN (quality<60)", () => {
    const q = (service as any).emptyQuality() as ReviewQuality;
    const safety = {
      overall: 100,
      dimensions: [
        { key: "pornography", score: 0, severity: "low", hits: [], reason: "" },
        { key: "gambling", score: 0, severity: "low", hits: [], reason: "" },
        { key: "drugs", score: 0, severity: "low", hits: [], reason: "" },
        { key: "abuse", score: 0, severity: "low", hits: [], reason: "" },
        { key: "fraud", score: 0, severity: "low", hits: [], reason: "" },
        { key: "illicit_ads", score: 0, severity: "low", hits: [], reason: "" },
      ],
    };
    const rec = (service as any).recommend(safety, q);
    expect(rec).toBe("WARN");
  });
});
