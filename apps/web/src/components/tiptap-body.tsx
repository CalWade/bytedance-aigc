"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";

import { ReviewDecorationsExt } from "@/lib/tiptap/review-decorations";
import { useSensitiveScan } from "@/hooks/use-sensitive-scan";
import { uploadImage } from "@/lib/upload-image";

interface TiptapBodyProps {
  initial: JSONContent;
  onChange: (json: JSONContent) => void;
  /** 把 editor 实例上提给父组件用于 BubbleMenu / SectionStream / 工具卡接入。 */
  onReady?: (editor: Editor | null) => void;
}

export function TiptapBody({ initial, onChange, onReady }: TiptapBodyProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // editor 引用要给 handleDrop / handlePaste 闭包看到,但 useEditor 在同一调用里又要读 editorProps,
  // 所以走 ref 中转:editorProps 内通过 ref.current 拿当前 editor。
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const insertUploadedImage = useCallback(async (file: File, ed: Editor): Promise<void> => {
    setUploadError(null);
    setUploading(true);
    try {
      const { url } = await uploadImage(file);
      ed.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, []);

  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ inline: false }), ReviewDecorationsExt],
    content: initial,
    immediatelyRender: false,
    editorProps: {
      handleDrop: (_view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        const file = dt?.files?.[0];
        if (!file || !file.type.startsWith("image/")) return false;
        event.preventDefault();
        const ed = editorRef.current;
        if (ed) void insertUploadedImage(file, ed);
        return true;
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const it of Array.from(items)) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const file = it.getAsFile();
            if (!file) continue;
            event.preventDefault();
            const ed = editorRef.current;
            if (ed) void insertUploadedImage(file, ed);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    onReady?.(editor);
  }, [editor, onReady]);

  useSensitiveScan(editor);

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
        <button
          type="button"
          className={btnClass}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "上传中…" : "图片"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertUploadedImage(f, editor);
            e.target.value = "";
          }}
        />
      </div>
      {uploadError && <div className="text-xs text-red-600">{uploadError}</div>}
      <EditorContent
        editor={editor}
        className="min-h-[60vh] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 prose prose-sm dark:prose-invert max-w-none focus:outline-none"
      />
    </div>
  );
}
