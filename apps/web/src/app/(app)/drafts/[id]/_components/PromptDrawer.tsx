"use client";

import { useEffect, useState } from "react";
import { DRAFT_TOOL_TYPES, PROMPT_DRAWER_TOOLS, type DraftToolType } from "@bytedance-aigc/shared";

import { apiFetch } from "@/lib/auth";
import { useActivePromptId } from "@/hooks/use-active-prompt-id";

import { Drawer } from "./Drawer";

interface PromptItem {
  id: string;
  owner: "PLATFORM" | "PRIVATE";
  authorId: string | null;
  tool: DraftToolType;
  name: string;
  systemPrompt: string;
  designNote: string | null;
  isStarter: boolean;
  sourcePromptId: string | null;
}

interface PromptSnapshot {
  id: string;
  systemPrompt: string;
  designNote: string | null;
  createdAt: string;
}

interface PromptDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "platform" | "mine";

export function PromptDrawer({ open, onClose }: PromptDrawerProps) {
  const [tab, setTab] = useState<Tab>("platform");
  const [tool, setTool] = useState<DraftToolType>("REWRITE_FLUENT");
  const [platform, setPlatform] = useState<PromptItem[]>([]);
  const [mine, setMine] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { promptId: activeId, setPromptId } = useActivePromptId(tool);

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      const [pRes, mRes] = await Promise.all([
        apiFetch(`/prompts?tool=${tool}`),
        apiFetch(`/prompts/private`),
      ]);
      if (pRes.ok) setPlatform((await pRes.json()) as PromptItem[]);
      if (mRes.ok) setMine((await mRes.json()) as PromptItem[]);
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    // reload 是 async,setState 在 fetch 完成后才发生(不是同步级联)。
    // exhaustive-deps:reload 闭包随 setState 变,这里只需 open/tool 变更时刷新。
    void reload();
  }, [open, tool]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const copy = async (id: string): Promise<void> => {
    const res = await apiFetch(`/prompts/${id}/copy`, { method: "POST", body: "{}" });
    if (res.ok) await reload();
  };
  const remove = async (id: string): Promise<void> => {
    const res = await apiFetch(`/prompts/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeId === id) setPromptId(null);
      await reload();
    }
  };
  const updateField = async (
    id: string,
    patch: { systemPrompt?: string; designNote?: string },
  ): Promise<void> => {
    const res = await apiFetch(`/prompts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (res.ok) await reload();
  };

  const minePerTool = mine.filter((p) => p.tool === tool);
  const platformDefault = platform.find((p) => p.tool === tool && p.isStarter) ?? null;

  return (
    <Drawer open={open} onClose={onClose} title="Prompt 库">
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span>工具:</span>
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as DraftToolType)}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
          >
            {PROMPT_DRAWER_TOOLS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 text-sm border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setTab("platform")}
            className={`px-3 py-1.5 ${tab === "platform" ? "border-b-2 border-zinc-900 dark:border-zinc-100" : "text-zinc-500"}`}
          >
            平台
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`px-3 py-1.5 ${tab === "mine" ? "border-b-2 border-zinc-900 dark:border-zinc-100" : "text-zinc-500"}`}
          >
            我的
          </button>
        </div>

        {loading && <p className="text-xs text-zinc-500">加载中…</p>}

        {tab === "platform" &&
          platform.map((p) => (
            <article
              key={p.id}
              className="rounded border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-2"
            >
              <header className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{p.name}</h4>
                <button
                  type="button"
                  onClick={() => void copy(p.id)}
                  className="text-xs rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
                >
                  复制到我的
                </button>
              </header>
              <p className="text-xs text-zinc-500 whitespace-pre-wrap">{p.systemPrompt}</p>
              {p.designNote && (
                <details className="rounded bg-zinc-50 dark:bg-zinc-900/50 px-2 py-1.5">
                  <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400 select-none">
                    💡 设计注释(平台 PE 经验)
                  </summary>
                  <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {p.designNote}
                  </p>
                </details>
              )}
              <div className="flex justify-between text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    p.isStarter
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  }`}
                >
                  {p.isStarter ? "默认款" : "风格款"}
                </span>
                <button
                  type="button"
                  onClick={() => setPromptId(p.id)}
                  className={`rounded px-2 py-1 ${
                    activeId === p.id
                      ? "bg-emerald-600 text-white"
                      : "border border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {activeId === p.id ? "当前生效" : "设为当前生效"}
                </button>
              </div>
            </article>
          ))}

        {tab === "mine" &&
          minePerTool.map((p) => (
            <MyPromptItem
              key={p.id}
              prompt={p}
              isActive={activeId === p.id}
              platformDefault={platformDefault}
              onActivate={() => setPromptId(p.id)}
              onRestoreDefault={(id) => setPromptId(id)}
              onDelete={() => void remove(p.id)}
              onSave={(patch) => void updateField(p.id, patch)}
              onAfterMutation={() => void reload()}
            />
          ))}
        {tab === "mine" && minePerTool.length === 0 && !loading && (
          <p className="text-xs text-zinc-500">尚无自己的 prompt,可在「平台」tab 复制一个。</p>
        )}
      </div>
    </Drawer>
  );
}

