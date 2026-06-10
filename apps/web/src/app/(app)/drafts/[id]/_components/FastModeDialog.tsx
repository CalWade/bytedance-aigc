"use client";

import { useState } from "react";
import type { OutlineItem } from "@bytedance-aigc/shared";

import { apiFetch } from "@/lib/auth";
import { usePromptReview } from "@/hooks/use-prompt-review";

import { PromptReviewBanner } from "./PromptReviewBanner";

interface FastModeDialogProps {
  draftId: string;
  open: boolean;
  onClose: () => void;
  onAccept: (sections: OutlineItem[]) => void;
}

export function FastModeDialog({ draftId, open, onClose, onAccept }: FastModeDialogProps) {
  const [topic, setTopic] = useState("");
  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptReview = usePromptReview();
  const composedText = (): string => `${topic.trim()}\n${hint.trim()}`.trim();

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (!topic.trim()) {
      setError("请填写选题");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/drafts/${draftId}/outline`, {
        method: "POST",
        body: JSON.stringify({ topic: topic.trim(), hint: hint.trim() || undefined }),
      });
      if (!res.ok) {
        setError(`生成失败 (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as { sections: OutlineItem[] };
      onAccept(body.sections);
      setTopic("");
      setHint("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-lg bg-white dark:bg-zinc-950 shadow-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">FAST 模式生成大纲</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span>选题</span>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={() => promptReview.trigger(composedText())}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:border-zinc-500"
            placeholder="例:5G-A 商用启动"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>额外提示(可选)</span>
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onBlur={() => promptReview.trigger(composedText())}
            rows={3}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:border-zinc-500"
            placeholder="例:请聚焦运营商成本下降的具体数据"
          />
        </label>
        {promptReview.result && (
          <PromptReviewBanner
            result={promptReview.result}
            onDismiss={promptReview.dismiss}
            onChangeAngle={() => {
              setTopic("");
              setHint("");
              promptReview.dismiss();
            }}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {submitting ? "生成中…" : "生成大纲"}
          </button>
        </div>
      </div>
    </div>
  );
}
