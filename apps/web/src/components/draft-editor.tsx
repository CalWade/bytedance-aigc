"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import type { Candidate, DraftToolType, OutlineItem } from "@bytedance-aigc/shared";

import { apiFetch, clearToken, getToken } from "@/lib/auth";
import { useAutosave, type SaveResult } from "@/lib/use-autosave";

import { SaveStatus } from "./save-status";
import { TiptapBody } from "./tiptap-body";
import { VersionHistoryModal } from "./version-history-modal";
import { FastModeDialog } from "@/app/drafts/[id]/_components/FastModeDialog";
import { OutlinePanel } from "@/app/drafts/[id]/_components/OutlinePanel";
import { SectionStream } from "@/app/drafts/[id]/_components/SectionStream";
import { AiBubbleMenu } from "@/app/drafts/[id]/_components/AiBubbleMenu";
import { ToolCandidateCard } from "@/app/drafts/[id]/_components/ToolCandidateCard";
import { PromptDrawer } from "@/app/drafts/[id]/_components/PromptDrawer";
import { PreflightDialog } from "@/app/drafts/[id]/_components/PreflightDialog";

interface DraftDetail {
  id: string;
  authorId: string;
  title: string;
  body: JSONContent;
  mode: "FAST" | "FINE";
  version: number;
  updatedAt: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; draft: DraftDetail }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

type FastStage =
  | { kind: "idle" }
  | { kind: "outline"; sections: OutlineItem[] }
  | { kind: "stream"; sections: OutlineItem[] };

interface ToolPanel {
  tool: DraftToolType;
  selectedText: string;
  candidates: Candidate[];
}

