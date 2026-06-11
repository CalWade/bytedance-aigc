"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch, clearToken, getToken } from "@bytedance-aigc/ui/lib/auth";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import { Card } from "@bytedance-aigc/ui/components/ui/card";

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
  | { kind: "ready"; drafts: DraftItem[] }
  | { kind: "error"; message: string };

export default function MyDraftsPage() {
  return (
    <Suspense fallback={<div className="px-5 py-5 text-[14px] text-muted-foreground">加载中…</div>}>
      <MyDraftsPageInner />
    </Suspense>
  );
}

function MyDraftsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 来自抖音热榜「以此选题创作」:?topic=xxx&source=douyin-hot
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    const topic = searchParams.get("topic");
    const source = searchParams.get("source");
    if (!topic || autoCreatedRef.current) return;
    if (!getToken()) return;
    autoCreatedRef.current = true;
    void (async () => {
      try {
        const res = await apiFetch("/drafts", {
          method: "POST",
          body: JSON.stringify({
            title: topic.slice(0, 80),
            body: { type: "doc", content: [] },
          }),
        });
        if (res.status === 401) {
          clearToken();
          window.location.replace("/login");
          return;
        }
        if (!res.ok) {
          setCreateError(`从选题创建草稿失败 (HTTP ${res.status})`);
          return;
        }
        const draft = (await res.json()) as { id: string };
        const next = new URLSearchParams({ openFast: "1", topic });
        if (source) next.set("source", source);
        router.replace(`/drafts/${draft.id}?${next.toString()}`);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "网络错误");
      }
    })();
  }, [router, searchParams]);

  useEffect(() => {
    if (!getToken()) {
      window.location.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch("/drafts/mine")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          window.location.replace("/login");
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `加载失败 (HTTP ${res.status})` });
          return;
        }
        const allDrafts = (await res.json()) as DraftItem[];
        const drafts = allDrafts.filter((d) => d.status !== "PUBLISHED");
        if (cancelled) return;
        setState({ kind: "ready", drafts });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof TypeError && err.message.includes("fetch")
              ? "无法连接 API 服务，请确认后端已在 :4000 端口启动"
              : err instanceof Error
                ? err.message
                : "网络错误",
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
        window.location.replace("/login");
        return;
      }
      if (!res.ok) {
        setCreateError(`创建失败 (HTTP ${res.status})`);
        return;
      }
      const draft = (await res.json()) as { id: string };
      router.push(`/drafts/${draft.id}`);
    } catch (err) {
      setCreateError(
        err instanceof TypeError && err.message.includes("fetch")
          ? "无法连接 API 服务，请确认后端已在 :4000 端口启动"
          : err instanceof Error
            ? err.message
            : "网络错误",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-medium text-foreground">我的草稿</h1>
        <Button size="sm" onClick={onCreate} disabled={creating}>
          <Plus className="h-4 w-4 mr-1" aria-hidden />
          {creating ? "创建中…" : "新建草稿"}
        </Button>
      </div>

      {createError && (
        <Card className="p-4 mb-4 border-destructive/50 text-[14px] text-destructive">
          {createError}
        </Card>
      )}

      {state.kind === "loading" && (
        <p className="text-[14px] text-muted-foreground py-8 text-center">加载中…</p>
      )}

      {state.kind === "error" && (
        <Card className="p-8 text-center">
          <p className="text-[15px] text-destructive">{state.message}</p>
          <p className="text-[12px] text-muted-foreground/70 mt-1">
            请确认 API 服务已在 :4000 端口启动
          </p>
        </Card>
      )}

      {state.kind === "ready" && state.drafts.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-[15px] text-muted-foreground">还没有草稿</p>
          <p className="text-[13px] text-muted-foreground/70 mt-1">
            点击右上角「新建草稿」开始创作
          </p>
        </Card>
      )}

      {state.kind === "ready" && state.drafts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.drafts.map((d) => (
            <li key={d.id}>
              <Link href={`/drafts/${d.id}`}>
                <Card className="px-4 py-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[14px] font-medium truncate text-foreground">
                        {d.title}
                      </span>
                      <span className="text-[12px] text-muted-foreground font-mono truncate">
                        {d.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={
                          d.mode === "FAST"
                            ? "inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px] font-medium"
                            : "inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium"
                        }
                      >
                        {d.mode}
                      </span>
                      <span className="text-[12px] text-muted-foreground">v{d.version}</span>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
