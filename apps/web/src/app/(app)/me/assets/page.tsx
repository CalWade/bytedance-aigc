"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, clearToken, getToken } from "@/lib/auth";

interface AssetItem {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
  aiGenerated?: boolean;
  aiPrompt?: string;
  sceneTags?: string[];
  subjectTags?: string[];
  createdAt?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: AssetItem[] }
  | { kind: "error"; message: string };

export default function AssetsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [sceneFilter, setSceneFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const loadCountRef = useRef(0);

  const loadAssets = useCallback(async () => {
    const params = new URLSearchParams();
    if (sceneFilter) params.set("scene", sceneFilter);
    if (subjectFilter) params.set("subject", subjectFilter);

    const path = params.toString()
      ? `/assets/search?${params.toString()}`
      : `/assets/mine?limit=50`;

    const thisLoad = ++loadCountRef.current;
    try {
      const res = await apiFetch(path);
      if (thisLoad !== loadCountRef.current) return;
      if (res.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: `加载失败 (HTTP ${res.status})` });
        return;
      }
      const json = (await res.json()) as { items: AssetItem[] };
      if (thisLoad !== loadCountRef.current) return;
      setState({ kind: "ready", items: json.items });
    } catch (err) {
      if (thisLoad !== loadCountRef.current) return;
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "网络错误",
      });
    }
  }, [sceneFilter, subjectFilter, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadAssets();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAssets, router]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await apiFetch("/assets/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (res.ok) {
        setShowGenerateModal(false);
        setPrompt("");
        await loadAssets();
      } else {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        window.alert(body.message ?? `生成失败 (HTTP ${res.status})`);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "网络错误");
    } finally {
      setGenerating(false);
    }
  };

  // Extract distinct tags from loaded items for filter dropdowns
  const allSceneTags = new Set<string>();
  const allSubjectTags = new Set<string>();
  if (state.kind === "ready") {
    for (const item of state.items) {
      for (const t of item.sceneTags ?? []) allSceneTags.add(t);
      for (const t of item.subjectTags ?? []) allSubjectTags.add(t);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">素材库</h1>
        <Link
          href="/me/dashboard"
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          &larr; 工作台
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => setShowGenerateModal(true)}
          className="px-4 py-1.5 rounded text-sm bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          AI 生图
        </button>

        <select
          value={sceneFilter}
          onChange={(e) => setSceneFilter(e.target.value)}
          className="rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-sm bg-white dark:bg-zinc-950"
        >
          <option value="">全部场景</option>
          {Array.from(allSceneTags).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-sm bg-white dark:bg-zinc-950"
        >
          <option value="">全部主体</option>
          {Array.from(allSubjectTags).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {state.kind === "loading" && <p className="text-sm text-gray-500">加载中...</p>}
      {state.kind === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      {state.kind === "ready" && state.items.length === 0 && (
        <p className="text-sm text-gray-500">暂无素材。</p>
      )}
      {state.kind === "ready" && state.items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {state.items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm"
            >
              <div className="aspect-square bg-zinc-100 dark:bg-zinc-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.aiPrompt ?? item.key}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-2">
                {item.aiGenerated && (
                  <span className="inline-block text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded px-1.5 py-0.5 mb-1">
                    AI 生成
                  </span>
                )}
                <div className="flex flex-wrap gap-1">
                  {(item.sceneTags ?? []).map((t) => (
                    <span
                      key={`s-${t}`}
                      className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 rounded px-1.5 py-0.5"
                    >
                      {t}
                    </span>
                  ))}
                  {(item.subjectTags ?? []).map((t) => (
                    <span
                      key={`sub-${t}`}
                      className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 rounded px-1.5 py-0.5"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-950 rounded-xl shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-3">AI 生图</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={500}
              placeholder="描述你想生成的图片..."
              className="w-full rounded border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm bg-white dark:bg-zinc-950 resize-none h-28"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  setShowGenerateModal(false);
                  setPrompt("");
                }}
                className="px-3 py-1.5 rounded text-sm border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating || !prompt.trim()}
                className="px-3 py-1.5 rounded text-sm bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 disabled:opacity-50"
              >
                {generating ? "生成中..." : "生成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