export function DraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<JSONContent>({ type: "doc", content: [] });
  const [editor, setEditor] = useState<Editor | null>(null);
  // baseVersion 由 GET /drafts/:id 设入,save 成功 / 冲突时 hook 内部更新 ref;
  // 这里 state 仅在外显场景(冲突 callback)写回让 hook 重读最新 baseline。
  const [baseVersion, setBaseVersion] = useState<number>(1);

  const [fastDialogOpen, setFastDialogOpen] = useState(false);
  const [fast, setFast] = useState<FastStage>({ kind: "idle" });
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [namingNote, setNamingNote] = useState(false);

  const [toolBusy, setToolBusy] = useState<DraftToolType | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch(`/drafts/${id}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (res.status === 403) {
          setState({ kind: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ kind: "not-found" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `加载失败 (HTTP ${res.status})` });
          return;
        }
        const draft = (await res.json()) as DraftDetail;
        if (cancelled) return;
        setTitle(draft.title);
        setBody(draft.body ?? { type: "doc", content: [] });
        setBaseVersion(draft.version);
        setState({ kind: "ready", draft });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "网络错误",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const value = useMemo(() => ({ title, body }), [title, body]);

  const save = useCallback(
    async (v: { title: string; body: JSONContent }, bv: number): Promise<SaveResult> => {
      const res = await apiFetch(`/drafts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...v, baseVersion: bv }),
      });
      if (res.status === 409) {
        // NestJS ConflictException 返回 body 等于 throw 时传入对象本身,无 statusCode 字段
        const body = (await res.json()) as {
          message?: string;
          payload?: { currentVersion: number; title: string; body: JSONContent };
        };
        if (body.message === "VERSION_CONFLICT" && body.payload) {
          return { ok: false, conflict: body.payload };
        }
        throw new Error("HTTP 409 unrecognized");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { version: number };
      return { ok: true, newVersion: data.version };
    },
    [id],
  );

  // T7 会扩到 setContent + 显示 ConflictBanner;T6 先把 baseVersion state 同步,
  // 让 hook 不卡死并保留 server 最新 baseline。
  const onConflict = useCallback(
    (server: { title: string; body: JSONContent; currentVersion: number }) => {
      setBaseVersion(server.currentVersion);
    },
    [],
  );

  const enabledValue = state.kind === "ready" ? value : null;
  const { status, lastSavedAt, setStreaming, flush } = useAutosave(enabledValue, save, {
    draftId: id,
    baseVersion,
    onConflict,
  });

  // 调 /drafts/:id/tools/invoke
  const invokeTool = useCallback(
    async (
      tool: DraftToolType,
      payload: { selectedText: string; fullText: string },
    ): Promise<void> => {
      if (!editor) return;
      setToolBusy(tool);
      setToolError(null);
      try {
        // 按工具形态选 input(plan D1 narrow)
        let input: Record<string, unknown>;
        switch (tool) {
          case "REWRITE_FLUENT":
          case "EXPAND":
          case "TRANSFORM_STYLE":
          case "REWRITE_OPENING":
          case "HEADLINE_SUB":
            input = { selectedText: payload.selectedText };
            break;
          case "HEADLINE_NEW":
          case "ADD_TOPIC":
          case "IMAGE_SUGGEST":
            input = { fullText: payload.fullText };
            break;
          case "ADD_FACTS":
            input = {
              selectedText: payload.selectedText,
              fullText: payload.fullText,
            };
            break;
          case "SAFE_REWRITE":
            // SAFE_REWRITE 不通过 BubbleMenu 工具分发,走 /reviews/safe-rewrite。
            // 这里走到属调用方误用,直接 return 不发请求。
            return;
        }
        // 当前生效 promptId(以 REWRITE_FLUENT 为例 — 不同工具各自记忆,这里取
        // 通用槽位:invoke 后端按 tool 自己 narrow,单工具调用拿同 tool 的 active id)
        const active = window.localStorage.getItem(`bytedance-aigc:active-prompt:${tool}`);
        const res = await apiFetch(`/drafts/${id}/tools/invoke`, {
          method: "POST",
          body: JSON.stringify({
            tool,
            input,
            ...(active ? { promptId: active } : {}),
          }),
        });
        if (!res.ok) {
          setToolError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { candidates: Candidate[] };
        setToolPanel({
          tool,
          selectedText: payload.selectedText,
          candidates: data.candidates ?? [],
        });
      } catch (err) {
        setToolError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setToolBusy(null);
      }
    },
    [editor, id],
  );

  const adoptCandidate = useCallback(
    (text: string): void => {
      if (!editor) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        editor
          .chain()
          .focus("end")
          .insertContent(text + "\n")
          .run();
      } else {
        editor.chain().focus().insertContentAt({ from, to }, text).run();
      }
    },
    [editor],
  );

  // WHY: 标记命名版本走显式按钮,弹简易 prompt 收 note。
  // 用 native window.prompt 而非自建对话框 — 训练营 demo 项目,UI 复杂度让位简洁。
  const markVersion = useCallback(async () => {
    setNamingNote(true);
    try {
      const note = window.prompt("给这个版本起个名字(可留空)") ?? "";
      if (note === null) return;
      await flush();
      const res = await apiFetch(`/drafts/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      if (!res.ok) {
        window.alert(`标记失败 (HTTP ${res.status})`);
      }
    } finally {
      setNamingNote(false);
    }
  }, [id, flush]);

  // restore 模态成功后:把后端回的 body 推回 TipTap + 本地 body state。
  const handleRestored = useCallback(
    (newBody: JSONContent): void => {
      setBody(newBody);
      if (editor) {
        editor.commands.setContent(newBody);
      }
    },
    [editor],
  );

  if (state.kind === "loading") {
    return <main className="p-6 text-sm text-zinc-500">加载中…</main>;
  }
  if (state.kind === "not-found") {
    return <main className="p-6 text-sm text-zinc-500">草稿不存在</main>;
  }
  if (state.kind === "forbidden") {
    return <main className="p-6 text-sm text-red-600">无权访问该草稿</main>;
  }
  if (state.kind === "error") {
    return <main className="p-6 text-sm text-red-600">{state.message}</main>;
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-6 py-6 max-w-3xl w-full mx-auto">
      <header className="flex items-center justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 text-2xl font-semibold tracking-tight bg-transparent outline-none border-b border-transparent focus:border-zinc-300 dark:focus:border-zinc-700"
          placeholder="未命名草稿"
        />
        <button
          type="button"
          onClick={() => setFastDialogOpen(true)}
          className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          FAST 生成
        </button>
        <button
          type="button"
          onClick={() => setPromptDrawerOpen(true)}
          aria-label="Prompt 库"
          title="Prompt 库"
          className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => setVersionHistoryOpen(true)}
          className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          版本历史
        </button>
        <button
          type="button"
          onClick={() => void markVersion()}
          disabled={namingNote}
          className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
        >
          标记版本
        </button>
        <button
          type="button"
          onClick={() => setPreflightOpen(true)}
          className="text-sm rounded bg-zinc-900 text-white px-2.5 py-1.5 hover:bg-zinc-700"
        >
          发布
        </button>
        <SaveStatus status={status} lastSavedAt={lastSavedAt} />
      </header>

      {fast.kind === "outline" && (
        <OutlinePanel
          initial={fast.sections}
          onCancel={() => setFast({ kind: "idle" })}
          onConfirm={(sections) => setFast({ kind: "stream", sections })}
        />
      )}

      {fast.kind === "stream" && (
        <SectionStream
          editor={editor}
          draftId={id}
          sections={fast.sections}
          setStreaming={setStreaming}
          flush={flush}
          onComplete={() => setFast({ kind: "idle" })}
          onError={() => {
            // 流末错误已在 SectionStream 内显示;父组件保持 stream 阶段以便用户看到错
          }}
        />
      )}

      <TiptapBody initial={body} onChange={setBody} onReady={setEditor} />

      <AiBubbleMenu editor={editor} onInvoke={invokeTool} />

      {toolBusy && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs rounded bg-zinc-900 text-white px-3 py-1.5">
          调用 {toolBusy}…
        </p>
      )}
      {toolError && !toolBusy && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs rounded bg-red-600 text-white px-3 py-1.5">
          工具失败:{toolError}
        </p>
      )}
      {toolPanel && (
        <div className="fixed bottom-6 right-6 z-30">
          <ToolCandidateCard
            candidates={toolPanel.candidates}
            onAdopt={adoptCandidate}
            onClose={() => setToolPanel(null)}
          />
        </div>
      )}

      <FastModeDialog
        draftId={id}
        open={fastDialogOpen}
        onClose={() => setFastDialogOpen(false)}
        onAccept={(sections) => setFast({ kind: "outline", sections })}
      />

      <PromptDrawer open={promptDrawerOpen} onClose={() => setPromptDrawerOpen(false)} />

      <PreflightDialog draftId={id} open={preflightOpen} onClose={() => setPreflightOpen(false)} />

      <VersionHistoryModal
        draftId={id}
        currentBody={body}
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        onRestored={handleRestored}
      />
    </main>
  );
}
