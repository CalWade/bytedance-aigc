"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { OutlineItem } from "@bytedance-aigc/shared";

import { useSectionReview } from "@/hooks/use-section-review";
import { useRegenerateSection } from "@/hooks/use-section-regenerate";
import { useStreamingGeneration } from "@/hooks/use-streaming-generation";

import { SectionReviewCard } from "./SectionReviewCard";

interface SectionStreamProps {
  editor: Editor | null;
  draftId: string;
  sections: OutlineItem[];
  onComplete: () => void;
  onError: (msg: string) => void;
  setStreaming: (on: boolean) => void;
  flush: () => Promise<void>;
}

/**
 * 把 SSE 流式生成的 token 写到 TipTap editor。
 * 帧序:section.start → token×N → section.end → ... → done。
 *
 * autosave 协调:
 *   - 流前 await flush() + setStreaming(true) → 期间不发 PATCH
 *   - 流末 setStreaming(false) → 调用方在 onComplete 中 flush()
 *
 * 流期间 editable=false,防止用户在 token 写入时改光标。
 */
export function SectionStream({
  editor,
  draftId,
  sections,
  onComplete,
  onError,
  setStreaming,
  flush,
}: SectionStreamProps) {
  const { status, start, stop } = useStreamingGeneration();
  const startedRef = useRef(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const review = useSectionReview(editor);
  const regen = useRegenerateSection(draftId);
  const [sessionId] = useState(
    () => `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  useEffect(() => {
    if (!editor || startedRef.current) return;
    startedRef.current = true;

    const sectionEnds: number[] = []; // editor.state.doc 末尾位置缓存,token 插入点

    void (async () => {
      await flush();
      setStreaming(true);
      editor.setEditable(false);

      try {
        await start(draftId, sections, {
          onSectionStart: ({ heading }) => {
            editor
              .chain()
              .focus("end")
              .insertContent([
                {
                  type: "heading",
                  attrs: { level: 2 },
                  content: [{ type: "text", text: heading }],
                },
                { type: "paragraph" },
              ])
              .run();
            sectionEnds.push(editor.state.doc.content.size);
          },
          onToken: ({ delta }) => {
            editor.chain().focus("end").insertContent(delta).run();
          },
          onSectionEnd: ({ index }) => {
            // 段落落地,记录 range 并 fire-and-forget 审核
            const to = editor.state.doc.content.size;
            const from = sectionEnds.length > 0 ? sectionEnds[sectionEnds.length - 1] : 0;
            const text = editor.state.doc.textBetween(from, to, "\n");
            const heading = sections[index]?.heading ?? "";
            void review
              .reviewSection({
                draftId,
                sessionId,
                heading,
                range: { from, to },
                text,
              })
              .then((result) => {
                if (result?.abortStream) {
                  setErrMsg("连续多段命中风险,已中断生成");
                  stop();
                }
              });
            editor.chain().focus("end").insertContent({ type: "paragraph" }).run();
          },
          onDone: () => {
            // status 在 hook 内已置 done
          },
          onError: ({ message }) => {
            setErrMsg(message);
            onError(message);
          },
        });
      } finally {
        editor.setEditable(true);
        setStreaming(false);
        await flush().catch(() => {});
        onComplete();
      }
    })();

    return () => {
      stop();
    };
    // editor / draftId / sections 在父组件内一旦传入即固定;依赖刻意省略让 effect 只跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="text-sm text-zinc-600 dark:text-zinc-400">
      {status === "streaming" && <span>正在生成正文…</span>}
      {status === "done" && <span className="text-emerald-600">生成完成</span>}
      {status === "error" && <span className="text-red-600">生成失败:{errMsg ?? "unknown"}</span>}
      {status === "streaming" && (
        <button
          type="button"
          onClick={stop}
          className="ml-2 text-xs underline text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          停止
        </button>
      )}
      {review.items.map((item, idx) => (
        <SectionReviewCard
          key={`${item.range.from}-${item.range.to}-${idx}`}
          item={item}
          draftId={draftId}
          text={editor?.state.doc.textBetween(item.range.from, item.range.to, "\n") ?? ""}
          onRegenerate={async (heading) => {
            if (!editor) return;
            try {
              const newText = await regen.regenerate(heading, sections);
              editor
                .chain()
                .focus()
                .setTextSelection({ from: item.range.from, to: item.range.to })
                .insertContent(newText)
                .run();
              review.dismiss(heading);
            } catch (e) {
              setErrMsg(e instanceof Error ? e.message : "重新生成失败");
            }
          }}
          onApplySuggestion={(heading, suggestion) => {
            if (!editor) return;
            editor
              .chain()
              .focus()
              .setTextSelection({ from: item.range.from, to: item.range.to })
              .insertContent(suggestion)
              .run();
            review.dismiss(heading);
          }}
          onKeep={(heading) => review.dismiss(heading)}
        />
      ))}
    </div>
  );
}
