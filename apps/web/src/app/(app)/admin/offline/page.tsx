"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, clearToken, getToken } from "@/lib/auth";

interface ApiError {
  code?: string;
  message?: string;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; draftId: string }
  | { kind: "error"; message: string };

export default function AdminOfflinePage() {
  const router = useRouter();
  const [draftId, setDraftId] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftId.trim()) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await apiFetch(`/admin/drafts/${encodeURIComponent(draftId.trim())}/offline`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (res.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        setState({
          kind: "error",
          message: body.message ?? `下线失败 (HTTP ${res.status})`,
        });
        return;
      }
      setState({ kind: "ok", draftId: draftId.trim() });
      setReason("");
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "网络错误",
      });
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <a
        href="/admin"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← 平台管理后台
      </a>
      <h1 className="text-2xl font-bold mt-2 mb-6">直接下线作品</h1>
      <p className="text-sm text-zinc-500 mb-4">
        填入 draft ID 强制下线,不经过举报流程。仅作用于 PUBLISHED 状态作品。
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Draft ID</span>
          <input
            type="text"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder="例:pub000draft0000000000000000"
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950 font-mono"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">下线原因(可选,最多 200 字)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="留空则使用默认「平台审核下线」"
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === "submitting" || !draftId.trim()}
          className="self-start rounded bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.kind === "submitting" ? "下线中…" : "确认下线"}
        </button>
      </form>
      {state.kind === "ok" && (
        <div className="mt-4 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-sm">
          已下线 <span className="font-mono">{state.draftId}</span>
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-4 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
          {state.message}
        </div>
      )}
    </main>
  );
}
