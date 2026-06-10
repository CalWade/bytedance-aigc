"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import { DRAFT_TOOL_TYPES } from "@bytedance-aigc/shared";
import type { Candidate, DraftToolType, OutlineItem } from "@bytedance-aigc/shared";

import { apiFetch, clearToken, getToken } from "@/lib/auth";
import { clearSnapshot, getSnapshot } from "@/lib/idb-draft-cache";
import { useAutosave, type SaveResult } from "@/lib/use-autosave";
import { useDraftPresence } from "@/lib/use-draft-presence";

import { ConflictBanner } from "./conflict-banner";
import { OfflineBanner } from "./offline-banner";
import { ReadonlyBanner } from "./readonly-banner";
import { RepublishBanner } from "./republish-banner";
import { SaveStatus } from "./save-status";
import { TiptapBody } from "./tiptap-body";
import { VersionHistoryModal } from "./version-history-modal";
import { FastModeDialog } from "@/app/(app)/drafts/[id]/_components/FastModeDialog";
import { OutlinePanel } from "@/app/(app)/drafts/[id]/_components/OutlinePanel";
import { SectionStream } from "@/app/(app)/drafts/[id]/_components/SectionStream";
import { AiBubbleMenu } from "@/app/(app)/drafts/[id]/_components/AiBubbleMenu";
import { ToolCandidateCard } from "@/app/(app)/drafts/[id]/_components/ToolCandidateCard";
import { PromptDrawer } from "@/app/(app)/drafts/[id]/_components/PromptDrawer";
import { PreflightDialog } from "@/app/(app)/drafts/[id]/_components/PreflightDialog";

