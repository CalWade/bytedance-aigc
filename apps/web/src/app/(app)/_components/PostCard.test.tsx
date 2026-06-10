import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PostDto } from "@bytedance-aigc/shared";
import { PostCard } from "./PostCard";

const mock: PostDto = {
  id: "p1",
  title: "测试标题",
  excerpt: "测试摘要",
  authorId: "a1",
  authorHandle: "demo-author",
  coverIndex: 1,
  qualityOverall: 87,
  hotnessMock: 42,
  publishedAt: new Date("2026-06-01T00:00:00Z").toISOString(),
};

describe("PostCard", () => {
  it("渲染标题、摘要、作者 handle", () => {
    render(<PostCard post={mock} />);
    expect(screen.getByText("测试标题")).toBeInTheDocument();
    expect(screen.getByText("测试摘要")).toBeInTheDocument();
    expect(screen.getByText(/demo-author/)).toBeInTheDocument();
  });

  it("展示 Q/H 评分", () => {
    render(<PostCard post={mock} />);
    expect(screen.getByText(/Q · 87/)).toBeInTheDocument();
    expect(screen.getByText(/H · 42/)).toBeInTheDocument();
  });

  it("链接指向 /post/:id", () => {
    render(<PostCard post={mock} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/post/p1");
  });
});
