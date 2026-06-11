"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import type { JSONContent } from "@tiptap/react";

import { computeChanges, type DiffRange } from "@/lib/diff";

// 与 TiptapBody 保持一致的扩展列表,确保 schema 包含 image 等自定义节点
const DIFF_EXTENSIONS = [StarterKit, Image.configure({ inline: false })];

const HIGHLIGHT_KEY = new PluginKey("version-diff-highlight");

/**
 * 给只读 editor 套一个 Decoration 插件:把传入的 ranges 转成 inline decoration class。
 * 用 inline 而非 widget,因为我们就是要给已有文本节点加 className,不插新元素。
 */
function buildHighlightExt(ranges: DiffRange[], className: string): Extension {
  return Extension.create({
    name: "version-diff-highlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: HIGHLIGHT_KEY,
          props: {
            decorations: (state) => {
              const decos = ranges
                .filter((r) => r.from < r.to && r.to <= state.doc.content.size + 1)
                .map((r) => Decoration.inline(r.from, r.to, { class: className }));
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
}

interface ReadOnlyDiffEditorProps {
  doc: JSONContent;
  ranges: DiffRange[];
  highlightClass: string;
}

function ReadOnlyDiffEditor({ doc, ranges, highlightClass }: ReadOnlyDiffEditorProps) {
  // 把 doc 内容也编入 key,确保切换版本时 editor 完全重建(否则 useEditor 不会更新 content)。
  const key = useMemo(
    () =>
      `${highlightClass}:${ranges.length}:${ranges.map((r) => `${r.from}-${r.to}`).join(",")}:${JSON.stringify(doc)}`,
    [ranges, highlightClass, doc],
  );
  const ext = useMemo(() => buildHighlightExt(ranges, highlightClass), [ranges, highlightClass]);

  const editor = useEditor(
    {
      extensions: [...DIFF_EXTENSIONS, ext],
      content: doc,
      editable: false,
      immediatelyRender: false,
    },
    [key],
  );

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return <div className="text-xs text-zinc-500">加载中…</div>;

  return (
    <EditorContent
      editor={editor}
      className="prose prose-sm dark:prose-invert max-w-none focus:outline-none"
    />
  );
}

interface VersionDiffProps {
  /** 旧版本(选中的历史版本)— 渲染在左栏 */
  oldDoc: JSONContent;
  /** 新版本(草稿当前内容)— 渲染在右栏 */
  newDoc: JSONContent;
}

export function VersionDiff({ oldDoc, newDoc }: VersionDiffProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // diff 计算不再依赖 PMNode.fromJSON,直接遍历 JSONContent 树提取文本,避免 prosemirror-model 多实例问题。
  const { deletions, insertions, error } = useMemo(() => {
    try {
      const r = computeChanges(oldDoc, newDoc);
      return { deletions: r.deletions, insertions: r.insertions, error: null as string | null };
    } catch (err) {
      return {
        deletions: [],
        insertions: [],
        error: err instanceof Error ? err.message : "diff 失败",
      };
    }
  }, [oldDoc, newDoc]);

  // 滚动同步:左栏滚 → 右栏跟。简单 scrollTop 镜像,长文可能高度不齐(留 backlog)。
  function onScrollSync(
    e: React.UIEvent<HTMLDivElement>,
    target: React.RefObject<HTMLDivElement | null>,
  ) {
    if (target.current) target.current.scrollTop = e.currentTarget.scrollTop;
  }

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
        diff 渲染失败: {error}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div
        ref={leftRef}
        onScroll={(e) => onScrollSync(e, rightRef)}
        className="overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3"
      >
        <div className="mb-2 text-xs font-medium text-zinc-500">旧版本</div>
        <ReadOnlyDiffEditor
          doc={oldDoc}
          ranges={deletions}
          highlightClass="bg-red-100 dark:bg-red-900/40 line-through"
        />
      </div>
      <div
        ref={rightRef}
        onScroll={(e) => onScrollSync(e, leftRef)}
        className="overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3"
      >
        <div className="mb-2 text-xs font-medium text-zinc-500">当前版本</div>
        <ReadOnlyDiffEditor
          doc={newDoc}
          ranges={insertions}
          highlightClass="bg-green-100 dark:bg-green-900/40"
        />
      </div>
    </div>
  );
}
