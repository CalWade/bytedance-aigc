"use client";

import Link from "next/link";
import { useState } from "react";
import { REPORT_CATEGORY_LABELS, type ReportDto } from "@bytedance-aigc/shared";

import { ResolveDialog } from "./ResolveDialog";

interface ReportRowProps {
  report: ReportDto;
  onResolved: () => void;
}

const RESOLUTION_LABELS: Record<NonNullable<ReportDto["resolution"]>, string> = {
  OFFLINE: "已下线",
  WARN: "已警告",
  DISMISS: "已驳回",
};

const LLM_LABELS: Record<NonNullable<ReportDto["llmRecommendation"]>, string> = {
  ALLOW: "放行",
  WARN: "警告",
  BLOCK: "下线",
};

function truncate(s: string | null, n: number): string {
  if (!s) return "(无补充说明)";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function ReportRow({ report, onResolved }: ReportRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <Link
            href={`/post/${report.postId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-medium underline truncate"
          >
            {report.postTitle}
          </Link>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
            <span>举报人: {report.reporterHandle}</span>
            <span>· 分类: {REPORT_CATEGORY_LABELS[report.category]}</span>
            <span>· {new Date(report.createdAt).toLocaleString()}</span>
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            理由: {truncate(report.reason, 80)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs shrink-0"
        >
          {expanded ? "收起" : "详情"}
        </button>
      </div>

      {expanded && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm flex flex-col gap-2">
          <div>
            <span className="font-medium">LLM 推荐: </span>
            {report.llmRecommendation ? (
              LLM_LABELS[report.llmRecommendation]
            ) : (
              <span className="text-zinc-500">复审中</span>
            )}
          </div>
          <div>
            <span className="font-medium">LLM 理由: </span>
            {report.llmReason ?? <span className="text-zinc-500">复审中</span>}
          </div>
          <div>
            <span className="font-medium">举报理由全文: </span>
            {report.reason ?? <span className="text-zinc-500">(无)</span>}
          </div>
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        {report.status === "RESOLVED" && report.resolution && (
          <div className="text-xs text-zinc-500 flex gap-2">
            <span className="rounded bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5">
              {RESOLUTION_LABELS[report.resolution]}
            </span>
            {report.resolvedAt && <span>· {new Date(report.resolvedAt).toLocaleString()}</span>}
          </div>
        )}
        {report.status === "PENDING" && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm"
          >
            处置…
          </button>
        )}
      </div>

      <ResolveDialog
        reportId={report.id}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onResolved={onResolved}
      />
    </div>
  );
}
