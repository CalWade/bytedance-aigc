"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_FEED_WEIGHTS, type FeedWeights } from "@bytedance-aigc/shared";

const KEY = "phase24:feed-weights";

const META: Record<keyof FeedWeights, { label: string; en: string; hint: string }> = {
  alpha: { label: "质量", en: "Quality", hint: "α · 四维质量分占比" },
  beta: { label: "热度", en: "Hotness", hint: "β · 实时阅读热度占比" },
  gamma: { label: "新鲜度", en: "Recency", hint: "γ · 时间衰减占比" },
};

function readInitialWeights(): FeedWeights {
  if (typeof window === "undefined") return DEFAULT_FEED_WEIGHTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FeedWeights;
  } catch {
    /* noop */
  }
  return DEFAULT_FEED_WEIGHTS;
}

export function WeightDrawer() {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState<FeedWeights>(readInitialWeights);
  const router = useRouter();

  function commit(next: FeedWeights) {
    localStorage.setItem(KEY, JSON.stringify(next));
    setW(next);
    const sp = new URLSearchParams();
    sp.set("alpha", String(next.alpha));
    sp.set("beta", String(next.beta));
    sp.set("gamma", String(next.gamma));
    router.replace(`?${sp.toString()}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-sm"
        aria-label="排序权重"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="4" y1="6" x2="14" y2="6" />
          <line x1="18" y1="6" x2="20" y2="6" />
          <circle cx="16" cy="6" r="2" />
          <line x1="4" y1="12" x2="8" y2="12" />
          <line x1="12" y1="12" x2="20" y2="12" />
          <circle cx="10" cy="12" r="2" />
          <line x1="4" y1="18" x2="16" y2="18" />
          <line x1="20" y1="18" x2="20" y2="18" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        <span>排序权重</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-50"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="absolute right-0 top-0 bottom-0 w-[360px] bg-[var(--surface)] shadow-[var(--shadow-pop)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="排序权重"
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-medium">排序权重</h3>
                <p className="text-[12px] text-[var(--text-3)] mt-0.5">
                  score = α·quality + β·hotness + γ·recency
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
              {(Object.keys(META) as Array<keyof FeedWeights>).map((k) => (
                <div key={k}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-medium text-[var(--text)]">
                        {META[k].label}
                      </span>
                      <span className="text-[11px] text-[var(--text-3)]">{META[k].en}</span>
                    </div>
                    <span className="text-[14px] font-medium text-[var(--brand)] tabular-nums">
                      {w[k].toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={w[k]}
                    onChange={(e) => setW({ ...w, [k]: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">{META[k].hint}</p>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-[var(--border)] flex items-center gap-2">
              <button type="button" onClick={() => commit(w)} className="btn btn-primary flex-1">
                付印
              </button>
              <button type="button" onClick={() => commit(DEFAULT_FEED_WEIGHTS)} className="btn">
                恢复默认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
