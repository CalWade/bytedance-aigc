"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch, clearToken, getToken, getUser } from "@/lib/auth";

interface DraftItem {
  id: string;
  title: string;
  mode: "FAST" | "FINE";
  status?: "DRAFT" | "PUBLISHED";
  version: number;
  updatedAt: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; drafts: DraftItem[]; handle: string | null }
  | { kind: "error"; message: string };

export default function MyDraftsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const handle = getUser()?.handle ?? null;
    let cancelled = false;
    void apiFetch("/drafts/mine")
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
        const allDrafts = (await res.json()) as DraftItem[];
        // Phase 2.4:fixtures 扩展后 /drafts/mine 会包含 PUBLISHED,本页面只展示 DRAFT 态
        const drafts = allDrafts.filter((d) => d.status !== "PUBLISHED");
        if (cancelled) return;
        setState({ kind: "ready", drafts, handle });
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

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/drafts", {
        method: "POST",
        body: JSON.stringify({
          title: "未命名草稿",
          body: { type: "doc", content: [] },
        }),
      });
      if (res.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setCreateError(`创建失败 (HTTP ${res.status})`);
        return;
      }
      const draft = (await res.json()) as { id: string };
      router.push(`/drafts/${draft.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setCreating(false);
    }
  }

  function onLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10 max-w-3xl w-full mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">我的草稿</h1>
          {state.kind === "ready" && state.handle && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              已登录：<span className="font-mono">{state.handle}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 transition-colors"
          >
            {creating ? "创建中…" : "新建草稿"}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            退出登录
          </button>
        </div>
      </header>

      {createError && <p className="text-sm text-red-600">{createError}</p>}
      {state.kind === "loading" && <p className="text-sm text-zinc-500">加载中…</p>}
      {state.kind === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.kind === "ready" && state.drafts.length === 0 && (
        <p className="text-sm text-zinc-500">还没有草稿。</p>
      )}
      {state.kind === "ready" && state.drafts.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.drafts.map((d) => (
            <li key={d.id}>
              <Link
                href={`/drafts/${d.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <h2 className="text-base font-medium truncate">{d.title}</h2>
                  <p className="text-xs text-zinc-500 font-mono truncate">{d.id}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      d.mode === "FAST"
                        ? "inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium"
                        : "inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-xs font-medium"
                    }
                  >
                    {d.mode}
                  </span>
                  <span className="text-xs text-zinc-500">v{d.version}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
