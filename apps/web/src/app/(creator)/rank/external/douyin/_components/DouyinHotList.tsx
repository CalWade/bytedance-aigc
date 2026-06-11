"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@bytedance-aigc/ui/components/ui/badge";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import { Card } from "@bytedance-aigc/ui/components/ui/card";
import { apiFetch } from "@bytedance-aigc/ui/lib/auth";
import type { DouyinTrendingResult } from "@bytedance-aigc/ui/components/feed/external-trending-types";

const LABEL_VARIANT: Record<string, "destructive" | "outline" | "secondary"> = {
  爆: "destructive",
  热: "outline",
  新: "secondary",
  荐: "secondary",
};

export function DouyinHotList({ data }: { data: DouyinTrendingResult }) {
  const router = useRouter();
  const [creatingTitle, setCreatingTitle] = useState<string | null>(null);

  if (data.items.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[15px] text-muted-foreground">暂无抖音热榜数据</p>
      </Card>
    );
  }

  async function startCreate(title: string) {
    if (creatingTitle) return;
    setCreatingTitle(title);
    try {
      const res = await apiFetch("/drafts", {
        method: "POST",
        body: JSON.stringify({
          title: title.slice(0, 80),
          body: { type: "doc", content: [] },
        }),
      });
      if (!res.ok) return;
      const draft = (await res.json()) as { id: string };
      const params = new URLSearchParams({ openFast: "1", topic: title, source: "douyin-hot" });
      router.push(`/drafts/${draft.id}?${params.toString()}`);
    } catch {
      // silent
    } finally {
      setCreatingTitle(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {data.items.map((item) => (
        <li key={`${item.rank}-${item.title}`}>
          <Card className="p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-muted text-foreground/70 text-[13px] font-medium flex items-center justify-center">
                {item.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-medium hover:text-brand line-clamp-2"
                  >
                    {item.title}
                  </a>
                  {item.labelText && (
                    <Badge
                      variant={LABEL_VARIANT[item.labelText] ?? "outline"}
                      className="text-[10px] shrink-0"
                    >
                      {item.labelText}
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                  <span>🔥 {item.popularityText}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[12px] text-brand hover:text-brand hover:bg-brand/10"
                    onClick={() => void startCreate(item.title)}
                    disabled={creatingTitle === item.title}
                  >
                    {creatingTitle === item.title ? "创建中…" : "以此选题创作"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
