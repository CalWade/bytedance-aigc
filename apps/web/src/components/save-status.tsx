"use client";

import { useEffect, useState } from "react";

import type { AutosaveStatus } from "@/lib/use-autosave";

interface SaveStatusProps {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  onRetry?: () => void;
}

function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function SaveStatus({ status, lastSavedAt, onRetry }: SaveStatusProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (status === "error") {
    return (
      <button type="button" onClick={onRetry} className="text-sm text-red-600 hover:underline">
        保存失败,点这里重试
      </button>
    );
  }
  if (status === "saving") return <span className="text-sm text-zinc-500">保存中…</span>;
  if (status === "dirty") return <span className="text-sm text-zinc-500">未保存的更改</span>;
  if (status === "offline") {
    return <span className="text-sm text-amber-600">未保存(离线中)</span>;
  }
  if (status === "conflict") {
    return <span className="text-sm text-amber-600">他端已修改,已为你保留冲突备份</span>;
  }
  if (status === "saved" && lastSavedAt !== null) {
    return <span className="text-sm text-zinc-500">已保存 · {relativeTime(lastSavedAt, now)}</span>;
  }
  return null;
}
