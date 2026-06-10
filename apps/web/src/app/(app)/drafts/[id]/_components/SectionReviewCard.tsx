"use client";

import { useState } from "react";

import type { SectionReviewItem } from "@/hooks/use-section-review";

import { SafeRewriteCard } from "./SafeRewriteCard";

interface Props {
  item: SectionReviewItem;
  draftId: string;
  text: string;
  onRegenerate: (heading: string) => void;
  onApplySuggestion: (heading: string, suggestion: string) => void;
  onKeep: (heading: string) => void;
}

export function SectionReviewCard({
  item,
  draftId,
  text,
  onRegenerate,
  onApplySuggestion,
  onKeep,
}: Props) {
  const [rewriteOpen, setRewriteOpen] = useState(false);

  const tone =
    item.result.severity === "high"
      ? "border-red-500 bg-red-50 dark:bg-red-950/40"
      : "border-amber-500 bg-amber-50 dark:bg-amber-950/40";

  const isMedium = item.result.severity === "medium";

  return (
    <div className={`mt-2 rounded border-l-4 px-3 py-2 text-sm ${tone}`}>
      <div className="font-medium">段落风险:{item.result.message}</div>
      {item.result.hitCategories.length > 0 && (
        <div className="text-xs opacity-75 mt-0.5">涉及:{item.result.hitCategories.join("、")}</div>
      )}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="text-xs rounded border border-current px-2 py-0.5"
          onClick={() => onRegenerate(item.heading)}
        >
          重新生成
        </button>
        <button
          type="button"
          className="text-xs rounded px-2 py-0.5"
          onClick={() => {
            if (isMedium) {
              setRewriteOpen(true);
            } else {
              onApplySuggestion(item.heading, item.result.message);
            }
          }}
        >
          {isMedium ? "合规替代" : "修改建议"}
        </button>
        <button
          type="button"
          className="text-xs rounded px-2 py-0.5 opacity-75"
          onClick={() => onKeep(item.heading)}
        >
          仍要保留
        </button>
      </div>
      <SafeRewriteCard
        open={rewriteOpen}
        request={{
          draftId,
          text,
          hitCategories: item.result.hitCategories,
          message: item.result.message,
        }}
        onAdopt={(t) => onApplySuggestion(item.heading, t)}
        onClose={() => setRewriteOpen(false)}
      />
    </div>
  );
}
