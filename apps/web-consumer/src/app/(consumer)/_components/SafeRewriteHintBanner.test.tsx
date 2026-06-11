import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SafeRewriteHintBanner } from "./SafeRewriteHintBanner";

describe("SafeRewriteHintBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("localStorage 无 safeRewriteHint 时不渲染", () => {
    const { container } = render(<SafeRewriteHintBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("localStorage 有有效 hint 时渲染横幅并显示 category 和链接", () => {
    const hint = {
      draftId: "abc123",
      category: "敏感词",
      ts: Date.now() - 60_000, // 1 分钟前
    };
    localStorage.setItem("safeRewriteHint", JSON.stringify(hint));
    render(<SafeRewriteHintBanner />);
    expect(screen.queryByText(/敏感词/)).not.toBeNull();
    const link = screen.getByText(/回到草稿/) as HTMLAnchorElement;
    expect(link.href).toContain("/drafts/abc123");
  });

  it("localStorage 有过期 hint 时不渲染", () => {
    const hint = {
      draftId: "abc123",
      category: "敏感词",
      ts: Date.now() - 31 * 60 * 1000, // 31 分钟前
    };
    localStorage.setItem("safeRewriteHint", JSON.stringify(hint));
    const { container } = render(<SafeRewriteHintBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
