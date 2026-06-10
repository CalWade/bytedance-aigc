/**
 * Phase 2.25 — 诊断卡片渲染 + 按钮链接测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import MyWorksPage from "../page";
import type { MeWorksItem } from "@bytedance-aigc/shared";

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(),
  getToken: vi.fn(() => "fake-token"),
  clearToken: vi.fn(),
}));

import { apiFetch } from "@/lib/auth";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
  usePathname: () => "/me/works",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const publishedWithDiagnosis: MeWorksItem = {
  id: "diag-1",
  title: "诊断测试文章",
  status: "PUBLISHED",
  mode: "FAST",
  publishedAt: "2026-06-08T10:00:00Z",
  updatedAt: "2026-06-08T10:00:00Z",
  qualityOverall: 80,
  recommendation: "ALLOW",
  offlineReason: null,
  offlineAt: null,
  stat: { impression: 50, click: 5, dwellUnit: 4, like: 1, collect: 0, share: 0 },
  diagnosis: {
    title: "好文章被埋了",
    description: "质量分高但阅读量低，换个标题可能让更多人看到",
    toolAction: "HEADLINE_NEW",
  },
};

const publishedWithoutDiagnosis: MeWorksItem = {
  id: "no-diag-1",
  title: "健康文章",
  status: "PUBLISHED",
  mode: "FINE",
  publishedAt: "2026-06-08T10:00:00Z",
  updatedAt: "2026-06-08T10:00:00Z",
  qualityOverall: 80,
  recommendation: "ALLOW",
  offlineReason: null,
  offlineAt: null,
  stat: { impression: 500, click: 200, dwellUnit: 180, like: 30, collect: 10, share: 5 },
  diagnosis: null,
};

describe("/me/works 诊断卡片 — Phase 2.25", () => {
  beforeEach(() => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("有 diagnosis 的 PUBLISHED 行显示诊断卡片", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/me/works")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [publishedWithDiagnosis] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<MyWorksPage />);

    await waitFor(() => screen.getByText("好文章被埋了"));
    expect(screen.getByText("质量分高但阅读量低，换个标题可能让更多人看到")).toBeInTheDocument();
  });

  it("诊断卡片「去优化」链接指向 /drafts/:id?tool=HEADLINE_NEW", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/me/works")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [publishedWithDiagnosis] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<MyWorksPage />);

    await waitFor(() => screen.getByText("好文章被埋了"));
    const link = screen.getByText("去优化").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/drafts/diag-1?tool=HEADLINE_NEW");
  });

  it("无 diagnosis 的 PUBLISHED 行不显示诊断卡片", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/me/works")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [publishedWithoutDiagnosis] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<MyWorksPage />);

    await waitFor(() => screen.getByText("健康文章"));
    expect(screen.queryByText("好文章被埋了")).not.toBeInTheDocument();
    expect(screen.queryByText("去优化")).not.toBeInTheDocument();
  });
});
