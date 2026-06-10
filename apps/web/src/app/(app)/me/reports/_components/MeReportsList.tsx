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

function statusBadgeClass(status: ReportStatus): string {
  return status === "PENDING"
    ? "inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium"
    : "inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium";
}

function resolutionBadgeClass(resolution: ReportResolution): string {
  switch (resolution) {
    case "OFFLINE":
      return "inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium";
    case "WARN":
      return "inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium";
    case "DISMISS":
      return "inline-flex items-center rounded-full bg-zinc-100 text-zinc-700 px-2 py-0.5 text-xs font-medium";
  }
}

function llmBadgeClass(rec: "ALLOW" | "WARN" | "BLOCK" | null): string {
  if (rec === null) {
    return "inline-flex items-center rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-xs font-medium";
  }
  switch (rec) {
    case "ALLOW":
      return "inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs font-medium";
    case "WARN":
      return "inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-medium";
    case "BLOCK":
      return "inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-medium";
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
    return <p className="text-sm text-gray-500">还没有人举报你的稿件</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((r) => {
          const offline = r.resolution === "OFFLINE";
          const titleNode = offline ? (
            <span className="text-base font-medium line-through text-zinc-400 truncate">
              {r.postTitle}
            </span>
          ) : (
            <Link href={`/post/${r.postId}`} className="text-base font-medium underline truncate">
              {r.postTitle}
            </Link>
          );
          return (
            <li
              key={r.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">{titleNode}</div>
                <span className={statusBadgeClass(r.status)}>{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-zinc-100 text-zinc-700 px-2 py-0.5 font-medium">
                  {REPORT_CATEGORY_LABELS[r.category]}
                </span>
                {r.resolution && (
                  <span className={resolutionBadgeClass(r.resolution)}>
                    {RESOLUTION_LABEL[r.resolution]}
                  </span>
                )}
                <span className={llmBadgeClass(r.llmRecommendation)}>
                  {r.llmRecommendation === null ? "复审中" : LLM_LABEL[r.llmRecommendation]}
                </span>
                <span className="text-zinc-500 ml-auto">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.reason && (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {truncate(r.reason)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {cursor && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          className="self-center mt-2 px-4 py-2 rounded bg-zinc-100 text-sm text-zinc-700 disabled:opacity-50"
        >
          {loading ? "加载中…" : "加载更多"}
        </button>
      )}
    </div>
  );
}