interface DraftDetail {
  id: string;
  authorId: string;
  title: string;
  body: JSONContent;
  publishedBody: JSONContent | null;
  publishedTitle: string | null;
  publishedVersion: number | null;
  publishedAt: string | null;
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

export function DraftEditor({ id, initialTool }: { id: string; initialTool?: string }) {
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
  // Phase 2.25: URL ?tool=HEADLINE_NEW → 自动打开 Prompt 库,选中对应工具
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(() => {
    if (!initialTool) return false;
    const validTools: readonly string[] = DRAFT_TOOL_TYPES;
    return validTools.includes(initialTool);
  });
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [namingNote, setNamingNote] = useState(false);

  const [toolBusy, setToolBusy] = useState<DraftToolType | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel | null>(null);

  // T8: 多 Tab 抢占检测 — otherTabExists=true 时编辑器切只读 + 显 ReadonlyBanner
  const { otherTabExists } = useDraftPresence(id);

  // T8: 联动 TipTap editable 状态 — 有他 Tab 时禁编辑,独占时恢复
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!otherTabExists);
  }, [editor, otherTabExists]);

  // T7: 冲突短期提示(spec §6),5s 后自动消;启动复活与 save 409 fork 都会置 true。
  const [showConflictBanner, setShowConflictBanner] = useState(false);
  const conflictBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showConflictBannerWithTimeout = useCallback(() => {
    if (conflictBannerTimerRef.current) {
      clearTimeout(conflictBannerTimerRef.current);
    }
    setShowConflictBanner(true);
    conflictBannerTimerRef.current = setTimeout(() => {
      setShowConflictBanner(false);
      conflictBannerTimerRef.current = null;
    }, 5000);
  }, []);

  // unmount cleanup: 清掉残留 timer 防泄漏
  useEffect(
    () => () => {
      if (conflictBannerTimerRef.current) {
        clearTimeout(conflictBannerTimerRef.current);
      }
    },
    [],
  );

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

        // T7: 启动复活 — 比对本地 IDB 快照 vs 云端 baseline(spec §4.3)。
        let snap: Awaited<ReturnType<typeof getSnapshot>> = undefined;
        try {
          snap = await getSnapshot(id);
        } catch {
          // IDB 失败 fallback 到「无快照」分支
        }
        if (cancelled) return;

        const cloudBody = draft.body ?? { type: "doc", content: [] };

        if (!snap) {
          // 无快照 → 用云端
          setTitle(draft.title);
          setBody(cloudBody);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
        } else if (snap.baseVersion === draft.version) {
          // 本地快照对得上云端 baseline → 复活本地(用户上次离线编辑)
          setTitle(snap.title);
          setBody(snap.body);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
        } else if (snap.baseVersion < draft.version) {
          // 他端先改了 → 落 OFFLINE_CONFLICT 备份(异步,失败吞掉)+ 用云端覆盖
          void apiFetch(`/drafts/${id}/versions`, {
            method: "POST",
            body: JSON.stringify({ kind: "OFFLINE_CONFLICT", snapshot: snap.body }),
          }).catch(() => {});
          try {
            await clearSnapshot(id);
          } catch {
            // 清快照失败不阻塞
          }
          if (cancelled) return;
          setTitle(draft.title);
          setBody(cloudBody);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
          showConflictBannerWithTimeout();
        } else {
          // snap.baseVersion > draft.version,理论不可能(防御性清快照)
          console.warn(
            `[draft-cache] snapshot baseVersion ${snap.baseVersion} > server version ${draft.version}, clearing`,
            { draftId: id },
          );
          try {
            await clearSnapshot(id);
          } catch {
            // ignore
          }
          if (cancelled) return;
          setTitle(draft.title);
          setBody(cloudBody);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
        }
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
  }, [id, router, showConflictBannerWithTimeout]);

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
          // T7: 把本地 body 落为 OFFLINE_CONFLICT 备份(异步副作用,失败吞掉,
          // 不阻塞 hook 走 onConflict 流程)
          void apiFetch(`/drafts/${id}/versions`, {
            method: "POST",
            body: JSON.stringify({ kind: "OFFLINE_CONFLICT", snapshot: v.body }),
          }).catch(() => {});
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

  // T7: 收到 409 后把云端 baseline 推回 state + 编辑器,并显示 5s ConflictBanner。
  // 注意 deps 含 editor —— useAutosave 内部用 ref 转储 onConflict,引用变更不会破状态机。
  const onConflict = useCallback(
    (server: { title: string; body: JSONContent; currentVersion: number }) => {
      setBaseVersion(server.currentVersion);
      setTitle(server.title);
      setBody(server.body);
      if (editor) {
        editor.commands.setContent(server.body);
      }
      showConflictBannerWithTimeout();
    },
    [editor, showConflictBannerWithTimeout],
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
          case "DATA_DIAGNOSIS":
            // DATA_DIAGNOSIS 是平台保留诊断工具,不通过 BubbleMenu 分发。
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

  // T7: 顶部 Banner stack(spec §6 优先级:Readonly > Offline > Conflict > Republish)
  // T8: ReadonlyBanner 接入 useDraftPresence 真实多 Tab 抢占状态。
  // Phase 2.15: state.kind === "ready" && publishedAt 非空 → 二发期间显 RepublishBanner
  const isReadonly = otherTabExists;
  const isOffline = status === "offline";
  const isRepublish = state.kind === "ready" && state.draft.publishedAt != null;
  const bannerSlot = isReadonly ? (
    <ReadonlyBanner visible={true} />
  ) : isOffline ? (
    <OfflineBanner visible={true} />
  ) : showConflictBanner ? (
    <ConflictBanner visible={true} onOpenVersionHistory={() => setVersionHistoryOpen(true)} />
  ) : isRepublish ? (
    <RepublishBanner
      publishedAt={state.kind === "ready" ? state.draft.publishedAt : null}
      draftId={id}
    />
  ) : null;

  return (
    <main className="flex flex-1 flex-col gap-4 px-6 py-6 max-w-3xl w-full mx-auto">
      {bannerSlot}
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
