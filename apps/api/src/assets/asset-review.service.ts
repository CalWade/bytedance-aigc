import { Injectable, Logger } from "@nestjs/common";
import type { AssetReviewStatus } from "@prisma/client";

import { LlmClient } from "../llm/llm.client";
import { PromptsService } from "../prompts/prompts.service";

export type ReviewStage = "INGEST" | "PRE_INSERT";

export interface ReviewDimension {
  key: string;
  score: number;
  severity: "high" | "medium" | "low";
  reason: string;
}

export interface AssetReviewResult {
  recommendation: "ALLOW" | "WARN" | "BLOCK";
  dimensions: ReviewDimension[];
  reason: string;
}

interface RawDimension {
  key?: string;
  score?: number;
  severity?: string;
  reason?: string;
}

@Injectable()
export class AssetReviewService {
  private readonly logger = new Logger(AssetReviewService.name);

  constructor(
    private readonly prompts: PromptsService,
    private readonly llm: LlmClient,
  ) {}

  /**
   * PRD §4.6 素材合规校验。
   * INGEST:入库时 — BLOCK 拦截不入库,WARN 入库但标 WARNED
   * PRE_INSERT:插入文章前 — high 只 WARN,不 BLOCK(作者可选择仍使用)
   */
  async reviewAsset(params: {
    mime: string;
    filename: string;
    sceneTags: string[];
    subjectTags: string[];
    aiGenerated: boolean;
    aiDeclared: boolean;
    stage: ReviewStage;
  }): Promise<AssetReviewResult> {
    const fallback = (note: string): AssetReviewResult => {
      this.logger.warn(`reviewAsset fallback: ${note}`);
      return { recommendation: "ALLOW", dimensions: [], reason: note };
    };

    // 构造 user message:元信息摘要给 LLM 做文本启发式推断
    const meta = [
      `MIME: ${params.mime}`,
      `文件名: ${params.filename}`,
      `场景标签: ${params.sceneTags.join(", ") || "无"}`,
      `主体标签: ${params.subjectTags.join(", ") || "无"}`,
      `AI 生成: ${params.aiGenerated ? "是" : "否"}`,
      `作者声明 AI 生成: ${params.aiDeclared ? "是" : "否"}`,
    ].join("\n");

    let prompt: { systemPrompt: string };
    try {
      prompt = await this.prompts.findDefaultByTool("IMAGE_REVIEW");
    } catch (err) {
      return fallback(`IMAGE_REVIEW prompt 缺失: ${(err as Error).message}`);
    }

    let raw = "";
    try {
      raw = await this.llm.chat(
        [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: meta },
        ],
        { temperature: 0.0 },
      );
    } catch (err) {
      return fallback(`LLM error: ${(err as Error).message}`);
    }

    // 解析 LLM JSON
    let dimensions: ReviewDimension[] = [];
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON");
      const parsed = JSON.parse(m[0]) as { dimensions?: RawDimension[] };
      if (!Array.isArray(parsed.dimensions)) throw new Error("missing dimensions array");
      dimensions = parsed.dimensions.map((d) => ({
        key: d.key ?? "unknown",
        score: typeof d.score === "number" ? d.score : 0,
        severity: d.severity === "high" || d.severity === "medium" ? d.severity : "low",
        reason: d.reason ?? "",
      }));
    } catch (err) {
      this.logger.warn(`reviewAsset parse error: ${(err as Error).message}`);
      // 解析失败仍检查 AI 未标注硬规则
      dimensions = [];
    }

    // AI 未标注硬规则:LLM 判 ai_unmarked=high 且作者未声明 → 强制提升
    const aiUnmarked = dimensions.find((d) => d.key === "ai_unmarked");
    if (aiUnmarked && aiUnmarked.severity === "high" && !params.aiDeclared && !params.aiGenerated) {
      aiUnmarked.severity = "high";
      aiUnmarked.reason = aiUnmarked.reason || "疑似 AI 生成但未标注";
    } else if (params.aiGenerated || params.aiDeclared) {
      // 已声明或自动标记,ai_unmarked 降为 low
      const idx = dimensions.findIndex((d) => d.key === "ai_unmarked");
      if (idx !== -1) {
        dimensions[idx].severity = "low";
        dimensions[idx].reason = "已标注 AI 生成";
      }
    }

    const hasHigh = dimensions.some((d) => d.severity === "high");
    const hasMedium = dimensions.some((d) => d.severity === "medium");

    let recommendation: "ALLOW" | "WARN" | "BLOCK";
    if (params.stage === "INGEST") {
      // 入库时:high → BLOCK,medium → WARN
      recommendation = hasHigh ? "BLOCK" : hasMedium ? "WARN" : "ALLOW";
    } else {
      // 插入文章前:high → WARN(作者可选仍使用),medium → WARN
      recommendation = hasHigh || hasMedium ? "WARN" : "ALLOW";
    }

    const hitDimensions = dimensions.filter(
      (d) => d.severity === "high" || d.severity === "medium",
    );
    const reason =
      recommendation === "ALLOW"
        ? "合规校验通过"
        : `命中 ${hitDimensions.map((d) => d.key).join("/")} 维度,建议${recommendation === "BLOCK" ? "拦截" : "警告"}。`;

    this.logger.log(
      `reviewAsset stage=${params.stage} rec=${recommendation} dims=${dimensions.map((d) => `${d.key}=${d.severity}`).join(",")}`,
    );

    return { recommendation, dimensions, reason };
  }

  /** 将 recommendation 映射到 Asset.reviewStatus 枚举 */
  recommendationToStatus(rec: "ALLOW" | "WARN" | "BLOCK"): AssetReviewStatus {
    switch (rec) {
      case "ALLOW":
        return "PASSED";
      case "WARN":
        return "WARNED";
      case "BLOCK":
        return "BLOCKED";
    }
  }
}
