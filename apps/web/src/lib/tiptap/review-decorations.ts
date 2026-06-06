import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface Violation {
  id: string;
  from: number;
  to: number;
  severity: "low" | "medium" | "high";
  category: string;
  source: "word" | "section";
  message: string;
}

interface PluginState {
  word: Violation[];
  section: Violation[];
}

const META_KEY = "review/setViolations";
const pluginKey = new PluginKey<PluginState>("reviewDecorations");

interface SetMeta {
  source: "word" | "section";
  violations: Violation[];
}

export const ReviewDecorationsExt = Extension.create({
  name: "reviewDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: pluginKey,
        state: {
          init: () => ({ word: [], section: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(META_KEY) as SetMeta | undefined;
            if (!meta) return prev;
            return {
              ...prev,
              [meta.source]: meta.violations,
            };
          },
        },
        props: {
          decorations(editorState) {
            const ps = pluginKey.getState(editorState);
            if (!ps) return DecorationSet.empty;
            const decos: Decoration[] = [];
            for (const v of [...ps.word, ...ps.section]) {
              if (v.from >= v.to) continue;
              if (v.from < 0 || v.to > editorState.doc.content.size) continue;
              decos.push(
                Decoration.inline(v.from, v.to, {
                  class: `review-violation review-violation--${v.severity} review-violation--${v.source}`,
                  "data-review-id": v.id,
                  "data-review-message": v.message,
                  "data-review-category": v.category,
                }),
              );
            }
            return DecorationSet.create(editorState.doc, decos);
          },
        },
      }),
    ];
  },
});

/** 通过 transaction meta 派发 violations 更新。 */
export function dispatchSetViolations(
  editor: Editor,
  source: "word" | "section",
  violations: Violation[],
): void {
  const tr = editor.state.tr.setMeta(META_KEY, { source, violations } satisfies SetMeta);
  editor.view.dispatch(tr);
}
