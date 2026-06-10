"use client";

import { useEffect } from "react";
import type { SafeRewriteRequest } from "@bytedance-aigc/shared";
import { useSafeRewrite } from "@/hooks/use-safe-rewrite";

interface Props {
  open: boolean;
  request: SafeRewriteRequest;
  onAdopt: (text: string) => void;
  onClose: () => void;
}

/**
 * Phase 2.13 一键合规替代:侧边对比卡 + 2 候选 SSE 流式。
 * 父组件控制 open;打开瞬间触发 start,关闭瞬间 abort。
 */
export function SafeRewriteCard({ open, request, onAdopt, onClose }: Props) {
  const { candidates, status, error, start, abort } = useSafeRewrite();

  useEffect(() => {
    if (!open) return;
    void start(request);
    return () => abort();
    // request 在父组件内随 medium 命中固定;依赖刻意省略让 effect 只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 shadow-lg p-3 mt-2 max-w-md">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">合规替代候选</h3>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500">
          关闭
        </button>
      </header>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {[0, 1].map((idx) => (
          <li
            key={idx}
            className="rounded border border-zinc-200 dark:border-zinc-800 p-2 flex flex-col gap-1.5 bg-white dark:bg-zinc-950"
          >
            <p className="text-sm whitespace-pre-wrap min-h-[2.5em]">
              {candidates[idx] || (status[idx] === "streaming" ? "生成中…" : "—")}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={status[idx] !== "done" || !candidates[idx]}
                onClick={() => {
                  onAdopt(candidates[idx]);
                  onClose();
                }}
                className="text-xs rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-1 disabled:opacity-50"
              >
                采用
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
