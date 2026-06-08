import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ConflictBanner } from "./conflict-banner";

describe("ConflictBanner", () => {
  it("visible=true 渲染 testid 与冲突文案", () => {
    render(<ConflictBanner visible={true} />);
    expect(screen.getByTestId("conflict-banner")).toBeInTheDocument();
    expect(screen.getByText(/他端已修改/)).toBeInTheDocument();
  });

  it("visible=false 不渲染", () => {
    const { container } = render(<ConflictBanner visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("点击「查看冲突备份」触发 onOpenVersionHistory", () => {
    const onOpen = vi.fn();
    render(<ConflictBanner visible={true} onOpenVersionHistory={onOpen} />);
    fireEvent.click(screen.getByText("查看冲突备份"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("未传 onOpenVersionHistory 时不显示按钮", () => {
    render(<ConflictBanner visible={true} />);
    expect(screen.queryByText("查看冲突备份")).not.toBeInTheDocument();
  });
});
