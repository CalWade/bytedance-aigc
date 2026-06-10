"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AnalyticsResponse } from "@bytedance-aigc/shared";

import { apiFetch, clearToken, getToken } from "@/lib/auth";
import { QualityBadge } from "@/app/(app)/_components/QualityBadge";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AnalyticsResponse }
  | { kind: "error"; message: string };

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch("/me/analytics")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `加载失败 (HTTP ${res.status})` });
          return;
        }
        const json = (await res.json()) as AnalyticsResponse;
        if (cancelled) return;
        setState({ kind: "ready", data: json });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "网络错误",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">工作台</h1>
        <Link
          href="/me/works"
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          作品列表 →
        </Link>
      </div>
      {state.kind === "loading" && <p className="text-sm text-gray-500">加载中…</p>}
      {state.kind === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.kind === "ready" && <DashboardContent data={state.data} />}
    </main>
  );
}

function DashboardContent({ data }: { data: AnalyticsResponse }) {
  const { totals, topPosts } = data;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-medium text-zinc-500 mb-3">总览</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="作品总数" value={totals.totalDrafts} />
          <StatCard label="已发布" value={totals.totalPublished} />
          <StatCard label="已下线" value={totals.totalOffline} tone="warn" />
          <StatCard label="累计举报" value={totals.totalReport} tone="warn" />
          <StatCard label="累计曝光" value={totals.totalImpression} />
          <StatCard label="累计点击" value={totals.totalClick} />
          <StatCard label="累计点赞" value={totals.totalLike} />
          <StatCard label="累计收藏" value={totals.totalCollect} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-500 mb-3">质量与互动</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="平均质量分"
            value={totals.avgQualityOverall.toFixed(1)}
            suffix=" / 100"
          />
          <StatCard
            label="优质率"
            value={(totals.premiumRate * 100).toFixed(1)}
            suffix="%"
            hint=">= 80 占比"
          />
          <StatCard
            label="互动率"
            value={(totals.engagementRate * 100).toFixed(1)}
            suffix="%"
            hint="(赞+藏+转) / 点击"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-500 mb-3">单篇 Top 5(按互动量)</h2>
        {topPosts.length === 0 ? (
          <p className="text-sm text-zinc-500">还没有发布作品。</p>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">标题</th>
                  <th className="px-3 py-2 text-right font-medium">质量</th>
                  <th className="px-3 py-2 text-right font-medium">曝光</th>
                  <th className="px-3 py-2 text-right font-medium">点赞</th>
                  <th className="px-3 py-2 text-right font-medium">收藏</th>
                  <th className="px-3 py-2 text-right font-medium">转发</th>
                </tr>
              </thead>
              <tbody>
                {topPosts.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2">
                      <Link href={`/post/${p.id}`} className="hover:underline">
                        <span className="inline-flex items-center gap-2">
                          <span className="truncate">{p.title}</span>
                          <QualityBadge score={p.qualityOverall} size="sm" />
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.qualityOverall.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.impression}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.like}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.collect}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.share}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  tone?: "default" | "warn";
}) {
  const valueCls =
    tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valueCls}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-zinc-500 ml-1">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>}
    </div>
  );
}
