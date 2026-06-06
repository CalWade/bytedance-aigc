"use client";

import type { PromptReviewResponse } from "@bytedance-aigc/shared";

interface Props {
  result: PromptReviewResponse;
  onDismiss: () => void;
  onChangeAngle: () => void;
}

export function PromptReviewBanner({ result, onDismiss, onChangeAngle }: Props) {
  const tone =
    result.recommendation === "BLOCK"
      ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
      : "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";

  return (
    <div
      role="alert"
      className={`mt-2 rounded border-l-4 px-3 py-2 text-sm flex items-start gap-3 ${tone}`}
    >
      <div className="flex-1">
        <div className="font-medium">
          {result.recommendation === "BLOCK" ? "选题风险较高" : "选题需注意"}
        </div>
        <div className="mt-0.5">{result.message}</div>
        {result.hitCategories.length > 0 && (
          <div className="mt-0.5 text-xs opacity-75">
            涉及类目:{result.hitCategories.join("、")}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="text-xs rounded border border-current px-2 py-0.5 hover:bg-white/30"
          onClick={onChangeAngle}
        >
          换角度
        </button>
        <button
          type="button"
          className="text-xs rounded px-2 py-0.5 hover:bg-white/30"
          onClick={onDismiss}
        >
          有把握继续
        </button>
      </div>
    </div>
  );
}
