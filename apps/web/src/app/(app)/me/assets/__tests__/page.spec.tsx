import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AssetsPage from "../page";

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
  usePathname: () => "/me/assets",
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const mockAssets = [
  {
    id: "a1",
    key: "users/u1/ai/1.png",
    url: "https://placehold.co/512x512",
    mime: "image/png",
    size: 0,
    aiGenerated: true,
    aiPrompt: "a cat in office",
    sceneTags: ["办公室"],
    subjectTags: ["动物"],
    createdAt: "2026-06-09T00:00:00Z",
  },
  {
    id: "a2",
    key: "users/u1/2.jpg",
    url: "https://mock.local/photo.jpg",
    mime: "image/jpeg",
    size: 1024,
    aiGenerated: false,
    aiPrompt: null,
    sceneTags: ["户外"],
    subjectTags: ["风景"],
    createdAt: "2026-06-08T00:00:00Z",
  },
];

describe("/me/assets page", () => {
  beforeEach(() => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it("列表渲染 + tags chip 显示", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.startsWith("/assets/mine") || url.startsWith("/assets/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: mockAssets }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<AssetsPage />);

    await waitFor(() => screen.getAllByText("办公室"));
    expect(screen.getAllByText("办公室").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("动物").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("户外").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("风景").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("AI 生成")).toBeTruthy();
  });

  it("点 AI 生图 → modal → 输入 prompt → 提交 → fetch POST /assets/generate 被调用", async () => {
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, opts?: Record<string, unknown>) => {
        if (opts?.method === "POST" && (url as string).endsWith("/generate")) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: "a3",
              key: "k3",
              url: "https://mock.local/3",
              aiGenerated: true,
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: mockAssets }),
        });
      },
    );

    render(<AssetsPage />);

    // Wait for page to load
    await waitFor(() => screen.getByText("AI 生图"));

    // Click "AI 生图" button
    const generateBtn = screen.getByText("AI 生图");
    fireEvent.click(generateBtn);

    // Modal should appear with textarea
    const textarea = await screen.findByPlaceholderText("描述你想生成的图片...");
    fireEvent.change(textarea, { target: { value: "一只猫在办公室" } });

    // Click "生成" button in modal
    const submitBtn = screen.getByText("生成");
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/assets/generate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ prompt: "一只猫在办公室" }),
        }),
      ),
    );
  });
});
