"use client";

import { useState } from "react";
import type { ReportResolution } from "@bytedance-aigc/shared";

import { useResolveReport } from "@/hooks/use-admin-reports";

interface ResolveDialogProps {
  reportId: string;
  open: boolean;
  onClose: () => void;
  onResolved: () => void;
}

const OPTIONS: { value: ReportResolution; label: string }[] = [
  { value: "OFFLINE", label: "下线" },
  { value: "WARN", label: "警告" },
  { value: "DISMISS", label: "驳回" },
];

export function ResolveDialog({ reportId, open, onClose, onResolved }: ResolveDialogProps) {
  const [resolution, setResolution] = useState<ReportResolution>("WARN");
  const [note, setNote] = useState("");
  const { loading, error, run } = useResolveReport();

  if (!open) return null;

  const handleClose = (): void => {
    setResolution("WARN");
    setNote("");
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    const ok = await run(reportId, { resolution, note: note.trim() || undefined });
    if (ok) {
      onResolved();
      handleClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative w-full max-w-md rounded-lg bg-white dark:bg-zinc-950 shadow-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">处置举报</h2>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">处置类型</legend>
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex items-center gap-2 rounded border px-3 py-2 cursor-pointer ${
                resolution === o.value
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="resolve-resolution"
                value={o.value}
                checked={resolution === o.value}
                onChange={() => setResolution(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          <span>处置备注(可选,最多 200 字)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            rows={3}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:border-zinc-500"
            placeholder="例:确认低俗描写,予以下线"
          />
          <span className="text-xs text-zinc-500 self-end">{note.length}/200</span>
        </label>
        {resolution === "OFFLINE" && (
          <p className="text-sm text-red-600">此操作会下线该稿件,作者将在 /me/works 看到下线提示</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {loading ? "提交中…" : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}
