"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import { DRAFT_TOOL_TYPES } from "@bytedance-aigc/shared";
import type { Candidate, DraftToolType, OutlineItem } from "@bytedance-aigc/shared";

import { apiFetch, clearToken, getToken } from "@bytedance-aigc/ui/lib/auth";
import { clearSnapshot, getSnapshot } from "@/lib/idb-draft-cache";
import { useAutosave, type SaveResult } from "@/lib/use-autosave";
import { useDraftPresence } from "@/lib/use-draft-presence";

import { ConflictBanner } from "./conflict-banner";
import { OfflineBanner } from "./offline-banner";
import { ReadonlyBanner } from "./readonly-banner";
import { RepublishBanner } from "./republish-banner";
import { TiptapBody } from "./tiptap-body";
import { VersionHistoryModal } from "./version-history-modal";
import { EditorToolbar } from "./editor-toolbar";
import { FastModeDialog } from "@/app/(creator)/drafts/[id]/_components/FastModeDialog";
import { OutlinePanel } from "@/app/(creator)/drafts/[id]/_components/OutlinePanel";
import { SectionStream } from "@/app/(creator)/drafts/[id]/_components/SectionStream";
import { AiBubbleMenu } from "@/app/(creator)/drafts/[id]/_components/AiBubbleMenu";
import { ToolCandidateCard } from "@/app/(creator)/drafts/[id]/_components/ToolCandidateCard";
import { PromptDrawer } from "@/app/(creator)/drafts/[id]/_components/PromptDrawer";
import { PreflightDialog } from "@/app/(creator)/drafts/[id]/_components/PreflightDialog";
import { ReviewDrawer } from "@/app/(creator)/drafts/[id]/_components/ReviewDrawer";
import { AssetPicker } from "./asset-picker";

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

export function DraftEditor({
  id,
  initialTool,
  initialTopic,
  initialOpenFast,
}: {
  id: string;
  initialTool?: string;
  initialTopic?: string;
  initialOpenFast?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<JSONContent>({ type: "doc", content: [] });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [baseVersion, setBaseVersion] = useState<number>(1);

  const [fastDialogOpen, setFastDialogOpen] = useState(Boolean(initialOpenFast));
  const [fast, setFast] = useState<FastStage>({ kind: "idle" });
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(() => {
    if (!initialTool) return false;
    const validTools: readonly string[] = DRAFT_TOOL_TYPES;
    return validTools.includes(initialTool);
  });
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [namingNote, setNamingNote] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const [toolBusy, setToolBusy] = useState<DraftToolType | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel | null>(null);

  const { otherTabExists } = useDraftPresence(id);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!otherTabExists);
  }, [editor, otherTabExists]);

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
      window.location.replace("/login");
      return;
    }
    let cancelled = false;
    void apiFetch(`/drafts/${id}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          window.location.replace("/login");
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

        let snap: Awaited<ReturnType<typeof getSnapshot>> = undefined;
        try {
          snap = await getSnapshot(id);
        } catch {
          // IDB 失败 fallback 到「无快照」分支
        }
        if (cancelled) return;

        const cloudBody = draft.body ?? { type: "doc", content: [] };

        if (!snap) {
          setTitle(draft.title);
          setBody(cloudBody);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
        } else if (snap.baseVersion === draft.version) {
          setTitle(snap.title);
          setBody(snap.body);
          setBaseVersion(draft.version);
          setState({ kind: "ready", draft });
        } else if (snap.baseVersion < draft.version) {
          void apiFetch(`/drafts/${id}/versions`, {
            method: "POST",
            body: JSON.stringify({ kind: "OFFLINE_CONFLICT", snapshot: snap.body }),
          }).catch(() => {});
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
          showConflictBannerWithTimeout();
        } else {
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
  }, [id, showConflictBannerWithTimeout]);

  const value = useMemo(() => ({ title, body }), [title, body]);

  const save = useCallback(
    async (v: { title: string; body: JSONContent }, bv: number): Promise<SaveResult> => {
      const res = await apiFetch(`/drafts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...v, baseVersion: bv }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as {
          message?: string;
          payload?: { currentVersion: number; title: string; body: JSONContent };
        };
        if (body.message === "VERSION_CONFLICT" && body.payload) {
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

  const invokeTool = useCallback(
    async (
      tool: DraftToolType,
      payload: { selectedText: string; fullText: string },
    ): Promise<void> => {
      if (!editor) return;
      setToolBusy(tool);
      setToolError(null);
      try {
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
            return;
          case "DATA_DIAGNOSIS":
            return;
        }
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
    return <div className="py-10 text-[14px] text-muted-foreground text-center">加载中…</div>;
  }
  if (state.kind === "not-found") {
    return <div className="py-10 text-[14px] text-muted-foreground text-center">草稿不存在</div>;
  }
  if (state.kind === "forbidden") {
    return <div className="py-10 text-[14px] text-destructive text-center">无权访问该草稿</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="py-10 text-center">
        <p className="text-[15px] text-destructive">{state.message}</p>
        <p className="text-[12px] text-muted-foreground/70 mt-1">
          请确认 API 服务已在 :4000 端口启动
        </p>
      </div>
    );
  }

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
    <div className="flex flex-col min-h-svh">
      <EditorToolbar
        editor={editor}
        title={title}
        onTitleChange={setTitle}
        saveState={status}
        lastSavedAt={lastSavedAt}
        onOpenFast={() => setFastDialogOpen(true)}
        onOpenReview={() => setReviewDrawerOpen(true)}
        onOpenPreflight={() => setPreflightOpen(true)}
        onOpenVersionHistory={() => setVersionHistoryOpen(true)}
        onMarkVersion={() => void markVersion()}
        onOpenPromptDrawer={() => setPromptDrawerOpen(true)}
        namingNote={namingNote}
        onOpenAssetPicker={() => setAssetPickerOpen(true)}
        onSave={() => void flush()}
        saving={status === "saving"}
      />

      {bannerSlot}

      {(fast.kind === "outline" || fast.kind === "stream") && (
        <div className="mx-auto w-full max-w-[820px] px-6">
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
              onError={() => {}}
            />
          )}
        </div>
      )}

      <div className="mx-auto w-full max-w-prose px-6 flex-1 flex flex-col">
        <TiptapBody initial={body} onChange={setBody} onReady={setEditor} />
      </div>

      <AiBubbleMenu editor={editor} onInvoke={invokeTool} />

      {toolBusy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-[12px] rounded-md bg-foreground text-background px-3 py-1.5 shadow-md">
          调用 {toolBusy}…
        </div>
      )}
      {toolError && !toolBusy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-[12px] rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 shadow-md">
          工具失败: {toolError}
        </div>
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
        initialTopic={initialTopic}
      />

      <PromptDrawer open={promptDrawerOpen} onClose={() => setPromptDrawerOpen(false)} />

      <PreflightDialog draftId={id} open={preflightOpen} onClose={() => setPreflightOpen(false)} />

      <ReviewDrawer
        draftId={id}
        open={reviewDrawerOpen}
        onClose={() => setReviewDrawerOpen(false)}
      />

      <VersionHistoryModal
        draftId={id}
        currentBody={body}
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        onRestored={handleRestored}
      />

      <AssetPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={(url) => {
          if (editor) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        }}
      />
    </div>
  );
}
