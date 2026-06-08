import { describe, it, expect, vi } from "vitest";
import { getSnapshot, putSnapshot, clearSnapshot } from "./idb-draft-cache";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    createStore: vi.fn(() => "store"),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    get: vi.fn(async (k: string) => store.get(k)),
    del: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

describe("idb-draft-cache", () => {
  it("put → get round-trip", async () => {
    await putSnapshot("d1", {
      title: "T",
      body: { type: "doc" },
      baseVersion: 3,
      localUpdatedAt: 100,
    });
    const got = await getSnapshot("d1");
    expect(got).toEqual({
      title: "T",
      body: { type: "doc" },
      baseVersion: 3,
      localUpdatedAt: 100,
    });
  });

  it("clear → get 返 undefined", async () => {
    await putSnapshot("d1", { title: "", body: {}, baseVersion: 1, localUpdatedAt: 0 });
    await clearSnapshot("d1");
    const got = await getSnapshot("d1");
    expect(got).toBeUndefined();
  });
});
