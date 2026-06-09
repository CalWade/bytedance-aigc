import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { SectionReviewItem } from "@/hooks/use-section-review";

import { SectionReviewCard } from "./SectionReviewCard";

function makeItem(overrides: Partial<SectionReviewItem> = {}): SectionReviewItem {
  return {
    heading: "段落一",
    range: { from: 1, to: 10 },
    result: {
      recommendation: "WARN",
      hitCategories: ["pornography"],
      severity: "high",
      message: "建议改写为更中性表述",
      abortStream: false,
      reviewId: "rv-1",
    },
    ...overrides,
  };
}

describe("SectionReviewCard", () => {
  it("点击 重新生成 调 onRegenerate(heading)", () => {
    const onRegenerate = vi.fn();
    const onApplySuggestion = vi.fn();
    const onKeep = vi.fn();
    render(
      <SectionReviewCard
        item={makeItem()}
        draftId="d1"
        text="段落原文"
        onRegenerate={onRegenerate}
        onApplySuggestion={onApplySuggestion}
        onKeep={onKeep}
      />,
    );
    fireEvent.click(screen.getByText("重新生成"));
    expect(onRegenerate).toHaveBeenCalledWith("段落一");
    expect(onApplySuggestion).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("点击 修改建议 调 onApplySuggestion(heading, suggestion)", () => {
    const onRegenerate = vi.fn();
    const onApplySuggestion = vi.fn();
    const onKeep = vi.fn();
    render(
      <SectionReviewCard
        item={makeItem()}
        draftId="d1"
        text="段落原文"
        onRegenerate={onRegenerate}
        onApplySuggestion={onApplySuggestion}
        onKeep={onKeep}
      />,
    );
    fireEvent.click(screen.getByText("修改建议"));
    expect(onApplySuggestion).toHaveBeenCalledWith("段落一", "建议改写为更中性表述");
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("点击 仍要保留 调 onKeep(heading)", () => {
    const onRegenerate = vi.fn();
    const onApplySuggestion = vi.fn();
    const onKeep = vi.fn();
    render(
      <SectionReviewCard
        item={makeItem()}
        draftId="d1"
        text="段落原文"
        onRegenerate={onRegenerate}
        onApplySuggestion={onApplySuggestion}
        onKeep={onKeep}
      />,
    );
    fireEvent.click(screen.getByText("仍要保留"));
    expect(onKeep).toHaveBeenCalledWith("段落一");
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(onApplySuggestion).not.toHaveBeenCalled();
  });
});
