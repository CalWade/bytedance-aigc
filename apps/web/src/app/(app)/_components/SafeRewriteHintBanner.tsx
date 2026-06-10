"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

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
      // mount 时一次性读 localStorage 把 hint 同步到 state,只跑一次,无 cascading 风险
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div
      role="alert"
      className="mb-4 px-4 py-3 rounded-md border border-amber-300 bg-amber-50 flex items-center justify-between gap-4 flex-wrap"
    >
      <div className="flex items-start gap-2 text-[13px] text-amber-900 leading-relaxed">
        <svg
          className="w-4 h-4 mt-0.5 shrink-0 text-amber-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          发布前审核检测到「
          <span className="font-medium">{hint.category}</span>
          」类风险,可在草稿内段落使用「合规替代」工具改写。
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button asChild size="sm" onClick={dismiss}>
          <Link href={`/drafts/${hint.draftId}`}>回到草稿</Link>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
          关闭
        </Button>
      </div>
    </div>
  );
}
