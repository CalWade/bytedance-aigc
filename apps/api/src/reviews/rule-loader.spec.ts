import { buildPromptHints, loadRules, RULE_CATEGORIES } from "./rule-loader";

describe("rule-loader", () => {
  it("加载 7 类目 yaml,每类至少 1 条规则", () => {
    const rules = loadRules();
    for (const cat of RULE_CATEGORIES) {
      expect(rules.get(cat)?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("每条规则必有 rule_id / category / severity / prompt_hint", () => {
    const rules = loadRules();
    for (const cat of RULE_CATEGORIES) {
      for (const r of rules.get(cat) ?? []) {
        expect(r.rule_id).toMatch(/^SEC-[A-Z]+-\d+$/);
        expect(r.category).toBe(cat);
        expect(["low", "medium", "high"]).toContain(r.severity);
        expect(typeof r.prompt_hint).toBe("string");
        expect(r.prompt_hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("buildPromptHints 拼装所有 active 规则的 prompt_hint,按 category 分组", () => {
    const hints = buildPromptHints();
    expect(hints).toContain("politics");
    expect(hints).toContain("pornography");
    expect(hints.length).toBeGreaterThan(100);
  });
});
