"use client";
import type { ReviewSafety, ReviewQuality, SafetyKey } from "@bytedance-aigc/shared";
import { QualityBadge } from "@bytedance-aigc/ui/components/feed/QualityBadge";

const SAFETY_LABEL: Record<string, string> = {
  pornography: "涉黄",
  gambling: "涉赌",
  drugs: "涉毒",
  abuse: "辱骂/暴恐/涉政",
  fraud: "欺诈",
  illicit_ads: "黑产广告",
};

const QUALITY_LABEL: Record<string, string> = {
  content_value: "内容价值",
  expression: "表达质量",
  reader_experience: "读者体验",
  viral_potential: "传播潜力",
};

export function ScorePanel({
  safety,
  quality,
  onQualityDimensionClick,
  onSafeRewrite,
}: {
  safety: ReviewSafety;
  quality: ReviewQuality;
  onQualityDimensionClick?: (key: string) => void;
  onSafeRewrite?: (key: SafetyKey) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold mb-2">安全分:{safety.overall} / 100</h3>
        <ul className="text-xs space-y-1">
          {safety.dimensions.map((d) => (
            <li key={d.key} className="flex items-center justify-between">
              <span>
                {SAFETY_LABEL[d.key] ?? d.key} · {d.severity}
              </span>
              <span className="flex items-center gap-2">
                <span>{d.score}</span>
                {d.severity === "medium" && onSafeRewrite && (
                  <button
                    type="button"
                    onClick={() => onSafeRewrite(d.key as SafetyKey)}
                    className="text-xs rounded border border-amber-500 text-amber-700 px-1.5 py-0.5"
                  >
                    合规替代
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {safety.note && <p className="text-xs text-red-600 mt-1">{safety.note}</p>}
      </section>
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          质量分:{quality.overall} / 100
          <QualityBadge score={quality.overall} size="sm" />
        </h3>
        <ul className="text-xs space-y-1">
          {quality.dimensions.map((d) => (
            <li key={d.key} className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => onQualityDimensionClick?.(d.key)}
                className="text-left underline-offset-2 hover:underline"
              >
                {QUALITY_LABEL[d.key] ?? d.key}
              </button>
              <span>{d.score}</span>
            </li>
          ))}
        </ul>
        {quality.note && <p className="text-xs text-red-600 mt-1">{quality.note}</p>}
      </section>
    </div>
  );
}
