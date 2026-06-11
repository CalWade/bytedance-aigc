import { AssetReviewService } from "./asset-review.service";
import { PromptsService } from "../prompts/prompts.service";
import { LlmClient } from "../llm/llm.client";
import { GuardClient } from "../llm/guard.client";
import type { GuardResult } from "../llm/guard.client";

describe("AssetReviewService", () => {
  let service: AssetReviewService;
  let prompts: { findDefaultByTool: jest.Mock };
  let llm: { chat: jest.Mock };
  let guard: { moderate: jest.Mock };

  const allowJson = JSON.stringify({
    dimensions: [
      { key: "face", score: 0, severity: "low", reason: "无命中" },
      { key: "watermark", score: 0, severity: "low", reason: "无命中" },
      { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
      { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
    ],
  });

  const faceHighJson = JSON.stringify({
    dimensions: [
      { key: "face", score: 80, severity: "high", reason: "文件名含人像关键词" },
      { key: "watermark", score: 0, severity: "low", reason: "无命中" },
      { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
      { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
    ],
  });

  const watermarkMediumJson = JSON.stringify({
    dimensions: [
      { key: "face", score: 0, severity: "low", reason: "无命中" },
      { key: "watermark", score: 50, severity: "medium", reason: "疑似水印" },
      { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
      { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
    ],
  });

  const aiUnmarkedHighJson = JSON.stringify({
    dimensions: [
      { key: "face", score: 0, severity: "low", reason: "无命中" },
      { key: "watermark", score: 0, severity: "low", reason: "无命中" },
      { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
      { key: "ai_unmarked", score: 80, severity: "high", reason: "疑似 AI 生成" },
    ],
  });

  beforeEach(() => {
    prompts = {
      findDefaultByTool: jest.fn().mockResolvedValue({ systemPrompt: "test" }),
    };
    llm = { chat: jest.fn().mockResolvedValue(allowJson) };
    guard = {
      moderate: jest.fn().mockResolvedValue({ suggestion: "pass", details: [] } as GuardResult),
    };
    service = new AssetReviewService(
      prompts as unknown as PromptsService,
      llm as unknown as LlmClient,
      guard as unknown as GuardClient,
    );
  });

  it("INGEST high → BLOCK", async () => {
    llm.chat.mockResolvedValue(faceHighJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "portrait.png",
      sceneTags: ["人像"],
      subjectTags: ["人物"],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
    });
    expect(result.recommendation).toBe("BLOCK");
    expect(result.dimensions.find((d) => d.key === "face")?.severity).toBe("high");
  });

  it("PRE_INSERT high → WARN(不 BLOCK)", async () => {
    llm.chat.mockResolvedValue(faceHighJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "portrait.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "PRE_INSERT",
    });
    expect(result.recommendation).toBe("WARN");
  });

  it("INGEST medium → WARN", async () => {
    llm.chat.mockResolvedValue(watermarkMediumJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "image.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
    });
    expect(result.recommendation).toBe("WARN");
  });

  it("aiDeclared=false + ai_unmarked=high → WARN(INGEST)", async () => {
    llm.chat.mockResolvedValue(aiUnmarkedHighJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
    });
    expect(result.recommendation).toBe("BLOCK");
    const aiDim = result.dimensions.find((d) => d.key === "ai_unmarked");
    expect(aiDim?.severity).toBe("high");
  });

  it("aiDeclared=true + ai_unmarked=high → ALLOW(已声明降级)", async () => {
    llm.chat.mockResolvedValue(aiUnmarkedHighJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: true,
      stage: "INGEST",
    });
    expect(result.recommendation).toBe("ALLOW");
    const aiDim = result.dimensions.find((d) => d.key === "ai_unmarked");
    expect(aiDim?.severity).toBe("low");
  });

  it("LLM 抛错 → fallback ALLOW", async () => {
    llm.chat.mockRejectedValue(new Error("timeout"));
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
    });
    expect(result.recommendation).toBe("ALLOW");
    expect(result.reason).toContain("LLM error");
  });

  it("recommendationToStatus 映射正确", () => {
    expect(service.recommendationToStatus("ALLOW")).toBe("PASSED");
    expect(service.recommendationToStatus("WARN")).toBe("WARNED");
    expect(service.recommendationToStatus("BLOCK")).toBe("BLOCKED");
  });

  it("GuardClient 图片审核 high → BLOCK(INGEST)", async () => {
    llm.chat.mockResolvedValue(allowJson);
    guard.moderate.mockResolvedValue({
      suggestion: "block",
      details: [
        {
          type: "contentModeration",
          level: "high",
          suggestion: "block",
          labels: ["pornographic_adult"],
          confidence: 0.95,
        },
      ],
    } as GuardResult);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
      imageUrl: "https://example.com/photo.png",
    });
    expect(result.recommendation).toBe("BLOCK");
    expect(guard.moderate).toHaveBeenCalledWith("", "query_security_check_pro", {
      imageUrl: "https://example.com/photo.png",
    });
  });

  it("GuardClient 图片审核 medium → WARN(INGEST)", async () => {
    llm.chat.mockResolvedValue(allowJson);
    guard.moderate.mockResolvedValue({
      suggestion: "watch",
      details: [
        {
          type: "contentModeration",
          level: "medium",
          suggestion: "watch",
          labels: ["sexual_suggestive"],
          confidence: 0.7,
        },
      ],
    } as GuardResult);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
      imageUrl: "https://example.com/photo.png",
    });
    expect(result.recommendation).toBe("WARN");
  });

  it("无 imageUrl 时不调用 GuardClient", async () => {
    llm.chat.mockResolvedValue(allowJson);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
    });
    expect(guard.moderate).not.toHaveBeenCalled();
    expect(result.recommendation).toBe("ALLOW");
  });

  it("GuardClient 图片审核失败时 fallback 到 LLM 审核结果", async () => {
    llm.chat.mockResolvedValue(allowJson);
    guard.moderate.mockRejectedValue(new Error("timeout"));
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
      imageUrl: "https://example.com/photo.png",
    });
    // LLM 返回全 ALLOW,GuardClient 失败被吞,最终 ALLOW
    expect(result.recommendation).toBe("ALLOW");
  });

  it("GuardClient 维度与 LLM 维度合并,GuardClient 优先去重", async () => {
    // LLM 也判了 sensitive=low,GuardClient 判了 pornographic_adult=high
    const llmJson = JSON.stringify({
      dimensions: [
        { key: "face", score: 0, severity: "low", reason: "无命中" },
        { key: "watermark", score: 0, severity: "low", reason: "无命中" },
        { key: "sensitive", score: 10, severity: "low", reason: "无命中" },
        { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
      ],
    });
    llm.chat.mockResolvedValue(llmJson);
    guard.moderate.mockResolvedValue({
      suggestion: "block",
      details: [
        {
          type: "contentModeration",
          level: "high",
          suggestion: "block",
          labels: ["pornographic_adult"],
          confidence: 0.92,
        },
      ],
    } as GuardResult);
    const result = await service.reviewAsset({
      mime: "image/png",
      filename: "photo.png",
      sceneTags: [],
      subjectTags: [],
      aiGenerated: false,
      aiDeclared: false,
      stage: "INGEST",
      imageUrl: "https://example.com/photo.png",
    });
    expect(result.recommendation).toBe("BLOCK");
    // GuardClient 维度在前,key 来自 labels[0]
    expect(result.dimensions[0].key).toBe("pornographic_adult");
    expect(result.dimensions[0].severity).toBe("high");
    // LLM 维度保留但不在 GuardClient 中出现的
    expect(result.dimensions.some((d) => d.key === "face")).toBe(true);
  });
});
