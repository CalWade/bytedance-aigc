import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Green20220302 from "@alicloud/green20220302";
import * as OpenApi from "@alicloud/openapi-client";
import * as Util from "@alicloud/tea-util";

import { getGuardConfig } from "../config/guard.config";
import type { SensitiveCategory } from "@bytedance-aigc/shared";

// ── 响应类型 ──────────────────────────────────

export type GuardSuggestion = "block" | "mask" | "watch" | "pass";
export type GuardLevel = "high" | "medium" | "low" | "none";

export interface GuardDetail {
  type: string; // contentModeration | promptAttack | sensitiveData | modelHallucination
  level: GuardLevel;
  suggestion: GuardSuggestion;
  labels: string[];
  confidence: number;
}

export interface GuardResult {
  suggestion: GuardSuggestion;
  details: GuardDetail[];
}

// ── Service 参数 ──────────────────────────────

export type GuardService =
  | "query_security_check_pro" // 审核用户输入
  | "response_security_check_pro"; // 审核已发布内容（AI 输出视角）

// ── 分类映射 ──────────────────────────────────

const LABEL_MAP: Record<string, SensitiveCategory> = {
  // 色情 → pornography
  pornographic_adult: "pornography",
  sexual_terms: "pornography",
  sexual_suggestive: "pornography",
  sexual_prompts: "pornography",

  // 赌博 → gambling
  contraband_gambling: "gambling",

  // 涉毒 → drugs
  contraband_drug: "drugs",

  // 违禁行为/工具 → fraud
  contraband_act: "fraud",
  contraband_entity: "fraud",

  // 广告引流 → illicit_ads
  pt_to_sites: "illicit_ads",
  pt_by_recruitment: "illicit_ads",
  pt_to_contact: "illicit_ads",

  // 辱骂/歧视/暴恐/涉政/宗教/低俗 → abuse
  inappropriate_profanity: "abuse",
  inappropriate_discrimination: "abuse",
  inappropriate_ethics: "abuse",
  inappropriate_oral: "abuse",
  inappropriate_superstition: "abuse",
  inappropriate_nonsense: "abuse",
  violent_extremists: "abuse",
  violent_incidents: "abuse",
  violent_weapons: "abuse",
  violent_prompts: "abuse",
  political_figure: "abuse",
  political_entity: "abuse",
  political_n: "abuse",
  political_p: "abuse",
  political_prompts: "abuse",
  political_a: "abuse",
  religion_b: "abuse",
  religion_t: "abuse",
  religion_c: "abuse",
  religion_i: "abuse",
  religion_h: "abuse",
};

/** 阿里云 Label → 项目 SensitiveCategory 映射 */
export function mapGuardLabelsToSensitive(labels: string[]): SensitiveCategory[] {
  const seen = new Set<SensitiveCategory>();
  for (const label of labels) {
    const cat = LABEL_MAP[label];
    if (cat && !seen.has(cat)) seen.add(cat);
  }
  return [...seen];
}

/** 阿里云 Level → 项目 severity */
export function mapGuardLevelToSeverity(level: GuardLevel): "low" | "medium" | "high" {
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  return "low";
}

// ── 客户端 ────────────────────────────────────

@Injectable()
export class GuardClient {
  private readonly logger = new Logger(GuardClient.name);
  private client: Green20220302.default | null = null;
  private readonly mockMode: boolean;

  constructor(private readonly configService: ConfigService) {
    const cfg = getGuardConfig(configService);
    this.mockMode = !cfg.accessKeyId || !cfg.accessKeySecret;
    if (this.mockMode) {
      this.logger.warn(
        "ALIBABA_CLOUD_ACCESS_KEY 未配置，GuardClient 运行在 mock 模式，审核结果全部 pass",
      );
    } else {
      const openConfig = new OpenApi.Config({
        accessKeyId: cfg.accessKeyId,
        accessKeySecret: cfg.accessKeySecret,
        endpoint: cfg.endpoint,
      });
      this.client = new Green20220302.default(openConfig);
    }
  }

  /**
   * 审核文本内容。
   *
   * @param content 待审核文本
   * @param service query_security_check_pro（用户输入）/ response_security_check_pro（已发布内容）
   * @param opts 流式审核参数（sessionId/done 供段落级流式审核用）
   */
  async moderate(
    content: string,
    service: GuardService = "query_security_check_pro",
    opts?: { chatId?: string; sessionId?: string; done?: boolean; imageUrl?: string },
  ): Promise<GuardResult> {
    if (this.mockMode) {
      return { suggestion: "pass", details: [] };
    }

    const params: Record<string, unknown> = {};
    if (content) params.content = content;
    if (opts?.imageUrl) params.imageUrl = opts.imageUrl;
    if (opts?.chatId) params.chatId = opts.chatId;
    if (opts?.sessionId) params.sessionId = opts.sessionId;
    if (opts?.done !== undefined) params.done = opts.done;

    const request = new Green20220302.MultiModalGuardRequest({
      service,
      serviceParameters: JSON.stringify(params),
    });

    const runtime = new Util.RuntimeOptions({
      connectTimeout: 3000,
      readTimeout: 10000,
    });

    const response = await this.client!.multiModalGuardWithOptions(request, runtime);

    if (response.body?.code !== 200) {
      throw new Error(`Guard API error: ${response.body?.message ?? "unknown"}`);
    }

    return this.parseGuardResponse(response.body.data);
  }

  private parseGuardResponse(data: unknown): GuardResult {
    if (!data) {
      return { suggestion: "pass", details: [] };
    }

    const d = data as Record<string, unknown>;
    const suggestion: GuardSuggestion =
      (["block", "mask", "watch", "pass"] as const).find((s) => s === d.suggestion) ?? "pass";

    const details: GuardDetail[] = ((d.detail ?? []) as Record<string, unknown>[]).map((item) => ({
      type: (item.type as string) ?? "contentModeration",
      level: (["high", "medium", "low", "none"] as const).find((l) => l === item.level) ?? "none",
      suggestion:
        (["block", "mask", "watch", "pass"] as const).find((s) => s === item.suggestion) ?? "pass",
      labels: ((item.result ?? []) as Record<string, unknown>[])
        .map((r) => r.label as string)
        .filter(Boolean),
      confidence: Math.max(
        ...((item.result ?? []) as Record<string, unknown>[]).map(
          (r) => (r.confidence as number) ?? 0,
        ),
        0,
      ),
    }));

    return { suggestion, details };
  }
}
