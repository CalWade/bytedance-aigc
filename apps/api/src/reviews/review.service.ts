import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { Prisma, Review, DraftToolType } from "@prisma/client";
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
  SafetyKey,
  Severity,
} from "@bytedance-aigc/shared";
import { SAFETY_KEYS, QUALITY_KEYS } from "@bytedance-aigc/shared";

import { LlmClient } from "../llm/llm.client";
import {
  GuardClient,
  mapGuardLabelsToSensitive,
  mapGuardLevelToSeverity,
} from "../llm/guard.client";
import type { GuardResult } from "../llm/guard.client";
import { PrismaService } from "../prisma/prisma.service";
import { PromptsService } from "../prompts/prompts.service";
import { NotificationsService } from "../notifications/notifications.service";
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
    private readonly guard: GuardClient,
    private readonly prompts: PromptsService,
    private readonly streamSessions: StreamSessionStore,
    private readonly notifications: NotificationsService,
  ) {}

  async preflight(draftId: string, userSub: string): Promise<PreflightResponse> {
    const draft = await this.drafts.assertAuthor(draftId, userSub);
    const fullText = this.extractFullText(draft);
    const truncated = fullText.length > TRUNCATE_LIMIT;
    const text = truncated ? fullText.slice(0, TRUNCATE_LIMIT) : fullText;
    const isShortContent = text.replace(/\s/g, "").length < 50;

    const t0 = Date.now();
    let guardResult: GuardResult | undefined;
    let llmRaw = "";
    let safetyMs = 0;
    let qualityMs = 0;
    let quality: ReviewQuality;
    try {
      const safetyTasks = [
        this.timed(() => this.guard.moderate(text, "query_security_check_pro")),
        this.timed(() => this.llmChatSafety(text, "SAFETY_REVIEW")),
      ];
      const qualityTask: Promise<{ value: ReviewQuality; ms: number }> = isShortContent
        ? Promise.resolve({ value: this.emptyQuality(), ms: 0 })
        : this.timed(async () => {
            const qualityPrompt = await this.prompts.findDefaultByTool("QUALITY_REVIEW");
            const qualityMessages = [
              { role: "system" as const, content: qualityPrompt.systemPrompt },
              { role: "user" as const, content: text },
            ];
            const raw = await this.llm.chat(qualityMessages, { temperature: 0.4 });
            return this.parseQuality(raw);
          });
      const results = await Promise.all([...safetyTasks, qualityTask]);
      const g = results[0] as { value: GuardResult; ms: number };
      const l = results[1] as { value: string; ms: number };
      const q = results[2] as { value: ReviewQuality; ms: number };
      guardResult = g.value;
      safetyMs = g.ms + l.ms;
      llmRaw = l.value;
      qualityMs = q.ms;
      quality = q.value;
    } catch (err) {
      this.logger.error(`preflight error: ${(err as Error).message}`, (err as Error).stack);
      throw new InternalServerErrorException("审核失败,请稍后重试");
    }

    const guardSafety = this.guardResultToSafety(guardResult!);
    const llmSafety = this.parseSafetyByCategories(llmRaw);
    const safety = this.mergeSafety(guardSafety, llmSafety);
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
            guardEngine: "alibaba-cloud-guard+llm-hybrid",
          },
        },
      });
      await tx.draft.update({ where: { id: draftId }, data: { lastReviewId: created.id } });
      return created;
    });

    if (recommendation === "BLOCK") {
      try {
        await this.notifications.create({
          userId: userSub,
          type: "PUBLISH_REJECTED",
          title: "发布驳回",
          body: `《${draft.title}》预检未通过,请修改后重试`,
          draftId,
        });
      } catch (err) {
        this.logger.error(`preflight BLOCK notification failed for draft ${draftId}`, err as Error);
      }
    }

    return { review: this.toDto(review), recommendation };
  }

  /**
   * Phase 2.5 ① — 选题 + 提示词阶段审核
   */
  async reviewPrompt(text: string): Promise<PromptReviewResponse> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      throw new InternalServerErrorException("text 必须非空且 ≤ 1000 字");
    }

    let guardResult: GuardResult | undefined;
    let llmRaw = "";
    let ms = 0;
    try {
      const [g, l] = await Promise.all([
        this.timed(() => this.guard.moderate(trimmed, "query_security_check_pro")),
        this.timed(() => this.llmChatSafety(trimmed, "PROMPT_REVIEW")),
      ]);
      guardResult = g.value;
      llmRaw = l.value;
      ms = g.ms + l.ms;
    } catch (err) {
      this.logger.warn(`reviewPrompt error: ${(err as Error).message}`);
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        message: "审核服务暂时不可用,可继续",
        reviewId: "",
      };
    }

    const guardSafety = this.guardResultToSafety(guardResult!);
    const llmSafety = this.parseSafetyByCategories(llmRaw);
    const safety = this.mergeSafety(guardSafety, llmSafety);
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

    let guardResult: GuardResult | undefined;
    let llmRaw = "";
    let ms = 0;
    try {
      const [g, l] = await Promise.all([
        this.timed(() => this.guard.moderate(trimmed, "query_security_check_pro", { sessionId })),
        this.timed(() => this.llmChatSafety(trimmed, "SECTION_REVIEW")),
      ]);
      guardResult = g.value;
      llmRaw = l.value;
      ms = g.ms + l.ms;
    } catch (err) {
      this.logger.warn(`reviewSection error: ${(err as Error).message}`);
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        severity: "low",
        message: "审核服务暂时不可用",
        abortStream: false,
        reviewId: "",
      };
    }

    const guardSafety = this.guardResultToSafety(guardResult!);
    const llmSafety = this.parseSafetyByCategories(llmRaw);
    const safety = this.mergeSafety(guardSafety, llmSafety);
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
          safety: safety as unknown as Prisma.InputJsonValue,
          quality: { overall: 0, dimensions: [], note: "本阶段不评质量" },
          recommendation,
          modelMeta: {
            latencyMsSafety: ms,
            latencyMsQuality: 0,
            totalMs: ms,
            truncated: false,
            guardEngine: "alibaba-cloud-guard+llm-hybrid",
          },
        },
      });
      reviewId = review.id;
    }

    const message =
      recommendation === "ALLOW" ? "段落正常" : `段落可能涉及 ${hitCategories.join("/")}`;

    return { recommendation, hitCategories, severity, message, abortStream: shouldAbort, reviewId };
  }

  /**
   * Phase 2.6 — 发布后举报触发的 LLM 复审。
   * 由 ReportsService.create fire-and-forget 调用,失败 fallback 到"默认放行,等待 admin 人工裁决"。
   */
  async reviewPostPublish(text: string): Promise<{
    recommendation: "ALLOW" | "WARN" | "BLOCK";
    reason: string;
    hitCategories: SensitiveCategory[];
  }> {
    const fallback = (note: string) => {
      this.logger.warn(`reviewPostPublish fallback: ${note}`);
      return {
        recommendation: "ALLOW" as const,
        reason: "审核复审失败,默认放行,等待 admin 人工裁决",
        hitCategories: [] as SensitiveCategory[],
      };
    };

    const trimmed = text.trim();
    if (trimmed.length === 0) return fallback("text 为空");
    const truncated = trimmed.length > TRUNCATE_LIMIT ? trimmed.slice(0, TRUNCATE_LIMIT) : trimmed;

    let guardResult: GuardResult | undefined;
    let llmRaw = "";
    try {
      const [g, l] = await Promise.all([
        this.guard.moderate(truncated, "response_security_check_pro"),
        this.llmChatSafety(truncated, "POST_PUBLISH_REVIEW"),
      ]);
      guardResult = g;
      llmRaw = l;
    } catch (err) {
      return fallback(`双路审核失败: ${(err as Error).message}`);
    }

    const guardSafety = this.guardResultToSafety(guardResult!);
    const llmSafety = this.parseSafetyByCategories(llmRaw);
    const safety = this.mergeSafety(guardSafety, llmSafety);
    const hitCategories: SensitiveCategory[] = safety.dimensions
      .filter((d) => d.severity === "high" || d.severity === "medium")
      .map((d) => d.key as SensitiveCategory);
    const recommendation: "ALLOW" | "WARN" | "BLOCK" = safety.dimensions.some(
      (d) => d.severity === "high",
    )
      ? "BLOCK"
      : safety.dimensions.some((d) => d.severity === "medium")
        ? "WARN"
        : "ALLOW";

    const reason =
      recommendation === "ALLOW"
        ? "复审未发现高风险类目,建议保留。"
        : `复审命中 ${hitCategories.join("/")} 类目,建议 ${recommendation === "BLOCK" ? "下线" : "警告"}。`;

    this.logger.log(`reviewPostPublish rec=${recommendation} hits=${hitCategories.join(",")}`);

    return { recommendation, reason, hitCategories };
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

  /**
   * LLM 兜底路径：加载 prompt + 规则库 hints + chat，返回 raw 字符串。
   */
  private async llmChatSafety(text: string, tool: DraftToolType): Promise<string> {
    const prompt = await this.prompts.findDefaultByTool(tool);
    const hints = buildPromptHints();
    const userContent = hints ? `${hints}\n\n待审文本:\n${text}` : text;
    const messages = [
      { role: "system" as const, content: prompt.systemPrompt },
      { role: "user" as const, content: userContent },
    ];
    return this.llm.chat(messages, { temperature: 0.0 });
  }

  /**
   * 合并 Guard 路与 LLM 路的审核结果：每个维度取更高 severity。
   */
  private mergeSafety(guard: ReviewSafety, llm: ReviewSafety): ReviewSafety {
    const severityOrder: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
    const dimensions = SAFETY_KEYS.map((key) => {
      const g = guard.dimensions.find((d) => d.key === key) ?? {
        key,
        score: 0,
        severity: "low" as const,
        hits: [],
        reason: undefined,
      };
      const l = llm.dimensions.find((d) => d.key === key) ?? {
        key,
        score: 0,
        severity: "low" as const,
        hits: [],
        reason: undefined,
      };
      const guardWins = (severityOrder[g.severity] ?? 0) >= (severityOrder[l.severity] ?? 0);
      const winner = guardWins ? g : l;
      const loser = guardWins ? l : g;
      const mergedHits = [
        ...new Set([...winner.hits, ...loser.hits.filter((h) => !winner.hits.includes(h))]),
      ];
      return {
        key: key as SafetyKey,
        score: Math.max(g.score, l.score),
        severity: winner.severity,
        hits: mergedHits,
        reason: winner.reason ?? loser.reason,
      };
    });
    const maxScore = Math.max(0, ...dimensions.map((d) => d.score));
    return { overall: 100 - maxScore, dimensions };
  }

  /**
   * 将 GuardClient 结构化响应转换为 ReviewSafety。
   */
  private guardResultToSafety(result: GuardResult): ReviewSafety {
    const contentDetail = result.details.find((d) => d.type === "contentModeration");
    const labels = contentDetail?.labels ?? [];
    const hitCategories = mapGuardLabelsToSensitive(labels);
    const level = contentDetail?.level ?? "none";
    const overallSeverity = mapGuardLevelToSeverity(level);

    const dimensions = SAFETY_KEYS.map((key) => {
      const isHit = hitCategories.includes(key as SensitiveCategory);
      const severity: Severity = isHit ? overallSeverity : "low";
      const score = isHit ? (severity === "high" ? 100 : severity === "medium" ? 60 : 20) : 0;
      return {
        key: key as SafetyKey,
        score,
        severity,
        hits: isHit ? [key] : [],
        reason: isHit ? "Guard 检出" : undefined,
      };
    });

    const maxScore = Math.max(0, ...dimensions.map((d) => d.score));
    return { overall: 100 - maxScore, dimensions };
  }

  /**
   * 解析 LLM 返回的 JSON 字符串为 ReviewSafety（兜底路径）。
   * 适配新 6 类目：pornography, gambling, drugs, abuse, fraud, illicit_ads。
   */
  private parseSafetyByCategories(raw: string): ReviewSafety {
    const fallback = (note: string): ReviewSafety => ({
      overall: 100,
      dimensions: SAFETY_KEYS.map((key) => ({
        key,
        score: 0,
        severity: "low" as const,
        hits: [],
        reason: undefined,
      })),
      note,
    });
    let parsed: { dimensions?: unknown };
    try {
      parsed = JSON.parse(raw) as { dimensions?: unknown };
    } catch {
      return fallback("LLM 安全审核输出非合法 JSON");
    }
    if (!Array.isArray(parsed.dimensions)) return fallback("LLM 安全审核输出缺 dimensions");
    const dims: SafetyDim[] = [];
    for (const key of SAFETY_KEYS) {
      const found = (parsed.dimensions as { key?: string }[]).find((d) => d?.key === key);
      if (!found) {
        dims.push({ key, score: 0, severity: "low", hits: [], reason: undefined });
        continue;
      }
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

  private emptyQuality(): ReviewQuality {
    return {
      overall: 0,
      dimensions: QUALITY_KEYS.map((key) => ({ key, score: 0, reason: "内容不足,无法评分" })),
      note: "正文过短或为空,跳过质量评分",
    };
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
}
