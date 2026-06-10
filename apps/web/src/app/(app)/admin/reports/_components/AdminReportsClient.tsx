"use client";

import { useEffect } from "react";

import { useAdminReports, type AdminReportFilter } from "@/hooks/use-admin-reports";

import { ReportRow } from "./ReportRow";

const TABS: { key: AdminReportFilter; label: string }[] = [
  { key: "PENDING", label: "待处置" },
  { key: "RESOLVED", label: "已处置" },
  { key: "ALL", label: "全部" },
];

export function AdminReportsClient() {
  const { items, cursor, status, loading, error, load } = useAdminReports();

  useEffect(() => {
    void load("PENDING", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error === "无管理员权限") {
    return <p className="text-red-600 text-sm">无管理员权限,请联系运维。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => void load(t.key, true)}
            className={`rounded px-3 py-1.5 text-sm ${
              status === t.key
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-zinc-500">暂无举报。</p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id}>
            <ReportRow report={r} onResolved={() => void load(status, true)} />
          </li>
        ))}
      </ul>
      <div className="flex justify-center">
        {cursor && (
          <button
            type="button"
            onClick={() => void load(status, false)}
            disabled={loading}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {loading ? "加载中…" : "加载更多"}
          </button>
        )}
        {!cursor && loading && <span className="text-sm text-zinc-500">加载中…</span>}
      </div>
    </div>
  );
}
