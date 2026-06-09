import { describe, it, expect } from "vitest";
import { handleScanRequest } from "./sensitive-scanner.worker";
import type { SensitiveWordList } from "@bytedance-aigc/shared";

const wordList: SensitiveWordList = {
  version: "test",
  categories: {
    pornography: { severity: "high", words: ["敏感词"] },
    gambling: { severity: "high", words: [] },
    abuse: { severity: "medium", words: ["俗话"] },
    fraud: { severity: "medium", words: ["秒到账"] },
    illicit_ads: { severity: "medium", words: [] },
  },
};

describe("sensitive-scanner.worker (logic)", () => {
  it("空文本 → hits 空", () => {
    const res = handleScanRequest(wordList, { id: "r1", text: "" });
    expect(res).toEqual({ id: "r1", hits: [] });
  });

  it("命中涉黄高危 + 词库 fraud 中危,各返 1 hit", () => {
    const res = handleScanRequest(wordList, { id: "r2", text: "前缀敏感词后,有秒到账提示" });
    expect(res.id).toBe("r2");
    expect(res.hits).toHaveLength(2);
    const cats = res.hits.map((h) => h.category).sort();
    expect(cats).toEqual(["fraud", "pornography"]);
  });

  it("命中 hits 含 from/to/severity", () => {
    const res = handleScanRequest(wordList, { id: "r3", text: "敏感词" });
    expect(res.hits[0]).toMatchObject({
      from: 0,
      to: 3,
      word: "敏感词",
      category: "pornography",
      severity: "high",
    });
  });
});
