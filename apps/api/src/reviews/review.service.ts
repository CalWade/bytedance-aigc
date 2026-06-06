import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { Prisma, Review } from "@prisma/client";
import type {
  PreflightResponse,
  Recommendation,
  ReviewQuality,
  ReviewSafety,
  SafetyDim,
  QualityDim,
  PromptReviewResponse,
  SectionReviewResponse,
  SensitiveCategory,
} from "@bytedance-aigc/shared";
import { SAFETY_KEYS, QUALITY_KEYS, SENSITIVE_CATEGORIES } from "@bytedance-aigc/shared";

import { LlmClient } from "../llm/llm.client";
import { PrismaService } from "../prisma/prisma.service";
import { PromptsService } from "../prompts/prompts.service";
import { DraftsService } from "../drafts/drafts.service";
import { buildPromptHints } from "./rule-loader";
import { StreamSessionStore } from "./stream-session";

const TRUNCATE_LIMIT = 12000;

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly drafts: DraftsService,
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
    private readonly prompts: PromptsService,
    private readonly streamSessions: StreamSessionStore,
  ) {}

  async preflight(draftId: string, userSub: string): Promise<PreflightResponse> {
    const draft = await this.drafts.assertAuthor(draftId, userSub);
    const fullText = this.extractFullText(draft);
    const truncated = fullText.length > TRUNCATE_LIMIT;
    const text = truncated ? fullText.slice(0, TRUNCATE_LIMIT) : fullText;

    const [safetyPrompt, qualityPrompt] = await Promise.all([
      this.prompts.findDefaultByTool("SAFETY_REVIEW"),
      this.prompts.findDefaultByTool("QUALITY_REVIEW"),
    ]);

    const safetyMessages = [
      { role: "system" as const, content: safetyPrompt.systemPrompt },
      { role: "user" as const, content: text },
    ];
    const qualityMessages = [
      { role: "system" as const, content: qualityPrompt.systemPrompt },
      { role: "user" as const, content: text },
    ];

    const t0 = Date.now();
    let safetyRaw = "";
    let qualityRaw = "";
    let safetyMs = 0;
    let qualityMs = 0;
    try {
      const [s, q] = await Promise.all([
        this.timed(() => this.llm.chat(safetyMessages, { temperature: 0.0 })),
        this.timed(() => this.llm.chat(qualityMessages, { temperature: 0.4 })),
      ]);
      safetyRaw = s.value;
      safetyMs = s.ms;
      qualityRaw = q.value;
      qualityMs = q.ms;
    } catch (err) {
      this.logger.warn(`preflight LLM error: ${(err as Error).message}`);
      throw new InternalServerErrorException("LLM 审核失败,请稍后重试");
    }

    const safety = this.parseSafetyOf6Cats(safetyRaw);
    const quality = this.parseQuality(qualityRaw);
    const recommendation = this.recommend(safety, quality);

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          draftId,
          stage: "PREFLIGHT",
          safety: safety as unknown as Prisma.InputJsonValue,
          quality: quality as unknown as Prisma.InputJsonValue,
          recommendation,
          modelMeta: {
            latencyMsSafety: safetyMs,
            latencyMsQuality: qualityMs,
            totalMs: Date.now() - t0,
            truncated,
          },
        },
      });
      await tx.draft.update({ where: { id: draftId }, data: { lastReviewId: created.id } });
      return created;
    });

    return { review: this.toDto(review), recommendation };
  }

  /**
   * Phase 2.5 ① — 选题 + 提示词阶段审核
   * 同步:写 Review 行(stage=PROMPT_INPUT,quality 全 0)
   */
  async reviewPrompt(text: string): Promise<PromptReviewResponse> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      throw new InternalServerErrorException("text 必须非空且 ≤ 1000 字");
    }

    const promptCfg = await this.prompts.findDefaultByTool("PROMPT_REVIEW");
    const messages = [
      { role: "system" as const, content: `${promptCfg.systemPrompt}\n\n${buildPromptHints()}` },
      { role: "user" as const, content: trimmed },
    ];

    let raw = "";
    let ms = 0;
    try {
      const r = await this.timed(() => this.llm.chat(messages, { temperature: 0.0 }));
      raw = r.value;
      ms = r.ms;
    } catch (err) {
      this.logger.warn(`reviewPrompt LLM error: ${(err as Error).message}`);
      // ① 阶段 LLM 失败不阻断作者
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        message: "审核服务暂时不可用,可继续",
        reviewId: "",
      };
    }

    const safety = this.parseSafetyOf7Cats(raw);
    const hitCategories: SensitiveCategory[] = safety.dimensions
      .filter((d) => d.severity === "high" || d.severity === "medium")
      .map((d) => d.key as SensitiveCategory);
    const recommendation = safety.dimensions.some((d) => d.severity === "high")
      ? "BLOCK"
      : safety.dimensions.some((d) => d.severity === "medium")
        ? "WARN"
        : "ALLOW";

    const message =
      recommendation === "ALLOW"
        ? "选题未发现明显风险"
        : `选题可能涉及 ${hitCategories.join("/")},建议调整方向`;

    // WHY: ① 阶段 review 频次高(每次失焦触发),且无关联 draftId(选题尚未落地)。
    //      不落 prisma.review 表,reviewId 仅用作日志追溯。
    const reviewId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.logger.log(
      `reviewPrompt id=${reviewId} rec=${recommendation} hits=${hitCategories.join(",")} ms=${ms}`,
    );

    return { recommendation, hitCategories, message, reviewId };
  }

  /**
   * Phase 2.5 ③ — 流式生成中段落审核
   * 同 sessionId 内连续 ≥ 3 段 high → abortStream
   */
  async reviewSection(input: {
    draftId: string;
    userSub: string;
    sessionId: string;
    range: { from: number; to: number };
    text: string;
  }): Promise<SectionReviewResponse> {
    const { draftId, userSub, sessionId, text } = input;
    await this.drafts.assertAuthor(draftId, userSub);

    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      throw new InternalServerErrorException("section text 必须非空且 ≤ 2000 字");
    }

    const promptCfg = await this.prompts.findDefaultByTool("SECTION_REVIEW");
    const messages = [
      { role: "system" as const, content: `${promptCfg.systemPrompt}\n\n${buildPromptHints()}` },
      { role: "user" as const, content: trimmed },
    ];

    let raw = "";
    let ms = 0;
    try {
      const r = await this.timed(() => this.llm.chat(messages, { temperature: 0.0 }));
      raw = r.value;
      ms = r.ms;
    } catch (err) {
      this.logger.warn(`reviewSection LLM error: ${(err as Error).message}`);
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        severity: "low",
        message: "审核服务暂时不可用",
        abortStream: false,
        reviewId: "",
      };
    }

    const safety = this.parseSafetyOf7Cats(raw);
    const isHigh = safety.dimensions.some((d) => d.severity === "high");
    const isMedium = !isHigh && safety.dimensions.some((d) => d.severity === "medium");
    const recommendation: "ALLOW" | "WARN" | "BLOCK" = isHigh
      ? "BLOCK"
      : isMedium
        ? "WARN"
        : "ALLOW";
    const severity: "low" | "medium" | "high" = isHigh ? "high" : isMedium ? "medium" : "low";
    const hitCategories = safety.dimensions
      .filter((d) => d.severity === "high" || d.severity === "medium")
      .map((d) => d.key as SensitiveCategory);

    const { shouldAbort } = this.streamSessions.recordSegment(sessionId, isHigh);

    let reviewId = "";
    if (recommendation !== "ALLOW") {
      const review = await this.prisma.review.create({
        data: {
          draftId,
          stage: "SECTION_INLINE",
          safety: safety,
          quality: { overall: 0, dimensions: [], note: "本阶段不评质量" },
          recommendation,
          modelMeta: {
            latencyMsSafety: ms,
            latencyMsQuality: 0,
            totalMs: ms,
            truncated: false,
          },
        },
      });
      reviewId = review.id;
    }

    const message =
      recommendation === "ALLOW" ? "段落正常" : `段落可能涉及 ${hitCategories.join("/")}`;

    return { recommendation, hitCategories, severity, message, abortStream: shouldAbort, reviewId };
  }

  async listByDraft(draftId: string, userSub: string, limit = 10): Promise<Review[]> {
    await this.drafts.assertAuthor(draftId, userSub);
    return this.prisma.review.findMany({
      where: { draftId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /** 把 draft.body(TipTap JSONContent)+ 标题拼成 markdown-ish 全文。简单实现:递归取 text 节点。 */
  private extractFullText(draft: { title: string; body: unknown }): string {
    const parts: string[] = [draft.title];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(draft.body);
    return parts.filter(Boolean).join("\n\n");
  }

  private async timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const t = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t };
  }

  /** 严格 JSON parse;失败 / 缺维度 / 维度不全 → fallback BLOCK 风险态。(6 维 preflight 专用) */
  private parseSafetyOf6Cats(raw: string): ReviewSafety {
    const fallback = (note: string): ReviewSafety => ({
      overall: 0,
      dimensions: SAFETY_KEYS.map((key) => ({
        key,
        score: 100,
        severity: "high" as const,
        hits: [],
        reason: "AI 输出格式异常,默认按高风险处理",
      })),
      note,
    });
    let parsed: { dimensions?: unknown };
    try {
      parsed = JSON.parse(raw) as { dimensions?: unknown };
    } catch {
      return fallback("AI 安全审核输出非合法 JSON");
    }
    if (!Array.isArray(parsed.dimensions)) return fallback("AI 安全审核输出缺 dimensions");
    const dims: SafetyDim[] = [];
    for (const key of SAFETY_KEYS) {
      const found = (parsed.dimensions as { key?: string }[]).find((d) => d?.key === key);
      if (!found) return fallback(`AI 输出缺维度 ${key}`);
      const f = found as Record<string, unknown>;
      const score = Number(f.score);
      const severity = f.severity === "high" || f.severity === "medium" ? f.severity : "low";
      dims.push({
        key,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        severity,
        hits: Array.isArray(f.hits)
          ? (f.hits as unknown[]).filter((h) => typeof h === "string").map(String)
          : [],
        reason: typeof f.reason === "string" ? f.reason : undefined,
      });
    }
    const maxScore = Math.max(0, ...dims.map((d) => d.score));
    return { overall: 100 - maxScore, dimensions: dims };
  }

  private parseQuality(raw: string): ReviewQuality {
    const fallback = (note: string): ReviewQuality => ({
      overall: 0,
      dimensions: QUALITY_KEYS.map((key) => ({ key, score: 0, reason: "AI 输出格式异常" })),
      note,
    });
    let parsed: { dimensions?: unknown };
    try {
      parsed = JSON.parse(raw) as { dimensions?: unknown };
    } catch {
      return fallback("AI 质量评分输出非合法 JSON");
    }
    if (!Array.isArray(parsed.dimensions)) return fallback("AI 质量评分输出缺 dimensions");
    const dims: QualityDim[] = [];
    for (const key of QUALITY_KEYS) {
      const found = (parsed.dimensions as { key?: string }[]).find((d) => d?.key === key);
      if (!found) return fallback(`AI 输出缺维度 ${key}`);
      const f = found as Record<string, unknown>;
      const score = Number(f.score);
      dims.push({
        key,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        reason: typeof f.reason === "string" ? f.reason : "",
      });
    }
    const overall = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
    return { overall, dimensions: dims };
  }

  private recommend(safety: ReviewSafety, quality: ReviewQuality): Recommendation {
    if (safety.dimensions.some((d) => d.severity === "high")) return "BLOCK";
    if (safety.dimensions.some((d) => d.severity === "medium")) return "WARN";
    if (quality.overall < 60) return "WARN";
    return "ALLOW";
  }

  private toDto(r: Review): PreflightResponse["review"] {
    return {
      id: r.id,
      stage: r.stage,
      safety: r.safety as unknown as ReviewSafety,
      quality: r.quality as unknown as ReviewQuality,
      recommendation: r.recommendation,
      modelMeta: r.modelMeta as never,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** 7 类目 safety 解析(Phase 2.5 ① ③ 共用)。失败 → fallback 全 high。 */
  private parseSafetyOf7Cats(raw: string): {
    overall: number;
    dimensions: {
      key: string;
      score: number;
      severity: "low" | "medium" | "high";
      hits: string[];
      reason?: string;
    }[];
    note?: string;
  } {
    const fallback = (note: string) => ({
      overall: 0,
      dimensions: SENSITIVE_CATEGORIES.map((key) => ({
        key,
        score: 100,
        severity: "high" as const,
        hits: [],
        reason: "AI 输出格式异常,默认按高风险处理",
      })),
      note,
    });
    let parsed: { dimensions?: unknown };
    try {
      parsed = JSON.parse(raw) as { dimensions?: unknown };
    } catch {
      return fallback("AI 7 类目审核输出非合法 JSON");
    }
    if (!Array.isArray(parsed.dimensions)) return fallback("缺 dimensions");
    const dims: {
      key: string;
      score: number;
      severity: "low" | "medium" | "high";
      hits: string[];
      reason?: string;
    }[] = [];
    for (const key of SENSITIVE_CATEGORIES) {
      const found = (parsed.dimensions as { key?: string }[]).find((d) => d?.key === key);
      if (!found) return fallback(`缺维度 ${key}`);
      const f = found as Record<string, unknown>;
      const score = Number(f.score);
      const severity = f.severity === "high" || f.severity === "medium" ? f.severity : "low";
      dims.push({
        key,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        severity,
        hits: Array.isArray(f.hits)
          ? (f.hits as unknown[]).filter((h) => typeof h === "string").map(String)
          : [],
        reason: typeof f.reason === "string" ? f.reason : undefined,
      });
    }
    const maxScore = Math.max(0, ...dims.map((d) => d.score));
    return { overall: 100 - maxScore, dimensions: dims };
  }
}
