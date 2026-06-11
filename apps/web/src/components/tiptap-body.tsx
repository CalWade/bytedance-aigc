"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef } from "react";
import type { Editor, JSONContent } from "@tiptap/react";

import { ReviewDecorationsExt } from "@/lib/tiptap/review-decorations";
import { useSensitiveScan } from "@/hooks/use-sensitive-scan";

interface TiptapBodyProps {
  initial: JSONContent;
  onChange: (json: JSONContent) => void;
  /** 把 editor 实例上提给父组件用于 BubbleMenu / SectionStream / 工具卡接入。 */
  onReady?: (editor: Editor | null) => void;
}

export function TiptapBody({ initial, onChange, onReady }: TiptapBodyProps) {
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: "开始写作…" }),
      ReviewDecorationsExt,
    ],
    content: initial,
    immediatelyRender: false,
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
    return <div className="text-[14px] text-muted-foreground py-8 text-center">编辑器加载中…</div>;
  }

  return <EditorContent editor={editor} className="flex-1 focus:outline-none" />;
}
