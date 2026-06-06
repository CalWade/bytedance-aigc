/**
 * Phase 2.3 — 发布前审核 / 4 维质量分 共享类型
 * 后端 ReviewService 与前端 PreflightDialog 共用同一份 schema
 */

export const SAFETY_KEYS = [
  "pornography",
  "gambling",
  "drugs",
  "politics",
  "vulgarity",
  "false_advertising",
] as const;
export type SafetyKey = (typeof SAFETY_KEYS)[number];

export const QUALITY_KEYS = [
  "content_value",
  "expression",
  "reader_experience",
  "viral_potential",
] as const;
export type QualityKey = (typeof QUALITY_KEYS)[number];

export type Severity = "low" | "medium" | "high";
export type Recommendation = "ALLOW" | "WARN" | "BLOCK";

export interface SafetyDim {
  key: SafetyKey;
  score: number;
  severity: Severity;
  hits: string[];
  reason?: string;
}

export interface ReviewSafety {
  overall: number;
  dimensions: SafetyDim[];
  note?: string;
}

export interface QualityDim {
  key: QualityKey;
  score: number;
  reason: string;
}

export interface ReviewQuality {
  overall: number;
  dimensions: QualityDim[];
  note?: string;
}

export interface ReviewModelMeta {
  latencyMsSafety: number;
  latencyMsQuality: number;
  totalMs: number;
  truncated: boolean;
}

export interface ReviewDto {
  id: string;
  stage: "PREFLIGHT" | "PROMPT_INPUT" | "SECTION_INLINE" | "POST_PUBLISH";
  safety: ReviewSafety;
  quality: ReviewQuality;
  recommendation: Recommendation;
  modelMeta?: ReviewModelMeta | null;
  createdAt: string;
}

export interface PreflightResponse {
  review: ReviewDto;
  recommendation: Recommendation;
}
