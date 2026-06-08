import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReadonlyBanner } from "./readonly-banner";

describe("ReadonlyBanner", () => {
  it("visible=true 渲染 testid 与只读文案", () => {
    render(<ReadonlyBanner visible={true} />);
    expect(screen.getByTestId("readonly-banner")).toBeInTheDocument();
    expect(screen.getByText(/已切到只读模式/)).toBeInTheDocument();
  });

  it("visible=false 不渲染", () => {
    const { container } = render(<ReadonlyBanner visible={false} />);
    expect(container.firstChild).toBeNull();
  });
});
