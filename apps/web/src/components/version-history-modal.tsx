"use client";

import { useCallback, useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";

import { apiFetch } from "@/lib/auth";
import { VersionDiff } from "@/components/version-diff";

interface VersionDto {
  id: string;
  kind: "AUTO" | "NAMED" | "PUBLISHED" | "OFFLINE_CONFLICT";
  note: string | null;
  wordCount: number;
  createdAt: string;
}

interface VersionDetailDto extends VersionDto {
  snapshot: JSONContent;
}

interface VersionHistoryModalProps {
  draftId: string;
  /** 编辑器当前内容,用作右栏 newDoc 比对基准 */
  currentBody: JSONContent;
  open: boolean;
  onClose: () => void;
  /** 恢复成功后回调:把新 body 推回 editor + 刷新草稿状态 */
  onRestored: (newBody: JSONContent) => void;
}

const KIND_CHIP: Record<VersionDto["kind"], { label: string; cls: string }> = {
  AUTO: {
    label: "自动",
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  NAMED: {
    label: "命名",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  PUBLISHED: {
    label: "已发布",
    cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  OFFLINE_CONFLICT: {
    label: "冲突备份",
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  },
};

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function VersionHistoryModal({
  draftId,
  currentBody,
  open,
  onClose,
  onRestored,
}: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VersionDetailDto | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/drafts/${draftId}/versions`);
      if (!res.ok) {
        setError(`加载失败 (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { items: VersionDto[] };
      setVersions(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    if (!open) return;
    // 模态打开时重置选中 + 拉列表 — 同步外部 open 信号到内部 state,
    // 是有意的 effect-driven reset(open: false→true 必须清旧 selected,否则切草稿后还显示上次选项)。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null);
    void fetchList();
  }, [open, fetchList]);

  const handleSelect = useCallback(
    async (v: VersionDto) => {
      setError(null);
      try {
        const res = await apiFetch(`/drafts/${draftId}/versions/${v.id}`);
        if (!res.ok) {
          setError(`加载详情失败 (HTTP ${res.status})`);
          return;
        }
        setSelected((await res.json()) as VersionDetailDto);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      }
    },
    [draftId],
  );

  const handleRestore = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm("确定恢复到此版本?当前未保存的改动会被覆盖。")) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await apiFetch(`/drafts/${draftId}/versions/${selected.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(`恢复失败 (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { id: string; body: JSONContent };
      onRestored(data.body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setRestoring(false);
    }
  }, [draftId, selected, onRestored, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white dark:bg-zinc-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <h2 className="text-base font-semibold">版本历史</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto">
            {loading && <p className="p-4 text-sm text-zinc-500">加载中…</p>}
            {!loading && versions.length === 0 && (
              <p className="p-4 text-sm text-zinc-500">暂无版本记录</p>
            )}
            <ul>
              {versions.map((v) => {
                const chip = KIND_CHIP[v.kind];
                const active = selected?.id === v.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(v)}
                      className={`w-full text-left px-3 py-2 border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                        active ? "bg-zinc-100 dark:bg-zinc-900" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded ${chip.cls}`}>{chip.label}</span>
                        <span className="text-zinc-500">{formatTime(v.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{v.wordCount} 字</div>
                      {v.note && (
                        <div className="mt-1 text-xs text-zinc-700 dark:text-zinc-300 truncate">
                          {v.note}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="flex flex-1 flex-col overflow-hidden">
            {error && (
              <div className="border-b border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900 px-4 py-2 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            {!selected && (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                请在左侧选一个版本以查看 diff
              </div>
            )}
            {selected && (
              <>
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2">
                  <div className="text-xs text-zinc-500">
                    {KIND_CHIP[selected.kind].label} · {formatTime(selected.createdAt)} ·{" "}
                    {selected.wordCount} 字
                    {selected.note && (
                      <span className="ml-2 text-zinc-700 dark:text-zinc-300">{selected.note}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={restoring}
                    onClick={() => void handleRestore()}
                    className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                  >
                    {restoring ? "恢复中…" : "恢复为草稿"}
                  </button>
                </div>
                <div className="flex-1 overflow-hidden p-3">
                  <VersionDiff oldDoc={selected.snapshot} newDoc={currentBody} />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
