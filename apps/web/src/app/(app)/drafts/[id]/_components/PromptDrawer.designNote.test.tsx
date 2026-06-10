/**
 * Phase 2.19 — PromptDrawer designNote 渲染 + 默认款/风格款 chip 测试
 *
 * 验证:
 *   - 带 designNote 的 platform prompt 显示「设计注释」details summary
 *   - 点击 summary 展开后 designNote 文本可见
 *   - isStarter:true → 显示「默认款」chip(emerald)
 *   - isStarter:false → 显示「风格款」chip(blue)
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

const platformDefault = {
  id: "plat-default",
  owner: "PLATFORM" as const,
  authorId: null,
  tool: "REWRITE_FLUENT" as const,
  name: "默认·改写更通顺",
  systemPrompt: "你是一名专业中文编辑。",
  designNote: "用于段落级流畅度修复;不允许增删事实,只动表达。",
  isStarter: true,
  sourcePromptId: null,
};

const platformStyle = {
  id: "plat-style",
  owner: "PLATFORM" as const,
  authorId: null,
  tool: "REWRITE_FLUENT" as const,
  name: "风格款·口语化",
  systemPrompt: "你是一名专业中文编辑。请将段落改写为口语化表达。",
  designNote: "解决默认款输出偏书面的问题。适合知识区轻内容。与默认款差异:追求口语节奏感。",
  isStarter: false,
  sourcePromptId: null,
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

describe("PromptDrawer Phase 2.19 designNote + chip", () => {
  beforeEach(() => {
    setPromptIdMock.mockClear();
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("带 designNote 的 platform prompt 显示「设计注释」details summary", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformDefault, platformStyle],
      "/prompts/private": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText("风格款·口语化"));
    // 两个 prompt 都有 designNote,应各有一个 summary
    const summaries = screen.getAllByText(/设计注释/);
    expect(summaries.length).toBe(2);
  });

  it("点击 summary 展开后 designNote 文本可见", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformDefault, platformStyle],
      "/prompts/private": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText("风格款·口语化"));

    // designNote 默认在 <details> 内隐藏,点击 summary 展开
    const styleSummaries = screen.getAllByText(/设计注释/);
    fireEvent.click(styleSummaries[1]); // 点击风格款的 summary

    await waitFor(() => screen.getByText(/解决默认款输出偏书面的问题/));
  });

  it("isStarter:true → 显示「默认款」chip", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformDefault, platformStyle],
      "/prompts/private": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText("默认·改写更通顺"));

    const defaultChip = screen.getByText("默认款");
    expect(defaultChip).toBeInTheDocument();
    // emerald chip class
    expect(defaultChip.className).toContain("bg-emerald-100");
  });

  it("isStarter:false → 显示「风格款」chip", async () => {
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [platformDefault, platformStyle],
      "/prompts/private": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText("风格款·口语化"));

    const styleChip = screen.getByText("风格款");
    expect(styleChip).toBeInTheDocument();
    // blue chip class
    expect(styleChip.className).toContain("bg-blue-100");
  });

  it("无 designNote 的 prompt 不显示「设计注释」summary", async () => {
    const noNotePrompt = {
      id: "plat-nonote",
      owner: "PLATFORM" as const,
      authorId: null,
      tool: "REWRITE_FLUENT" as const,
      name: "无注释款",
      systemPrompt: "你是一名内容编辑。",
      designNote: null,
      isStarter: true,
      sourcePromptId: null,
    };
    setupFetch({
      "/prompts?tool=REWRITE_FLUENT": [noNotePrompt],
      "/prompts/private": [],
    });
    render(<PromptDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText("无注释款"));

    expect(screen.queryByText(/设计注释/)).not.toBeInTheDocument();
  });
});
