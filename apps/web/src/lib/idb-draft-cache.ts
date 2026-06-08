import { createStore, get, set, del } from "idb-keyval";
import type { JSONContent } from "@tiptap/react";

export interface DraftSnapshot {
  title: string;
  body: JSONContent;
  baseVersion: number;
  localUpdatedAt: number;
}

const STORE = createStore("bytedance-aigc-drafts", "snapshots");

const k = (id: string) => `draft:${id}`;

export async function getSnapshot(id: string): Promise<DraftSnapshot | undefined> {
  return get<DraftSnapshot>(k(id), STORE);
}

export async function putSnapshot(id: string, snap: DraftSnapshot): Promise<void> {
  await set(k(id), snap, STORE);
}

export async function clearSnapshot(id: string): Promise<void> {
  await del(k(id), STORE);
}
