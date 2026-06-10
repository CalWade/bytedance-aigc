import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SafeRewriteCard } from "./SafeRewriteCard";

vi.mock("@/hooks/use-safe-rewrite", () => ({
  useSafeRewrite: () => ({
    candidates: ["稳妥版本", "另一版本"],
    status: ["done", "done"],
    error: null,
    start: vi.fn(),
    abort: vi.fn(),
  }),
}));

describe("SafeRewriteCard", () => {
  const baseProps = {
    open: true,
    request: {
      draftId: "d1",
      text: "原文",
      hitCategories: ["fraud" as const],
      message: "命中欺诈",
    },
    onAdopt: vi.fn(),
    onClose: vi.fn(),
  };

  it("打开时渲染两路候选", () => {
    render(<SafeRewriteCard {...baseProps} />);
    expect(screen.getByText("稳妥版本")).toBeInTheDocument();
    expect(screen.getByText("另一版本")).toBeInTheDocument();
  });

  it("点击采用 → 触发 onAdopt(候选文本) 并 close", () => {
    const onAdopt = vi.fn();
    const onClose = vi.fn();
    render(<SafeRewriteCard {...baseProps} onAdopt={onAdopt} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole("button", { name: "采用" })[0]);
    expect(onAdopt).toHaveBeenCalledWith("稳妥版本");
    expect(onClose).toHaveBeenCalled();
  });

  it("点击关闭 → onClose,不 onAdopt", () => {
    const onAdopt = vi.fn();
    const onClose = vi.fn();
    render(<SafeRewriteCard {...baseProps} onAdopt={onAdopt} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
    expect(onAdopt).not.toHaveBeenCalled();
  });
});
