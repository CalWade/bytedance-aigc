/**
 * 草稿版本 diff:基于 fast-diff 做纯文本比对,
 * 再把文本偏移映射回 ProseMirror 文档坐标。
 *
 * 不使用 PMNode.fromJSON / Schema,直接遍历 JSONContent 树提取文本,
 * 彻底绕开 pnpm 隔离导致的 "multiple versions of prosemirror-model" 问题。
 */
import diff from "fast-diff";
import type { JSONContent } from "@tiptap/react";

export type DiffRange = { from: number; to: number };

export type DiffResult = {
  /** 旧文档坐标系下的删除范围(用于左栏红色删除线) */
  deletions: DiffRange[];
  /** 新文档坐标系下的新增范围(用于右栏绿色高亮) */
  insertions: DiffRange[];
};

/**
 * 从 ProseMirror JSONContent 树中提取文本 + 文档位置映射。
 * 手动模拟 ProseMirror 的文档位置计数:
 * - 每个节点开标签占 1 个位置
 * - 文本节点内的每个字符占 1 个位置
 * - 每个节点闭标签占 1 个位置(仅对有 content 的非叶子节点)
 */
function extractTextWithPositions(doc: JSONContent): {
  text: string;
  /** charIndex → docPos 映射,长度 = text.length + 1(末尾哨兵) */
  posMap: Uint32Array;
} {
  const chars: string[] = [];
  const positions: number[] = [];
  let needNewline = false;

  function walk(node: JSONContent, pos: number): number {
    // 块级节点前插入换行,确保 diff 不跨块匹配
    if (isBlockNode(node)) {
      if (needNewline) {
        chars.push("\n");
        positions.push(pos);
      }
      needNewline = true;
    }

    // 进入节点开标签:pos + 1
    let cur = pos + 1;

    if (node.content) {
      for (const child of node.content) {
        cur = walk(child, cur);
      }
    }

    if (node.type === "text" && typeof node.text === "string") {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i]);
        positions.push(cur + i);
      }
      cur += node.text.length;
    }

    // 闭标签:cur + 1 (仅含 content 的非叶子节点)
    if (node.content) {
      cur += 1;
    }

    return cur;
  }

  walk(doc, 0);

  const text = chars.join("");
  const posMap = new Uint32Array(text.length + 1);
  for (let i = 0; i < positions.length; i++) {
    posMap[i] = positions[i];
  }
  // 哨兵:文本末尾对应文档末尾(取最后一个位置 +1 即大致文档结束位)
  posMap[text.length] = positions.length > 0 ? positions[positions.length - 1] + 1 : 1;

  return { text, posMap };
}

const BLOCK_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "image",
]);

function isBlockNode(node: JSONContent): boolean {
  return !!node.type && BLOCK_TYPES.has(node.type);
}

export function computeChanges(
  oldDoc: JSONContent,
  newDoc: JSONContent,
  _schema?: unknown,
): DiffResult {
  const oldText = extractTextWithPositions(oldDoc);
  const newText = extractTextWithPositions(newDoc);

  // fast-diff 返回 [operation, text] 数组:
  // operation: -1 = 删除, 1 = 插入, 0 = 相同
  const deltas = diff(oldText.text, newText.text);

  const deletions: DiffRange[] = [];
  const insertions: DiffRange[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  for (const [op, text] of deltas) {
    const len = text.length;

    if (op === -1) {
      const from = oldText.posMap[oldIdx];
      const to = oldText.posMap[oldIdx + len];
      deletions.push({ from, to });
      oldIdx += len;
    } else if (op === 1) {
      const from = newText.posMap[newIdx];
      const to = newText.posMap[newIdx + len];
      insertions.push({ from, to });
      newIdx += len;
    } else {
      oldIdx += len;
      newIdx += len;
    }
  }

  return {
    deletions: mergeRanges(deletions),
    insertions: mergeRanges(insertions),
  };
}

function mergeRanges(ranges: DiffRange[]): DiffRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: DiffRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.from <= last.to) {
      last.to = Math.max(last.to, cur.to);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}
