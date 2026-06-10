"use client";

import Link from "next/link";
import { useState } from "react";
import {
  REPORT_CATEGORY_LABELS,
  type ReportDto,
  type ReportResolution,
  type ReportStatus,
} from "@bytedance-aigc/shared";
import { apiFetch } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MeReportsListProps {
  initialItems: ReportDto[];
  initialCursor: string | null;
}

interface PageResponse {
  items: ReportDto[];
  nextCursor: string | null;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  PENDING: "待处理",
  RESOLVED: "已处置",
};

const RESOLUTION_LABEL: Record<ReportResolution, string> = {
  OFFLINE: "已下架",
  WARN: "警告",
  DISMISS: "驳回",
};

const LLM_LABEL: Record<"ALLOW" | "WARN" | "BLOCK", string> = {
  ALLOW: "建议放行",
  WARN: "建议警告",
  BLOCK: "建议下架",
};

function truncate(text: string | null, max = 60): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function statusVariant(status: ReportStatus): "secondary" | "default" {
  return status === "PENDING" ? "secondary" : "default";
}

function resolutionVariant(resolution: ReportResolution): "destructive" | "secondary" | "outline" {
  switch (resolution) {
    case "OFFLINE":
      return "destructive";
    case "WARN":
      return "secondary";
    case "DISMISS":
      return "outline";
  }
}

function llmClass(rec: "ALLOW" | "WARN" | "BLOCK" | null): string {
  if (rec === null) return "bg-muted text-muted-foreground";
  switch (rec) {
    case "ALLOW":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "WARN":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "BLOCK":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
  }
}

export function MeReportsList({ initialItems, initialCursor }: MeReportsListProps) {
  const [items, setItems] = useState<ReportDto[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/me/reports?limit=20&cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        const msg =
          body.code === "CURSOR_INVALID"
            ? "游标失效，请刷新页面"
            : typeof body.message === "string"
              ? body.message
              : `加载失败 ${res.status}`;
        setError(msg);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as PageResponse;
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有人举报你的稿件</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((r) => {
          const offline = r.resolution === "OFFLINE";
          const titleNode = offline ? (
            <span className="text-base font-medium line-through text-muted-foreground truncate">
              {r.postTitle}
            </span>
          ) : (
            <Link href={`/post/${r.postId}`} className="text-base font-medium underline truncate">
              {r.postTitle}
            </Link>
          );
          return (
            <Card key={r.id} className="p-4 gap-2 shadow-sm">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">{titleNode}</div>
                <Badge variant={statusVariant(r.status)}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{REPORT_CATEGORY_LABELS[r.category]}</Badge>
                {r.resolution ? (
                  <Badge variant={resolutionVariant(r.resolution)}>
                    {RESOLUTION_LABEL[r.resolution]}
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                    llmClass(r.llmRecommendation),
                  )}
                >
                  {r.llmRecommendation === null ? "复审中" : LLM_LABEL[r.llmRecommendation]}
                </span>
                <span className="text-muted-foreground ml-auto">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.reason ? (
                <p className="text-sm text-muted-foreground">{truncate(r.reason)}</p>
              ) : null}
            </Card>
          );
        })}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {cursor ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadMore()}
          disabled={loading}
          className="self-center mt-2"
        >
          {loading ? "加载中…" : "加载更多"}
        </Button>
      ) : null}
    </div>
  );
}
