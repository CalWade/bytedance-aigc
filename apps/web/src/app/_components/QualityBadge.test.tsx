import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityBadge } from "./QualityBadge";

describe("QualityBadge", () => {
  it("不渲染当分数 < 80", () => {
    const { container } = render(<QualityBadge score={79} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("渲染优质 chip 当分数 >= 80", () => {
    render(<QualityBadge score={80} />);
    expect(screen.getByText("优质")).toBeInTheDocument();
  });

  it("size=sm 用更小字号 class", () => {
    render(<QualityBadge score={90} size="sm" />);
    expect(screen.getByText("优质").className).toContain("text-[10px]");
  });
});
