import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { OfflineBanner } from "./offline-banner";

describe("OfflineBanner", () => {
  it("visible=true 渲染 testid 与离线文案", () => {
    render(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    expect(screen.getByText(/当前离线/)).toBeInTheDocument();
  });

  it("visible=false 不渲染", () => {
    const { container } = render(<OfflineBanner visible={false} />);
    expect(container.firstChild).toBeNull();
  });
});