function MyPromptItem({
  prompt,
  isActive,
  platformDefault,
  onActivate,
  onRestoreDefault,
  onDelete,
  onSave,
  onAfterMutation,
}: {
  prompt: PromptItem;
  isActive: boolean;
  platformDefault: PromptItem | null;
  onActivate: () => void;
  onRestoreDefault: (platformId: string) => void;
  onDelete: () => void;
  onSave: (patch: { systemPrompt?: string; designNote?: string }) => void;
  onAfterMutation: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(prompt.systemPrompt);
  const [designNote, setDesignNote] = useState(prompt.designNote ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<PromptSnapshot[]>([]);

  const loadHistory = async (): Promise<void> => {
    const res = await apiFetch(`/prompts/${prompt.id}/snapshots`);
    if (res.ok) setSnapshots((await res.json()) as PromptSnapshot[]);
  };

  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const onRestore = async (snapId: string): Promise<void> => {
    const res = await apiFetch(`/prompts/${prompt.id}/snapshots/${snapId}/restore`, {
      method: "POST",
      body: "{}",
    });
    if (res.ok) {
      onAfterMutation();
      await loadHistory();
    }
  };

  const fmtRel = (iso: string): string => {
    // 渲染时一次性算相对时间;Date.now 是 impure 但显示足够近似
    // eslint-disable-next-line react-hooks/purity
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.round(ms / 1000);
    const fmt = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
    if (sec < 60) return fmt.format(-sec, "second");
    const min = Math.round(sec / 60);
    if (min < 60) return fmt.format(-min, "minute");
    const hr = Math.round(min / 60);
    if (hr < 24) return fmt.format(-hr, "hour");
    return fmt.format(-Math.round(hr / 24), "day");
  };

  return (
    <article className="rounded border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{prompt.name}</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-xs rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
          >
            {editing ? "取消" : "编辑"}
          </button>
          <button type="button" onClick={onDelete} className="text-xs text-red-600 hover:underline">
            删除
          </button>
        </div>
      </header>
      {editing ? (
        <>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            className="text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-2"
          />
          <input
            type="text"
            value={designNote}
            onChange={(e) => setDesignNote(e.target.value)}
            placeholder="设计笔记"
            className="text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-2"
          />
          <button
            type="button"
            onClick={() => {
              onSave({ systemPrompt, designNote });
              setEditing(false);
            }}
            className="self-end text-xs rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-2 py-1"
          >
            保存
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-500 whitespace-pre-wrap">{prompt.systemPrompt}</p>
          {prompt.designNote && <p className="text-xs text-zinc-400">笔记:{prompt.designNote}</p>}
        </>
      )}
      <div className="flex flex-col gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => platformDefault && onRestoreDefault(platformDefault.id)}
            disabled={!platformDefault}
            title={platformDefault ? "切回平台默认款" : "该工具暂无平台默认款"}
            className="text-xs rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 disabled:opacity-40"
          >
            恢复默认
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-xs rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
          >
            {historyOpen ? "历史 ▴" : "历史 ▾"}
          </button>
          <button
            type="button"
            onClick={onActivate}
            className={`rounded px-2 py-1 text-xs ${
              isActive ? "bg-emerald-600 text-white" : "border border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {isActive ? "当前生效" : "设为当前生效"}
          </button>
        </div>
        {historyOpen && (
          <ul className="flex flex-col gap-1 text-xs">
            {snapshots.length === 0 && (
              <li className="text-zinc-500">暂无历史快照(下次保存后产生)</li>
            )}
            {snapshots.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded border border-zinc-200 dark:border-zinc-800 px-2 py-1"
              >
                <span className="flex-1 truncate text-zinc-500">
                  {fmtRel(s.createdAt)} · {s.systemPrompt.slice(0, 30)}
                  {s.systemPrompt.length > 30 ? "…" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void onRestore(s.id)}
                  className="text-emerald-600 hover:underline"
                >
                  回滚
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
