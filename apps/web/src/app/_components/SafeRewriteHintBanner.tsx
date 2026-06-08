"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Hint {
  draftId: string;
  category: string;
  ts: number;
}

export function SafeRewriteHintBanner() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("safeRewriteHint");
    if (!raw) return;
    try {
      const h = JSON.parse(raw) as Hint;
      if (Date.now() - h.ts < 30 * 60 * 1000) setHint(h);
    } catch {
      /* noop */
    }
  }, []);

  if (!hint) return null;

  const dismiss = () => {
    localStorage.removeItem("safeRewriteHint");
    setHint(null);
  };

  return (
    <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2 mb-4 flex items-center justify-between text-sm">
      <span>
        发布前审核检测到「{hint.category}」类风险,可在草稿内段落使用「合规替代」工具改写。
      </span>
      <span className="flex gap-2">
        <Link
          href={`/drafts/${hint.draftId}`}
          className="rounded bg-amber-600 text-white text-xs px-2 py-1"
          onClick={dismiss}
        >
          回到草稿
        </Link>
        <button type="button" onClick={dismiss} className="text-xs text-zinc-500">
          关闭
        </button>
      </span>
    </div>
  );
}
