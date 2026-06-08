import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";

import { clearSnapshot, putSnapshot } from "./idb-draft-cache";

export type AutosaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "error";

export interface AutosaveOptions {
  draftId: string;
  baseVersion: number;
  /** 收到 409 时,hook 调它把云端 body 同步给编辑器(setContent + 重置 state)*/
  onConflict: (server: { title: string; body: JSONContent; currentVersion: number }) => void;
  intervalMs?: number; // 默认 30000
  localDebounceMs?: number; // 默认 1000
}

export type SaveResult =
  | { ok: true; newVersion: number }
  | { ok: false; conflict: { currentVersion: number; title: string; body: JSONContent } };

export interface AutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  /**
   * 切流式态(true)。期间 value 变化只更新 valueRef,不进入 dirty/IDB/上传路径。
   * 切回 false 不会自动 flush;调用方需要落库时显式 flush()。
   */
  setStreaming: (on: boolean) => void;
  /** 立刻 maybePush 一次。 */
  flush: () => Promise<void>;
}

type AutosaveValue = { title: string; body: JSONContent } | null;

function valueEqual(a: AutosaveValue, b: AutosaveValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  // WHY: TipTap JSONContent 嵌套树,简单稳定的方式就是 JSON.stringify。
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useAutosave<T extends { title: string; body: JSONContent } | null>(
  value: T,
  save: (v: NonNullable<T>, baseVersion: number) => Promise<SaveResult>,
  options: AutosaveOptions,
): AutosaveResult {
  const { draftId, onConflict, intervalMs = 30_000, localDebounceMs = 1_000 } = options;

  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const onConflictRef = useRef(onConflict);
  useEffect(() => {
    onConflictRef.current = onConflict;
  }, [onConflict]);

  // 当前值快照(在 effect 中同步,避免渲染期写 ref)
  const valueRef = useRef<AutosaveValue>(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // 上次成功上传到服务端的值;用于 dedupe
  const lastUploadedRef = useRef<AutosaveValue>(null);

  // baseVersion 由 hook 自维护:options.baseVersion 入栈作为初始,后续随 save 成功 / 冲突更新
  const baseVersionRef = useRef<number>(options.baseVersion);
  // WHY: options.baseVersion 由调用方在 GET draft 后填入,变更时同步进 ref
  useEffect(() => {
    baseVersionRef.current = options.baseVersion;
  }, [options.baseVersion]);

  const streamingRef = useRef(false);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  // 上次 render 见到的 value;用于 render 期派生 dirty 状态(避免 effect 内 setState)。
  // 首次 render 时 lastSeenValue 与 value 相同(lazy init),不会触发 dirty。
  const [lastSeenValue, setLastSeenValue] = useState<AutosaveValue>(() => value);
  if (value !== lastSeenValue) {
    setLastSeenValue(value);
    // streaming / null 情况由 effect 拦截,这里只兜 dirty 派生逻辑
    if (value !== null) {
      setStatus((prev) => (prev === "saving" || prev === "conflict" ? prev : "dirty"));
    }
  }

  const maybePush = useCallback(async (): Promise<void> => {
    // 离线 → status=offline,直接 return
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus("offline");
      return;
    }
    const v = valueRef.current;
    if (v === null) return;
    if (valueEqual(v, lastUploadedRef.current)) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setStatus("saving");
    try {
      const result = await saveRef.current(v as NonNullable<T>, baseVersionRef.current);
      if (result.ok) {
        baseVersionRef.current = result.newVersion;
        lastUploadedRef.current = v;
        // 成功上传后清掉本地快照(IDB)
        try {
          await clearSnapshot(draftId);
        } catch {
          // IDB 失败不影响保存状态
        }
        setStatus("saved");
        setLastSavedAt(Date.now());
      } else {
        const c = result.conflict;
        try {
          onConflictRef.current(c);
        } catch {
          // 调用方 callback 抛错不该破坏 hook 状态机
        }
        baseVersionRef.current = c.currentVersion;
        lastUploadedRef.current = { title: c.title, body: c.body };
        setStatus("conflict");
        if (conflictResetTimerRef.current) clearTimeout(conflictResetTimerRef.current);
        conflictResetTimerRef.current = setTimeout(() => {
          setStatus("saved");
        }, 2_000);
      }
    } catch {
      setStatus("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [draftId]);

  // 30s 周期 maybePush
  useEffect(() => {
    const timer = setInterval(() => {
      void maybePush();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, maybePush]);

  // online / offline 监听
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      void maybePush();
    };
    const onOffline = () => {
      setStatus("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [maybePush]);

  // value 变化 → 1s 后 putSnapshot 到 IDB(dirty 状态由 render 期派生处理)。
  // value 没真正变时(同一引用)effect 不会再跑;首次 mount 借 lastSeenValue 派生跳过。
  const initialValueRef = useRef(value);
  useEffect(() => {
    if (value === initialValueRef.current) return;
    if (streamingRef.current) return;
    if (value === null) return;

    if (localTimerRef.current) {
      clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
    const timer = setTimeout(() => {
      const v = valueRef.current;
      if (v === null) return;
      void putSnapshot(draftId, {
        title: v.title,
        body: v.body,
        baseVersion: baseVersionRef.current,
        localUpdatedAt: Date.now(),
      }).catch(() => {
        // IDB 写失败不影响 UI 状态
      });
    }, localDebounceMs);
    localTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (localTimerRef.current === timer) localTimerRef.current = null;
    };
  }, [value, draftId, localDebounceMs]);

  // 卸载清理冲突回退 timer
  useEffect(() => {
    return () => {
      if (conflictResetTimerRef.current) clearTimeout(conflictResetTimerRef.current);
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
    };
  }, []);

  const setStreaming = useCallback((on: boolean) => {
    streamingRef.current = on;
    if (on && localTimerRef.current) {
      clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (localTimerRef.current) {
      clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
    await maybePush();
  }, [maybePush]);

  return { status, lastSavedAt, setStreaming, flush };
}
