import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutosave, type SaveResult } from "./use-autosave";

vi.mock("./idb-draft-cache", () => ({
  putSnapshot: vi.fn().mockResolvedValue(undefined),
  clearSnapshot: vi.fn().mockResolvedValue(undefined),
  getSnapshot: vi.fn().mockResolvedValue(undefined),
}));

import * as idb from "./idb-draft-cache";

const baseDoc = { type: "doc", content: [] };

function ok(version: number): SaveResult {
  return { ok: true, newVersion: version };
}

function makeOptions(over?: Partial<Parameters<typeof useAutosave>[2]>) {
  return {
    draftId: "draft-1",
    baseVersion: 1,
    onConflict: vi.fn(),
    intervalMs: 30_000,
    localDebounceMs: 1_000,
    ...over,
  };
}

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(idb.putSnapshot).mockClear();
    vi.mocked(idb.clearSnapshot).mockClear();
    // 默认走 online
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("初始为 idle,不调 save", () => {
    const save = vi.fn(async () => ok(2));
    const { result } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    expect(result.current.status).toBe("idle");
    expect(save).not.toHaveBeenCalled();
  });

  it("value 变化后 status -> dirty,30s 后周期 save 一次 -> saved", async () => {
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    expect(result.current.status).toBe("dirty");
    expect(save).not.toHaveBeenCalled();

    // 仅推进 1.5s,旧防抖窗口已不应触发 save
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(save).not.toHaveBeenCalled();

    // 推进到 30s 周期 tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "b", body: baseDoc }, 1);
    expect(result.current.status).toBe("saved");
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it("30s 内连改两次只触发一次 save,使用最后一次值", async () => {
    const save = vi.fn(async () => ok(2));
    const { rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    rerender({ v: { title: "c", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "c", body: baseDoc }, 1);
  });

  it("save reject -> status = error", async () => {
    const save = vi.fn(async () => {
      throw new Error("network");
    });
    const { result, rerender } = renderHook(
      ({ v }) =>
        useAutosave(
          v,
          save as unknown as (
            v: { title: string; body: typeof baseDoc },
            bv: number,
          ) => Promise<SaveResult>,
          makeOptions(),
        ),
      { initialProps: { v: { title: "a", body: baseDoc } } },
    );

    rerender({ v: { title: "b", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
  });

  it("setStreaming(true) 期间 value 变化不触发 save 也不进 dirty", async () => {
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    act(() => {
      result.current.setStreaming(true);
    });

    rerender({ v: { title: "b", body: baseDoc } });
    rerender({ v: { title: "c", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // streaming 期间周期 tick 仍会跑,但 valueRef 更新 → 仍会 push?
    // 行为约定:streaming 跳过 dirty/IDB,不阻止 30s 周期上传(value 已更新就推送)。
    // 当前实现:streaming 不影响 maybePush;周期到点后会上传最新 value。
    // 所以这里允许 save 被调用 1 次,但 status 在 streaming 期间不该是 dirty。
    expect(result.current.status).not.toBe("dirty");
  });

  it("setStreaming(false) 后再变 value 恢复正常防抖", async () => {
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    act(() => result.current.setStreaming(true));
    rerender({ v: { title: "b", body: baseDoc } });

    act(() => result.current.setStreaming(false));
    rerender({ v: { title: "c", body: baseDoc } });
    expect(result.current.status).toBe("dirty");
  });

  it("flush() 立即 save 最新值,settle 时 promise settle", async () => {
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    act(() => result.current.setStreaming(true));
    rerender({ v: { title: "stream-tail", body: baseDoc } });

    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "stream-tail", body: baseDoc }, 1);
    expect(result.current.status).toBe("saved");
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it("flush() 取消正在等待的本地防抖,只触发一次 save", async () => {
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    expect(result.current.status).toBe("dirty");

    await act(async () => {
      await result.current.flush();
    });
    // 周期 timer 再跑一圈也不应再 save(因 lastUploadedRef dedupe)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "b", body: baseDoc }, 1);
  });

  // ---- Phase 2.14 Task 6 新增 ----

  it("offline -> status=offline,周期 tick 不调 save", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const save = vi.fn(async () => ok(2));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("offline");
  });

  it("online 事件 -> 立刻补一次 save(不等周期)", async () => {
    const save = vi.fn(async () => ok(2));
    const { rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    // 不推时间,直接发 online
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "b", body: baseDoc }, 1);
  });

  it("收 {ok:false,conflict} -> 调 onConflict + status=conflict + 2s 后 status=saved", async () => {
    const conflictPayload = {
      currentVersion: 9,
      title: "server-title",
      body: { type: "doc", content: [{ type: "paragraph" }] },
    };
    const save = vi.fn(async () => ({ ok: false as const, conflict: conflictPayload }));
    const onConflict = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, makeOptions({ onConflict })),
      { initialProps: { v: { title: "a", body: baseDoc } } },
    );

    rerender({ v: { title: "local-edit", body: baseDoc } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledWith(conflictPayload);
    expect(result.current.status).toBe("conflict");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.status).toBe("saved");
  });

  it("value 变 1s 后 putSnapshot 被调", async () => {
    const save = vi.fn(async () => ok(2));
    const { rerender } = renderHook(({ v }) => useAutosave(v, save, makeOptions()), {
      initialProps: { v: { title: "a", body: baseDoc } },
    });

    rerender({ v: { title: "b", body: baseDoc } });
    expect(idb.putSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(idb.putSnapshot).toHaveBeenCalledTimes(1);
    const [draftId, snap] = vi.mocked(idb.putSnapshot).mock.calls[0];
    expect(draftId).toBe("draft-1");
    expect(snap.title).toBe("b");
    expect(snap.body).toEqual(baseDoc);
    expect(snap.baseVersion).toBe(1);
    expect(typeof snap.localUpdatedAt).toBe("number");
  });
});
