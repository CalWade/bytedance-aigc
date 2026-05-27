"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import type { JSONContent } from "@tiptap/react";

interface TiptapBodyProps {
  initial: JSONContent;
  onChange: (json: JSONContent) => void;
}

export function TiptapBody({ initial, onChange }: TiptapBodyProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initial,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) {
    return <div className="text-sm text-zinc-500">编辑器加载中…</div>;
  }

  const btnClass =
    "px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900";
  const activeClass = "bg-zinc-200 dark:bg-zinc-800";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("heading", { level: 1 }) ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </button>
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("heading", { level: 2 }) ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("bold") ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("italic") ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("bulletList") ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          type="button"
          className={`${btnClass} ${editor.isActive("orderedList") ? activeClass : ""}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>
      </div>
      <EditorContent
        editor={editor}
        className="min-h-[60vh] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 prose prose-sm dark:prose-invert max-w-none focus:outline-none"
      />
    </div>
  );
}
