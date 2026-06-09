/**
 * Phase 2.17 — PromptDrawer 「恢复默认」+ 「历史 ▾」+ 「回滚」测试
 *
 * 模拟 useActivePromptId hook + apiFetch,验证:
 *   - 「恢复默认」按钮调 setPromptId(平台 isStarter id)
 *   - 平台无 isStarter → 按钮 disabled
 *   - 「历史 ▾」展开拉 GET /prompts/:id/snapshots
 *   - 「回滚」点击发 POST /restore
 *   - 历史展开后无快照 → 显示空文案
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PromptDrawer } from "./PromptDrawer";

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(),
}));

const setPromptIdMock = vi.fn();
vi.mock("@/hooks/use-active-prompt-id", () => ({
  useActivePromptId: () => ({ promptId: null, setPromptId: setPromptIdMock }),
}));

import { apiFetch } from "@/lib/auth";

const platformPrompt = {
  id: "plat-1",
  owner: "PLATFORM" as const,
  authorId: null,
  tool: "REWRITE_FLUENT" as const,
  name: "默认款",
  systemPrompt: "你是一个流畅化助手",
  designNote: null,
  isStarter: true,
  sourcePromptId: null,
};

const myPrompt = {
  id: "mine-1",
  owner: "PRIVATE" as const,
  authorId: "u1",
  tool: "REWRITE_FLUENT" as const,
  name: "我的副本",
  systemPrompt: "改后内容",
  designNote: null,
  isStarter: false,
  sourcePromptId: "plat-1",
};

const setupFetch = (responders: Record<string, unknown>): void => {
  (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    const body = responders[url];
    return Promise.resolve({
      ok: body !== undefined,
      json: async () => body,
    });
  });
};

describe("PromptDrawer Phase 2.17", () => {
  beforeEach(() => {
    setPromptIdMock.mockClear();
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("点「恢复默认」调 setPromptId(平台 isStarter id)", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformPrompt],
      "/prompts/private": [myPrompt],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("我的"));
    await waitFor(() => screen.getByText("我的副本"));
    fireEvent.click(screen.getByText("恢复默认"));
    expect(setPromptIdMock).toHaveBeenCalledWith("plat-1");
  });

  it("平台无 isStarter → 「恢复默认」 disabled", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [{ ...platformPrompt, isStarter: false }],
      "/prompts/private": [myPrompt],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("我的"));
    await waitFor(() => screen.getByText("我的副本"));
    expect(screen.getByText("恢复默认")).toBeDisabled();
  });

  it("点「历史 ▾」 拉 snapshots 端点", async () => {
    const snap = {
      id: "s1",
      systemPrompt: "上一版内容",
      designNote: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformPrompt],
      "/prompts/private": [myPrompt],
      "/prompts/mine-1/snapshots": [snap],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("我的"));
    await waitFor(() => screen.getByText("我的副本"));
    fireEvent.click(screen.getByText("历史 ▾"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/prompts/mine-1/snapshots"));
    await waitFor(() => screen.getByText(/上一版内容/));
  });

  it("点「回滚」调 restore 端点", async () => {
    const snap = {
      id: "s1",
      systemPrompt: "上一版内容",
      designNote: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformPrompt],
      "/prompts/private": [myPrompt],
      "/prompts/mine-1/snapshots": [snap],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("我的"));
    await waitFor(() => screen.getByText("我的副本"));
    fireEvent.click(screen.getByText("历史 ▾"));
    await waitFor(() => screen.getByText("回滚"));
    fireEvent.click(screen.getByText("回滚"));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/prompts/mine-1/snapshots/s1/restore", {
        method: "POST",
        body: "{}",
      }),
    );
  });

  it("历史展开后无快照 → 显示空文案", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformPrompt],
      "/prompts/private": [myPrompt],
      "/prompts/mine-1/snapshots": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("我的"));
    await waitFor(() => screen.getByText("我的副本"));
    fireEvent.click(screen.getByText("历史 ▾"));
    await waitFor(() => screen.getByText(/暂无历史快照/));
  });
});
