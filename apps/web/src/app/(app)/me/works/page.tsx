"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MeWorksItem } from "@bytedance-aigc/shared";
import { apiFetch, clearToken, getToken } from "@/lib/auth";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; works: MeWorksItem[] }
  | { kind: "error"; message: string };

const FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "PUBLISHED", label: "已发布" },
  { key: "DRAFT", label: "草稿" },
  { key: "OFFLINE", label: "已下线" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

export default function MyWorksPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [takingDownId, setTakingDownId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const handleEdit = async (id: string) => {
    setEditingId(id);
    try {
      const res = await apiFetch(`/drafts/${id}/edit`, { method: "POST" });
      if (res.status === 200) {
        router.push(`/drafts/${id}`);
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        window.alert(body.message ?? "当前状态不允许编辑");
        return;
      }
      window.alert(`切回编辑失败 (HTTP ${res.status})`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "网络错误");
    } finally {
      setEditingId(null);
    }
  };

  const handleTakedown = async (id: string) => {
    if (!window.confirm("确认下线?线上读者将看不到")) return;
    setTakingDownId(id);
    try {
      const res = await apiFetch(`/drafts/${id}/takedown`, {
        method: "POST",
        body: "{}",
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      window.alert(`下线失败 (HTTP ${res.status})`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "网络错误");
    } finally {
      setTakingDownId(null);
    }
  };

  const handleRestoreFromOffline = async (id: string) => {
    setRestoringId(id);
    try {
      const res = await apiFetch(`/drafts/${id}/restore-from-offline`, {
        method: "POST",
      });
      if (res.ok) {
        router.push(`/drafts/${id}`);
        return;
      }
      window.alert(`恢复失败 (HTTP ${res.status})`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "网络错误");
    } finally {
      setRestoringId(null);
    }
  };

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch(`/me/works?status=${filter}&limit=50`)
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
        const json = (await res.json()) as { items: MeWorksItem[] };
        if (cancelled) return;
        setState({ kind: "ready", works: json.items });
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
  }, [filter, router]);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">我的作品</h1>
        <Link
          href="/me/dashboard"
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← 工作台
        </Link>
      </div>
      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded text-sm ${
              filter === f.key ? "bg-black text-white" : "bg-gray-100 text-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {state.kind === "loading" && <p className="text-sm text-gray-500">加载中…</p>}
      {state.kind === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.kind === "ready" && state.works.length === 0 && (
        <p className="text-sm text-gray-500">还没有作品。</p>
      )}
      {state.kind === "ready" && state.works.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.works.map((w) => (
            <li
              key={w.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <h2 className="text-base font-medium truncate">{w.title}</h2>
                  <p className="text-xs text-zinc-500 font-mono truncate">{w.id}</p>
                  {w.status === "OFFLINE" && (
                    <div className="text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded px-2 py-1.5 mt-1">
                      下线原因:{w.offlineReason ?? "平台审核下线"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      w.status === "PUBLISHED"
                        ? "inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium"
                        : w.status === "OFFLINE"
                          ? "inline-flex items-center rounded-full bg-red-600 text-white px-2 py-0.5 text-xs font-medium"
                          : "inline-flex items-center rounded-full bg-zinc-100 text-zinc-700 px-2 py-0.5 text-xs font-medium"
                    }
                  >
                    {w.status === "OFFLINE" ? "已下线" : w.status}
                  </span>
                  <span className="text-xs text-zinc-500">Q {w.qualityOverall.toFixed(0)}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {w.status === "PUBLISHED" && w.diagnosis && (
                  <div className="w-full rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3 flex items-center justify-between gap-4 mb-1">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        {w.diagnosis.title}
                      </span>
                      <span className="text-xs text-blue-600 dark:text-blue-300">
                        {w.diagnosis.description}
                      </span>
                    </div>
                    <Link
                      href={`/drafts/${w.id}?tool=${w.diagnosis.toolAction}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      去优化
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  </div>
                )}
                {w.status === "PUBLISHED" && (
                  <>
                    <Link
                      href={`/post/${w.id}`}
                      className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      查看线上
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleEdit(w.id)}
                      disabled={editingId === w.id}
                      className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
                    >
                      继续编辑草稿
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTakedown(w.id)}
                      disabled={takingDownId === w.id}
                      className="inline-flex items-center rounded border border-red-300 dark:border-red-800 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                    >
                      {takingDownId === w.id ? "下线中…" : "下线"}
                    </button>
                  </>
                )}
                {w.status === "DRAFT" && (
                  <Link
                    href={`/drafts/${w.id}`}
                    className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    继续编辑草稿
                  </Link>
                )}
                {w.status === "REVIEWING" && <span className="text-xs text-zinc-500">审核中…</span>}
                {w.status === "OFFLINE" && (
                  <button
                    type="button"
                    onClick={() => void handleRestoreFromOffline(w.id)}
                    disabled={restoringId === w.id}
                    className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
                  >
                    {restoringId === w.id ? "恢复中…" : "重新提审"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
