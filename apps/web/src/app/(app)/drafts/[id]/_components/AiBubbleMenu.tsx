"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { DraftToolType } from "@bytedance-aigc/shared";

interface AiBubbleMenuProps {
  editor: Editor | null;
  onInvoke: (tool: DraftToolType, payload: { selectedText: string; fullText: string }) => void;
}

interface ToolBtn {
  tool: DraftToolType;
  label: string;
}

const GROUPS: { name: string; tools: ToolBtn[] }[] = [
  {
    name: "改写",
    tools: [
      { tool: "REWRITE_FLUENT", label: "通顺" },
      { tool: "EXPAND", label: "扩写" },
      { tool: "TRANSFORM_STYLE", label: "改风格" },
      { tool: "REWRITE_OPENING", label: "重写开头" },
    ],
  },
  {
    name: "标题",
    tools: [
      { tool: "HEADLINE_SUB", label: "副标题" },
      { tool: "HEADLINE_NEW", label: "主标题" },
    ],
  },
  {
    name: "扩展",
    tools: [
      { tool: "ADD_FACTS", label: "补事实" },
      { tool: "ADD_TOPIC", label: "扩话题" },
      { tool: "IMAGE_SUGGEST", label: "配图" },
    ],
  },
];

/**
 * 选中文本时浮现的 AI 工具菜单。本组件不引入 @tiptap/extension-bubble-menu
 * 的 React 包装,直接通过 selectionUpdate 事件维护一个 fixed 浮层 — 既能
 * 访问当前 selection(selectedText)又能拿到 editor.getText()(fullText)。
 */
export function AiBubbleMenu({ editor, onInvoke }: AiBubbleMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    if (!editor) return;
    const update = (): void => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setPos(null);
        setSelectedText("");
        return;
      }
      const text = editor.state.doc.textBetween(from, to, "\n");
      setSelectedText(text);
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setPos({
          top: Math.min(start.top, end.top) - 44 + window.scrollY,
          left: (start.left + end.left) / 2 + window.scrollX,
        });
      } catch {
        setPos(null);
      }
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", () => setPos(null));
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  if (!editor || !pos || !selectedText) return null;

  const fullText = editor.getText();

  return (
    <div
      className="fixed z-30 -translate-x-1/2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg p-1.5 flex items-center gap-1.5"
      style={{ top: pos.top, left: pos.left }}
    >
      {GROUPS.map((g, gi) => (
        <Group key={g.name} divider={gi > 0}>
          {g.tools.map((t) => (
            <button
              key={t.tool}
              type="button"
              onClick={() => onInvoke(t.tool, { selectedText, fullText })}
              className="px-2 py-1 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {t.label}
            </button>
          ))}
        </Group>
      ))}
    </div>
  );
}

function Group({ divider, children }: { divider: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {divider && <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />}
      {children}
    </div>
  );
}
