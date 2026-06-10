/**
 * Phase 2.18 — /me/works 行按钮测试:
 *   - PUBLISHED 行点「下线」→ confirm 通过 → fetch POST /drafts/:id/takedown
 *   - OFFLINE 行点「重新提审」→ fetch POST /drafts/:id/restore-from-offline
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import MyWorksPage from "../page";

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(),
  getToken: vi.fn(() => "fake-token"),
  clearToken: vi.fn(),
}));

import { apiFetch } from "@/lib/auth";

// Mock next/navigation
const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
  usePathname: () => "/me/works",
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const publishedWork = {
  id: "pub-1",
  title: "已发布文章",
  status: "PUBLISHED" as const,
  mode: "FAST" as const,
  publishedAt: "2026-06-08T10:00:00Z",
  updatedAt: "2026-06-08T10:00:00Z",
  qualityOverall: 80,
  recommendation: "ALLOW" as const,
  offlineReason: null,
  offlineAt: null,
};

const offlineWork = {
  id: "off-1",
  title: "已下线文章",
  status: "OFFLINE" as const,
  mode: "FINE" as const,
  publishedAt: null,
  updatedAt: "2026-06-08T10:00:00Z",
  qualityOverall: 60,
  recommendation: "WARN" as const,
  offlineReason: "作者主动下线",
  offlineAt: "2026-06-08T12:00:00Z",
};

describe("/me/works 行按钮 — Phase 2.18", () => {
  beforeEach(() => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("PUBLISHED 行点「下线」→ confirm 通过 → fetch POST /drafts/:id/takedown", async () => {
    // Mock: GET /me/works 返回 PUBLISHED 稿件
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/me/works")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [publishedWork] }),
        });
      }
      // takedown
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    // confirm 返回 true
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MyWorksPage />);

    // 等待列表加载
    await waitFor(() => screen.getByText("已发布文章"));

    // 点下线按钮
    const takedownBtn = screen.getByText("下线");
    fireEvent.click(takedownBtn);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/drafts/pub-1/takedown", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(window.confirm).toHaveBeenCalledWith("确认下线?线上读者将看不到");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("OFFLINE 行点「重新提审」→ fetch POST /drafts/:id/restore-from-offline", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/me/works")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [offlineWork] }),
        });
      }
      // restore-from-offline
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<MyWorksPage />);

    // 等待列表加载
    await waitFor(() => screen.getByText("已下线文章"));

    // 点重新提审按钮
    const restoreBtn = screen.getByText("重新提审");
    fireEvent.click(restoreBtn);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/drafts/off-1/restore-from-offline", {
        method: "POST",
      }),
    );

    expect(pushMock).toHaveBeenCalledWith("/drafts/off-1");
  });
});
