/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ReviewDecorationsExt, dispatchSetViolations } from "./review-decorations";
import type { Violation } from "./review-decorations";

describe("ReviewDecorationsExt", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit, ReviewDecorationsExt],
      content: "<p>Hello sensitive world</p>",
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("初始无 violations", () => {
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation").length).toBe(0);
  });

  it("setWordViolations:渲染对应 decoration", () => {
    const violations: Violation[] = [
      {
        id: "v1",
        from: 7,
        to: 16,
        severity: "high",
        category: "vulgarity",
        source: "word",
        message: "test",
      },
    ];
    dispatchSetViolations(editor, "word", violations);
    const dom = editor.view.dom as HTMLElement;
    const els = dom.querySelectorAll(".review-violation--word");
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it("clear 清空指定 source 的 decoration", () => {
    dispatchSetViolations(editor, "word", [
      {
        id: "v1",
        from: 1,
        to: 4,
        severity: "low",
        category: "vulgarity",
        source: "word",
        message: "",
      },
    ]);
    dispatchSetViolations(editor, "word", []);
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation--word").length).toBe(0);
  });

  it("section 与 word 互不影响", () => {
    dispatchSetViolations(editor, "word", [
      {
        id: "v1",
        from: 1,
        to: 3,
        severity: "low",
        category: "vulgarity",
        source: "word",
        message: "",
      },
    ]);
    dispatchSetViolations(editor, "section", [
      {
        id: "v2",
        from: 5,
        to: 8,
        severity: "high",
        category: "politics",
        source: "section",
        message: "",
      },
    ]);
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation--word").length).toBeGreaterThanOrEqual(1);
    expect(dom.querySelectorAll(".review-violation--section").length).toBeGreaterThanOrEqual(1);
  });
});
