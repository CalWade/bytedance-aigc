"use client";
import type { Recommendation } from "@bytedance-aigc/shared";

const COLORS: Record<Recommendation, string> = {
  ALLOW: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  WARN: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const TEXT: Record<Recommendation, string> = {
  ALLOW: "建议发布",
  WARN: "可发布,有提示",
  BLOCK: "需修改",
};

export function RecommendationBadge({ value }: { value: Recommendation }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${COLORS[value]}`}>
      {TEXT[value]}
    </span>
  );
}
