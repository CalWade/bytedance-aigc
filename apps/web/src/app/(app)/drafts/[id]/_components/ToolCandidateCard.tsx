"use client";

import { useState } from "react";
import type { Candidate } from "@bytedance-aigc/shared";

interface ToolCandidateCardProps {
  candidates: Candidate[];
  onAdopt: (text: string) => void;
  onClose: () => void;
}

/**
 * 候选卡:三态决策(采用 / 修改 / 关闭)。
 * - text 候选:直接显示文本,采用替换 selection
 * - image 候选:显示 alt + reason,采用插入 `![alt](reason 占位)`
 *   后续 Phase 真接图库或 AI 生图,这里只保证语义正确。
 */
export function ToolCandidateCard({ candidates, onAdopt, onClose }: ToolCandidateCardProps) {
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null);

  const adoptValue = (c: Candidate, edited: string | null): string => {
    if (c.kind === "text") return edited ?? c.text;
    if (edited !== null) return edited;
    return `![${c.alt}](${c.reason})`;
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg p-3 flex flex-col gap-3 max-w-md">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI 候选</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          关闭
        </button>
      </header>
      <ul className="flex flex-col gap-2">
        {candidates.map((c, i) => {
          const isEditing = editing?.index === i;
          const display = c.kind === "text" ? c.text : `${c.alt} — ${c.reason}`;
          return (
            <li
              key={i}
              className="rounded border border-zinc-200 dark:border-zinc-800 p-2 flex flex-col gap-1.5"
            >
              {isEditing ? (
                <textarea
                  value={editing!.draft}
                  onChange={(e) => setEditing({ index: i, draft: e.target.value })}
                  rows={4}
                  className="text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-2"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{display}</p>
              )}
              <div className="flex justify-end gap-2">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-xs text-zinc-500"
                    >
                      取消编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAdopt(adoptValue(c, editing!.draft));
                        setEditing(null);
                        onClose();
                      }}
                      className="text-xs rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-1"
                    >
                      采用修改
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          index: i,
                          draft: c.kind === "text" ? c.text : c.alt,
                        })
                      }
                      className="text-xs rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
                    >
                      修改
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAdopt(adoptValue(c, null));
                        onClose();
                      }}
                      className="text-xs rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-1"
                    >
                      采用
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
