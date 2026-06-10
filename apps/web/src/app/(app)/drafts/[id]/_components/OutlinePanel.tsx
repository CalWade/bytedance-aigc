"use client";

import { useState } from "react";
import type { OutlineItem } from "@bytedance-aigc/shared";

interface OutlinePanelProps {
  initial: OutlineItem[];
  onConfirm: (sections: OutlineItem[]) => void;
  onCancel: () => void;
}

/**
 * 大纲编辑面板:增删 + 上下移 + 改 heading/summary。
 * 不引入拖拽库(D8 同样原则);上下移按钮代替。
 */
export function OutlinePanel({ initial, onConfirm, onCancel }: OutlinePanelProps) {
  const [items, setItems] = useState<OutlineItem[]>(initial);

  const update = (i: number, patch: Partial<OutlineItem>): void => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const remove = (i: number): void => {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };
  const add = (): void => {
    setItems((prev) => [...prev, { heading: "", summary: "" }]);
  };
  const move = (i: number, delta: -1 | 1): void => {
    setItems((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const valid =
    items.length >= 1 &&
    items.every((it) => it.heading.trim().length > 0 && it.summary.trim().length > 0);

  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 dark:border-zinc-800 p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">大纲(可编辑)</h3>
        <button
          type="button"
          onClick={add}
          className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
        >
          + 添加一节
        </button>
      </header>
      <ol className="flex flex-col gap-3">
        {items.map((it, i) => (
          <li
            key={i}
            className="flex flex-col gap-1 rounded border border-zinc-200 dark:border-zinc-800 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-6">#{i + 1}</span>
              <input
                type="text"
                value={it.heading}
                onChange={(e) => update(i, { heading: e.target.value })}
                placeholder="小节标题"
                className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-zinc-300 text-sm font-medium"
              />
              <button
                type="button"
                onClick={() => move(i, -1)}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                aria-label="上移"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                aria-label="下移"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-red-600 hover:underline"
                aria-label="删除"
              >
                删除
              </button>
            </div>
            <textarea
              value={it.summary}
              onChange={(e) => update(i, { summary: e.target.value })}
              placeholder="一句话概要"
              rows={2}
              className="bg-transparent outline-none border-b border-transparent focus:border-zinc-300 text-sm"
            />
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onConfirm(items)}
          disabled={!valid}
          className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          开始生成正文
        </button>
      </div>
    </section>
  );
}
