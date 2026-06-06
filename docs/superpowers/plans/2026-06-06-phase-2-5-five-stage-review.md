# Phase 2.5 5 阶段审核(前 3 阶段)+ 规则库 + 准确率验证 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PDF 三阶段审核 ① Prompt / ② 输入 / ③ 生成中(各对应 LLM、Web Worker 词库扫描、LLM 段落审)从 spec 落到 18 个 task,接入既存 FastModeDialog / TiptapBody / SectionStream,并交付 ≥ 90% 准确率报告。

**Architecture:** 后端 `ReviewService` 重构出 `runReviewLLM` + `buildSafetyMessages`,加 `reviewPrompt` / `reviewSection` 两条入口 + 内存级 `streamSession` 计数;前端用 `new Worker(new URL(...))` 启 Aho-Corasick 词扫,`review-decoration` ProseMirror 插件统一管违规标记;规则库以 7 个 yaml 文件 + 静态 JSON 词库形态入仓,300 条标注集 + `eval-safety` 脚本生成 markdown 报告。

**Tech Stack:** NestJS 11 / Prisma 5 / TipTap 3 + ProseMirror / Next.js 16 App Router / Web Worker / Aho-Corasick(自写)/ js-yaml 4 / vitest 4 / Jest 30.

**Spec:** [docs/superpowers/specs/2026-06-06-phase-2-5-five-stage-review-design.md](../specs/2026-06-06-phase-2-5-five-stage-review-design.md)

---

## 全局约定

**目录速查:**

- 后端 reviews 模块:`apps/api/src/reviews/{review.service.ts, reviews.controller.ts, reviews.module.ts, review.service.spec.ts}`
- 后端 e2e:`apps/api/test/<name>.e2e-spec.ts`(Phase 2.3 用 `preflight-review.e2e-spec.ts` / `publish.e2e-spec.ts` 平铺命名)
- 前端 hooks:`apps/web/src/hooks/use-*.ts`
- 前端 lib:`apps/web/src/lib/`
- 前端组件:`apps/web/src/app/drafts/[id]/_components/`
- 前端 Worker:`apps/web/src/workers/`
- 共享:`packages/shared/src/`(已 export `draft-tools` / `review` / `post` / `ranking`)

**commit 规范(项目自定义):**

- 英文骨架 + 中文描述,Conventional Commits(`feat(api):` / `feat(web):` / `chore:` / `docs:` / `test:`)
- body line ≤ 100 字符(commitlint 硬限制)
- **不**带 `Co-Authored-By Claude` 尾注

**每条命令 expected**:除非显式标注,默认 `exit 0`。

---

## Task 1: schema 扩 + migration + fixtures seed

**Files:**

- Modify: `apps/api/prisma/schema.prisma:30-33`(`ReviewStage` enum 加 2 值)
- Modify: `apps/api/prisma/schema.prisma:41-53`(`DraftToolType` enum 加 2 值)
- Create: `apps/api/prisma/migrations/<timestamp>_phase25_review_stages/migration.sql`
- Modify: `apps/api/prisma/fixtures/prompts.ts`(append 2 条 PLATFORM Prompt)

- [ ] **Step 1: 编辑 schema.prisma `ReviewStage` enum**

修改 `apps/api/prisma/schema.prisma` 第 30-33 行:

```prisma
enum ReviewStage {
  PREFLIGHT
  PROMPT_INPUT
  SECTION_INLINE
  POST_PUBLISH
}
```

- [ ] **Step 2: 编辑 schema.prisma `DraftToolType` enum**

修改 `apps/api/prisma/schema.prisma` 第 41-53 行,在 `QUALITY_REVIEW` 后新增 2 个值:

```prisma
enum DraftToolType {
  REWRITE_FLUENT
  EXPAND
  TRANSFORM_STYLE
  HEADLINE_SUB
  HEADLINE_NEW
  REWRITE_OPENING
  ADD_FACTS
  ADD_TOPIC
  IMAGE_SUGGEST
  SAFETY_REVIEW
  QUALITY_REVIEW
  PROMPT_REVIEW
  SECTION_REVIEW
}
```

- [ ] **Step 3: 生成 migration**

```bash
cd apps/api
pnpm exec prisma migrate dev --name phase25_review_stages --create-only
```

预期:在 `apps/api/prisma/migrations/<timestamp>_phase25_review_stages/migration.sql` 生成只含 `ALTER TYPE ... ADD VALUE` 的 SQL,无表结构变更。检查文件内容,应只有 4 条 `ALTER TYPE` 语句(2 条 ReviewStage + 2 条 DraftToolType)。

- [ ] **Step 4: 跑 migration**

```bash
cd apps/api
pnpm exec prisma migrate dev --name phase25_review_stages
pnpm exec prisma generate
```

预期:`Database is now in sync with your schema`,Prisma Client 重生。

- [ ] **Step 5: fixtures 加 2 条 PLATFORM Prompt**

在 `apps/api/prisma/fixtures/prompts.ts` 的 `PROMPT_STARTERS` 数组末尾(`QUALITY_REVIEW` 条目后)追加:

```typescript
  {
    owner: "PLATFORM",
    tool: "PROMPT_REVIEW",
    name: "默认·选题/提示词风险审核",
    systemPrompt: `你是平台合规审核员。请评估作者输入的"选题 + 提示词"是否存在违规导向风险,覆盖 7 类目:涉政(politics)、涉黄(pornography)、涉赌(gambling)、涉毒(drugs)、低俗(vulgarity)、欺诈(fraud)、医疗(medical)。

严格输出 JSON,无任何前后文:
{
  "dimensions": [
    {"key":"politics","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"pornography","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"gambling","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"drugs","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"vulgarity","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"fraud","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"medical","score":0,"severity":"low","hits":[],"reason":"无命中"}
  ]
}

字段约束:
- score: 0-100 整数
- severity: score≥70 high;30-69 medium;否则 low
- hits: 命中片段数组,每条 ≤ 30 字
- reason: 1 句中文`,
    params: { temperature: 0.0, topP: 0.9, maxTokens: 800 },
    fewShots: [],
    designNote: "Phase 2.5 ① Prompt 阶段;前端拼接 topic+\\n+hint 作为 user message;7 类目对齐规则库 yaml。",
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "SECTION_REVIEW",
    name: "默认·生成中段落审核",
    systemPrompt: `你是平台合规审核员。请评估给定段落是否包含违规内容,覆盖 7 类目(politics/pornography/gambling/drugs/vulgarity/fraud/medical)。

严格输出 JSON,无任何前后文:
{
  "dimensions": [
    {"key":"politics","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"pornography","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"gambling","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"drugs","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"vulgarity","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"fraud","score":0,"severity":"low","hits":[],"reason":"无命中"},
    {"key":"medical","score":0,"severity":"low","hits":[],"reason":"无命中"}
  ]
}`,
    params: { temperature: 0.0, topP: 0.9, maxTokens: 800 },
    fewShots: [],
    designNote: "Phase 2.5 ③ 段落审核;由 SectionStream onSectionEnd 触发;同 7 类目。",
    isStarter: true,
  },
```

- [ ] **Step 6: 重 seed 验证 fixtures**

```bash
cd apps/api
pnpm exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

预期:输出 `prompts: 13`(原 11 + 新增 2)。

- [ ] **Step 7: typecheck**

```bash
pnpm --filter @bytedance-aigc/api typecheck
```

预期:0 错误(此时还未引用新 enum 值的 TS 代码,但 Prisma Client 已含新类型)。

- [ ] **Step 8: commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/fixtures/prompts.ts
git commit -m "feat(api): 扩 ReviewStage/DraftToolType enum + seed PROMPT/SECTION_REVIEW Prompt

Phase 2.5 T1: ReviewStage 加 PROMPT_INPUT/SECTION_INLINE,DraftToolType
加 PROMPT_REVIEW/SECTION_REVIEW;migration 仅 ADD VALUE 无表结构变更;
fixtures 增 2 条 PLATFORM Prompt 给 ① ③ 阶段消费。"
```

---

## Task 2: shared 类型扩 + 新增 Response 类型

**Files:**

- Modify: `packages/shared/src/review.ts:60-68`(`ReviewDto.stage` 字面量扩到 4 个值)
- Modify: `packages/shared/src/review.ts`(末尾追加 `PromptReviewResponse` / `SectionReviewResponse` / `SensitiveCategory`)

- [ ] **Step 1: 改 `ReviewDto.stage` 字面量**

`packages/shared/src/review.ts` 第 60-68 行:

```typescript
export interface ReviewDto {
  id: string;
  stage: "PREFLIGHT" | "PROMPT_INPUT" | "SECTION_INLINE" | "POST_PUBLISH";
  safety: ReviewSafety;
  quality: ReviewQuality;
  recommendation: Recommendation;
  modelMeta?: ReviewModelMeta | null;
  createdAt: string;
}
```

- [ ] **Step 2: 末尾追加 Phase 2.5 类型**

在 `packages/shared/src/review.ts` 末尾(第 73 行 `}` 后)追加:

```typescript
/**
 * Phase 2.5 — 7 类目敏感词分类(规则库 yaml + sensitive-words.json 共用)
 */
export const SENSITIVE_CATEGORIES = [
  "politics",
  "pornography",
  "gambling",
  "drugs",
  "vulgarity",
  "fraud",
  "medical",
] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

/**
 * Phase 2.5 ① Prompt 阶段审核响应
 * 端点:POST /reviews/prompt
 */
export interface PromptReviewResponse {
  recommendation: Recommendation;
  hitCategories: SensitiveCategory[];
  message: string;
  reviewId: string;
}

/**
 * Phase 2.5 ③ 段落审核响应
 * 端点:POST /reviews/section
 * abortStream: 同 sessionId 内连续 ≥ 3 段 high → true,前端 stop SectionStream
 */
export interface SectionReviewResponse {
  recommendation: Recommendation;
  hitCategories: SensitiveCategory[];
  severity: Severity;
  message: string;
  abortStream: boolean;
  reviewId: string;
}
```

- [ ] **Step 3: 跑全仓 typecheck 找出 stage 字面量收紧的 fallout**

```bash
pnpm typecheck
```

预期:0 错误(Phase 2.3 现有代码用 `r.stage` 直读 Prisma enum string,联合扩集不会破坏既有用例)。如有错,通常是 e2e mock 的 stage 字段写死 `"PREFLIGHT"` —— 那本来就在新联合内,无需改。

- [ ] **Step 4: commit**

```bash
git add packages/shared/src/review.ts
git commit -m "feat(shared): 扩 ReviewDto.stage 字面量 + 加 Phase 2.5 响应类型

- ReviewDto.stage 联合加 PROMPT_INPUT / SECTION_INLINE
- 新增 SENSITIVE_CATEGORIES 7 类目 + SensitiveCategory 类型
- 新增 PromptReviewResponse / SectionReviewResponse"
```

---

## Task 3: rule-loader + yaml 7 个文件骨架

**Files:**

- Create: `packages/shared/rules/{politics,pornography,gambling,drugs,vulgarity,fraud,medical}.yaml`(7 个骨架文件)
- Create: `apps/api/src/reviews/rule-loader.ts`(yaml 加载 + 类型 + 缓存)
- Create: `apps/api/src/reviews/rule-loader.spec.ts`
- Modify: `apps/api/package.json`(加 `js-yaml` 依赖)

- [ ] **Step 1: 装 js-yaml**

```bash
pnpm --filter @bytedance-aigc/api add js-yaml@^4.1.0
pnpm --filter @bytedance-aigc/api add -D @types/js-yaml@^4.0.9
```

预期:`apps/api/package.json` 多 2 个依赖,pnpm 重生 lock。

- [ ] **Step 2: 建 7 个 yaml 骨架(每文件先放 1 条占位规则,Task 14 再填全)**

`packages/shared/rules/politics.yaml`:

```yaml
- rule_id: SEC-POLITICS-001
  category: politics
  severity: high
  description: 对国家领导人的负面评价或调侃
  prompt_hint: |
    若文本包含对国家领导人的人身攻击、负面评价、调侃、影射,判 high。
  examples_positive:
    - "(占位:Task 14 填具体样本)"
  examples_negative:
    - "国家领导人出访某国进行国事访问。"
```

`packages/shared/rules/pornography.yaml`:

```yaml
- rule_id: SEC-PORN-001
  category: pornography
  severity: high
  description: 露骨色情描写、性器官、性行为描写
  prompt_hint: |
    若文本含露骨色情描写、性器官、性行为细节,判 high;含暧昧或低俗暗示判 medium。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "婚礼现场新人深情对视。"
```

`packages/shared/rules/gambling.yaml`:

```yaml
- rule_id: SEC-GAMBLING-001
  category: gambling
  severity: high
  description: 推广赌博平台 / 教唆参与赌博
  prompt_hint: |
    若文本含赌博平台名称、赌博玩法教学、诱导下注,判 high;非法博彩相关词汇判 medium。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "央视报道东南亚电信诈骗与跨境赌博的关联。"
```

`packages/shared/rules/drugs.yaml`:

```yaml
- rule_id: SEC-DRUGS-001
  category: drugs
  severity: high
  description: 毒品名称推广 / 制毒方法
  prompt_hint: |
    若文本含毒品商品化描述、买卖渠道、合成方法,判 high。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "禁毒宣传周公益活动启动。"
```

`packages/shared/rules/vulgarity.yaml`:

```yaml
- rule_id: SEC-VULGAR-001
  category: vulgarity
  severity: medium
  description: 低俗语言、辱骂、人身攻击
  prompt_hint: |
    若文本含粗俗辱骂词、人身攻击、贬损群体的称呼,判 medium。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "(占位)"
```

`packages/shared/rules/fraud.yaml`:

```yaml
- rule_id: SEC-FRAUD-001
  category: fraud
  severity: medium
  description: 虚假宣传 / 引流诈骗
  prompt_hint: |
    若文本含虚假效果承诺(暴富/秒到账/包治百病)、留联系方式引流、未经核实数据,判 medium 或 high。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "市场监管局发布反诈宣传材料。"
```

`packages/shared/rules/medical.yaml`:

```yaml
- rule_id: SEC-MEDICAL-001
  category: medical
  severity: medium
  description: 未经验证的医疗建议 / 偏方推广
  prompt_hint: |
    若文本含具体疾病的"偏方/秘方/包治"叙述、诱导停药、夸大疗效,判 medium 或 high。
  examples_positive:
    - "(占位)"
  examples_negative:
    - "卫健委发布慢病管理指南。"
```

- [ ] **Step 3: 写 `rule-loader.ts`(先红测,TDD)**

先建 `apps/api/src/reviews/rule-loader.spec.ts`:

```typescript
import { loadRules, RULE_CATEGORIES } from "./rule-loader";

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
    const { buildPromptHints } = require("./rule-loader") as typeof import("./rule-loader");
    const hints = buildPromptHints();
    expect(hints).toContain("politics");
    expect(hints).toContain("pornography");
    expect(hints.length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 4: 跑测试,确认 FAIL(loader 还没写)**

```bash
pnpm --filter @bytedance-aigc/api test -- rule-loader
```

预期:`Cannot find module './rule-loader'`。

- [ ] **Step 5: 实现 `rule-loader.ts`**

`apps/api/src/reviews/rule-loader.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import type { SensitiveCategory } from "@bytedance-aigc/shared";
import { SENSITIVE_CATEGORIES } from "@bytedance-aigc/shared";

export const RULE_CATEGORIES = SENSITIVE_CATEGORIES;

export interface RuleEntry {
  rule_id: string;
  category: SensitiveCategory;
  severity: "low" | "medium" | "high";
  description: string;
  prompt_hint: string;
  examples_positive?: string[];
  examples_negative?: string[];
}

let cache: Map<SensitiveCategory, RuleEntry[]> | null = null;

/** WHY: 从 monorepo 根 packages/shared/rules/*.yaml 加载;启动时一次,内存缓存。 */
export function loadRules(): Map<SensitiveCategory, RuleEntry[]> {
  if (cache) return cache;
  const rulesDir = join(__dirname, "..", "..", "..", "..", "packages", "shared", "rules");
  const files = readdirSync(rulesDir).filter((f) => f.endsWith(".yaml"));
  const map = new Map<SensitiveCategory, RuleEntry[]>();
  for (const cat of RULE_CATEGORIES) map.set(cat, []);
  for (const file of files) {
    const text = readFileSync(join(rulesDir, file), "utf8");
    const parsed = yamlLoad(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`rule yaml ${file} 必须是数组,实际 ${typeof parsed}`);
    }
    for (const raw of parsed as unknown[]) {
      const r = raw as Partial<RuleEntry>;
      if (!r.rule_id || !r.category || !r.severity || !r.prompt_hint) {
        throw new Error(`rule yaml ${file} 缺必填字段: ${JSON.stringify(raw)}`);
      }
      if (!RULE_CATEGORIES.includes(r.category)) {
        throw new Error(`rule yaml ${file} category=${r.category} 不在 7 类目内`);
      }
      map.get(r.category)!.push(r as RuleEntry);
    }
  }
  cache = map;
  return cache;
}

/** WHY: review.service 的 system prompt 拼接段,一次性塞所有规则的 prompt_hint。 */
export function buildPromptHints(): string {
  const rules = loadRules();
  const lines: string[] = ["附加规则库提示(按类目):"];
  for (const cat of RULE_CATEGORIES) {
    const entries = rules.get(cat) ?? [];
    if (entries.length === 0) continue;
    lines.push(`\n[${cat}]`);
    for (const r of entries) {
      lines.push(`- ${r.prompt_hint.trim()}`);
    }
  }
  return lines.join("\n");
}

/** test-only: 重置缓存(让单测可在 CI 环境加载真实 yaml)。 */
export function __resetRuleCache(): void {
  cache = null;
}
```

- [ ] **Step 6: 跑测试,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/api test -- rule-loader
```

预期:3 条全绿。

- [ ] **Step 7: commit**

```bash
git add packages/shared/rules apps/api/src/reviews/rule-loader.ts apps/api/src/reviews/rule-loader.spec.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): 加规则库 yaml(7 类目骨架)+ rule-loader

- packages/shared/rules/{7 类目}.yaml,每类 1 条占位规则(T14 填全)
- rule-loader 启动加载、内存缓存、结构校验抛错
- buildPromptHints() 拼装 system prompt 附加段
- 装 js-yaml@4 + @types/js-yaml"
```

---

## Task 4: review.service 重构 + reviewPrompt 实现

**Files:**

- Modify: `apps/api/src/reviews/review.service.ts`(抽 `runReviewLLM` / `parseSafetyOf7Cats` 共用 + 加 `reviewPrompt` 方法 + 把 `parseSafety` 改名为 `parseSafetyOf6Cats` 留给 preflight)
- Modify: `apps/api/src/reviews/review.service.spec.ts`(新增 reviewPrompt 单测 3 条)

**WHY 重构:** Phase 2.3 preflight 用 6 维 SAFETY_KEYS,Phase 2.5 ① ③ 用 7 维 SENSITIVE_CATEGORIES。两者维度集合不同(preflight 没有 fraud / medical;Phase 2.5 没有 false_advertising —— 注:Phase 2.5 把 false_advertising 合并到 fraud 内)。所以共用 LLM 调用 + 类型化解析,但维度集合各自传入。

- [ ] **Step 1: 写 reviewPrompt 单测(先红)**

`apps/api/src/reviews/review.service.spec.ts` 末尾(在最后一个 `})` 前)追加:

```typescript
describe("reviewPrompt (Phase 2.5 ①)", () => {
  const ALL_LOW_7CATS = JSON.stringify({
    dimensions: [
      { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
    ],
  });
  const POLITICS_HIGH_7CATS = JSON.stringify({
    dimensions: [
      { key: "politics", score: 90, severity: "high", hits: ["xxx"], reason: "命中" },
      { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
      { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
    ],
  });

  it("ALLOW happy path:全 low → recommendation ALLOW + hitCategories 空", async () => {
    llm.chat.mockResolvedValueOnce(ALL_LOW_7CATS);
    const res = await service.reviewPrompt("正常选题文本", DEMO_AUTHOR_ID);
    expect(res.recommendation).toBe("ALLOW");
    expect(res.hitCategories).toEqual([]);
    expect(res.reviewId).toEqual(expect.any(String));
  });

  it("politics high → recommendation BLOCK + hitCategories 包含 politics", async () => {
    llm.chat.mockResolvedValueOnce(POLITICS_HIGH_7CATS);
    const res = await service.reviewPrompt("敏感选题", DEMO_AUTHOR_ID);
    expect(res.recommendation).toBe("BLOCK");
    expect(res.hitCategories).toContain("politics");
  });

  it("system message 拼接规则库 prompt_hint(包含 politics/pornography 提示)", async () => {
    llm.chat.mockResolvedValueOnce(ALL_LOW_7CATS);
    await service.reviewPrompt("xxx", DEMO_AUTHOR_ID);
    const calledMessages = llm.chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const sys = calledMessages.find((m) => m.role === "system")?.content ?? "";
    expect(sys).toContain("politics");
    expect(sys).toContain("pornography");
  });
});
```

文件顶部 import 区追加:`import { DEMO_AUTHOR_ID } from "../../prisma/fixtures";`(若文件已有,跳过)。

- [ ] **Step 2: 跑测试,确认 FAIL**

```bash
pnpm --filter @bytedance-aigc/api test -- review.service
```

预期:`service.reviewPrompt is not a function`。

- [ ] **Step 3: 重构 review.service.ts —— 抽公共 + 加 reviewPrompt**

打开 `apps/api/src/reviews/review.service.ts`,做以下修改:

**(a)** import 区追加(在 `SAFETY_KEYS, QUALITY_KEYS` 那行下):

```typescript
import {
  SENSITIVE_CATEGORIES,
  type SensitiveCategory,
  type PromptReviewResponse,
} from "@bytedance-aigc/shared";

import { buildPromptHints } from "./rule-loader";
```

**(b)** 在 `preflight` 方法之后、`listByDraft` 之前,新增 `reviewPrompt`:

```typescript
  /**
   * Phase 2.5 ① — 选题 + 提示词阶段审核
   * 同步:写 Review 行(stage=PROMPT_INPUT,quality 全 0)
   */
  async reviewPrompt(text: string, _userSub: string): Promise<PromptReviewResponse> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      throw new InternalServerErrorException("text 必须非空且 ≤ 1000 字");
    }

    const promptCfg = await this.prompts.findDefaultByTool("PROMPT_REVIEW");
    const messages = [
      { role: "system" as const, content: `${promptCfg.systemPrompt}\n\n${buildPromptHints()}` },
      { role: "user" as const, content: trimmed },
    ];

    let raw = "";
    let ms = 0;
    try {
      const r = await this.timed(() => this.llm.chat(messages, { temperature: 0.0 }));
      raw = r.value;
      ms = r.ms;
    } catch (err) {
      this.logger.warn(`reviewPrompt LLM error: ${(err as Error).message}`);
      // ① 阶段 LLM 失败不阻断作者
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        message: "审核服务暂时不可用,可继续",
        reviewId: "",
      };
    }

    const safety = this.parseSafetyOf7Cats(raw);
    const hitCategories: SensitiveCategory[] = safety.dimensions
      .filter((d) => d.severity === "high" || d.severity === "medium")
      .map((d) => d.key as SensitiveCategory);
    const recommendation = safety.dimensions.some((d) => d.severity === "high")
      ? "BLOCK"
      : safety.dimensions.some((d) => d.severity === "medium")
        ? "WARN"
        : "ALLOW";

    const message =
      recommendation === "ALLOW"
        ? "选题未发现明显风险"
        : `选题可能涉及 ${hitCategories.join("/")},建议调整方向`;

    // WHY: ① 阶段 review 频次高(每次失焦触发),且无关联 draftId(选题尚未落地)。
    //      不落 prisma.review 表,reviewId 仅用作日志追溯。
    const reviewId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.logger.log(
      `reviewPrompt id=${reviewId} rec=${recommendation} hits=${hitCategories.join(",")} ms=${ms}`,
    );

    return { recommendation, hitCategories, message, reviewId };
  }
```

**决策记录:** `Review.draftId` 在 schema 是 NOT NULL,且 ① 阶段没有具体 draft 上下文(选题阶段还在 FastModeDialog 里没创草稿)。两条路:(A) 改 schema 让 draftId 可空(影响范围大);(B) reviewPrompt 不落库只返内存级 uuid。**选 B**:reviewId 仅供日志,审计追溯靠 logger;若日后需持久化,Phase 2.6 再扩。

**(c)** 抽 `parseSafetyOf7Cats`(独立于 6 维的 `parseSafety`),放在 class 末尾(`toDto` 之后):

```typescript
  /** 7 类目 safety 解析(Phase 2.5 ① ③ 共用)。失败 → fallback 全 high。 */
  private parseSafetyOf7Cats(raw: string): {
    overall: number;
    dimensions: { key: string; score: number; severity: "low" | "medium" | "high"; hits: string[]; reason?: string }[];
    note?: string;
  } {
    const fallback = (note: string) => ({
      overall: 0,
      dimensions: SENSITIVE_CATEGORIES.map((key) => ({
        key,
        score: 100,
        severity: "high" as const,
        hits: [],
        reason: "AI 输出格式异常,默认按高风险处理",
      })),
      note,
    });
    let parsed: { dimensions?: unknown };
    try {
      parsed = JSON.parse(raw) as { dimensions?: unknown };
    } catch {
      return fallback("AI 7 类目审核输出非合法 JSON");
    }
    if (!Array.isArray(parsed.dimensions)) return fallback("缺 dimensions");
    const dims: {
      key: string;
      score: number;
      severity: "low" | "medium" | "high";
      hits: string[];
      reason?: string;
    }[] = [];
    for (const key of SENSITIVE_CATEGORIES) {
      const found = (parsed.dimensions as { key?: string }[]).find((d) => d?.key === key);
      if (!found) return fallback(`缺维度 ${key}`);
      const f = found as Record<string, unknown>;
      const score = Number(f.score);
      const severity = f.severity === "high" || f.severity === "medium" ? f.severity : "low";
      dims.push({
        key,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        severity,
        hits: Array.isArray(f.hits)
          ? (f.hits as unknown[]).filter((h) => typeof h === "string").map(String)
          : [],
        reason: typeof f.reason === "string" ? f.reason : undefined,
      });
    }
    const maxScore = Math.max(0, ...dims.map((d) => d.score));
    return { overall: 100 - maxScore, dimensions: dims };
  }
```

- [ ] **Step 4: 跑测试,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/api test -- review.service
```

预期:原 6 条 + 新 3 条 = 9 条全绿。

- [ ] **Step 5: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/api lint
pnpm --filter @bytedance-aigc/api typecheck
```

预期:0 错误。若 `t0` 未用 lint 警告,删除该声明。

- [ ] **Step 6: commit**

```bash
git add apps/api/src/reviews/review.service.ts apps/api/src/reviews/review.service.spec.ts
git commit -m "feat(api): review.service 加 reviewPrompt(Phase 2.5 ①)

- 新增 reviewPrompt(text, userSub):合规审核选题+提示词
- 抽 parseSafetyOf7Cats 处理 7 类目 dimension
- 拼接规则库 prompt_hint 注入 system message
- LLM 失败 ALLOW fallback 不阻断;reviewId 仅日志,不落库
- 单测 3 条:ALLOW / politics BLOCK / system 含 prompt_hints"
```

---

## Task 5: review.service 加 reviewSection + streamSession 计数

**Files:**

- Create: `apps/api/src/reviews/stream-session.ts`(内存级 session 状态)
- Modify: `apps/api/src/reviews/review.service.ts`(加 `reviewSection`)
- Modify: `apps/api/src/reviews/review.service.spec.ts`(新增 4 条单测)
- Modify: `apps/api/src/reviews/reviews.module.ts`(注册 StreamSessionStore provider)

- [ ] **Step 1: 写 streamSession 单测(先红)**

`apps/api/src/reviews/review.service.spec.ts` 末尾追加(继续在 describe 内):

```typescript
describe("reviewSection (Phase 2.5 ③)", () => {
  const SECTION_LOW = JSON.stringify({
    dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
      key,
      score: 0,
      severity: "low",
      hits: [],
      reason: "无",
    })),
  });
  const SECTION_HIGH_POLITICS = JSON.stringify({
    dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
      key,
      score: key === "politics" ? 90 : 0,
      severity: key === "politics" ? "high" : "low",
      hits: key === "politics" ? ["xxx"] : [],
      reason: key === "politics" ? "命中" : "无",
    })),
  });

  it("ALLOW 段落:不落 review,abortStream=false", async () => {
    llm.chat.mockResolvedValueOnce(SECTION_LOW);
    const res = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-allow-1",
      range: { from: 0, to: 50 },
      text: "正常段落内容。",
    });
    expect(res.recommendation).toBe("ALLOW");
    expect(res.abortStream).toBe(false);
  });

  it("medium 段落:写 review + abortStream=false", async () => {
    const SECTION_MEDIUM = JSON.stringify({
      dimensions: SENSITIVE_CATEGORIES_FOR_TEST.map((key) => ({
        key,
        score: key === "vulgarity" ? 50 : 0,
        severity: key === "vulgarity" ? "medium" : "low",
        hits: [],
        reason: "",
      })),
    });
    llm.chat.mockResolvedValueOnce(SECTION_MEDIUM);
    const res = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-medium-1",
      range: { from: 0, to: 100 },
      text: "段落",
    });
    expect(res.recommendation).toBe("WARN");
    expect(res.severity).toBe("medium");
    expect(res.abortStream).toBe(false);
  });

  it("同 sessionId 连续 3 段 high → abortStream=true", async () => {
    llm.chat
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS);
    const sid = "sess-burst-1";
    const r1 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    const r2 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 51, to: 100 },
      text: "段 2",
    });
    const r3 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: sid,
      range: { from: 101, to: 150 },
      text: "段 3",
    });
    expect(r1.abortStream).toBe(false);
    expect(r2.abortStream).toBe(false);
    expect(r3.abortStream).toBe(true);
  });

  it("不同 sessionId 隔离:互不累计", async () => {
    llm.chat
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS)
      .mockResolvedValueOnce(SECTION_HIGH_POLITICS);
    const r1 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-A",
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    const r2 = await service.reviewSection({
      draftId: "demodraft0000000000000001",
      userSub: DEMO_AUTHOR_ID,
      sessionId: "sess-B",
      range: { from: 0, to: 50 },
      text: "段 1",
    });
    expect(r1.abortStream).toBe(false);
    expect(r2.abortStream).toBe(false);
  });
});
```

文件顶部 import 区追加(若已有则跳过):

```typescript
import { SENSITIVE_CATEGORIES as SENSITIVE_CATEGORIES_FOR_TEST } from "@bytedance-aigc/shared";
```

- [ ] **Step 2: 跑测试,确认 FAIL**

```bash
pnpm --filter @bytedance-aigc/api test -- review.service
```

预期:`service.reviewSection is not a function`。

- [ ] **Step 3: 实现 `stream-session.ts`**

`apps/api/src/reviews/stream-session.ts`:

```typescript
import { Injectable } from "@nestjs/common";

const TTL_MS = 30 * 60 * 1000; // 30 分钟
const ABORT_THRESHOLD = 3;

interface SessionState {
  consecutiveHigh: number;
  lastTouched: number;
}

/**
 * 内存级 stream session 状态;按 sessionId 计数连续 high 段。
 * WHY: ③ 阶段连续 ≥ 3 段 high → 触发 abortStream;无需持久化(进程重启清空可接受)。
 */
@Injectable()
export class StreamSessionStore {
  private map = new Map<string, SessionState>();

  /** 段落审核回调:命中 high 计数 +1,否则清零;返回是否应中断流。 */
  recordSegment(sessionId: string, isHigh: boolean): { shouldAbort: boolean } {
    this.gc();
    const now = Date.now();
    const cur = this.map.get(sessionId) ?? { consecutiveHigh: 0, lastTouched: now };
    cur.consecutiveHigh = isHigh ? cur.consecutiveHigh + 1 : 0;
    cur.lastTouched = now;
    this.map.set(sessionId, cur);
    return { shouldAbort: cur.consecutiveHigh >= ABORT_THRESHOLD };
  }

  /** test-only */
  __reset(): void {
    this.map.clear();
  }

  private gc(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of this.map.entries()) {
      if (v.lastTouched < cutoff) this.map.delete(k);
    }
  }
}
```

- [ ] **Step 4: 在 reviews.module.ts 注册 StreamSessionStore**

`apps/api/src/reviews/reviews.module.ts`:

```typescript
import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DraftsModule } from "../drafts/drafts.module";
import { PromptsModule } from "../prompts/prompts.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewService } from "./review.service";
import { StreamSessionStore } from "./stream-session";

@Module({
  imports: [AuthModule, DraftsModule, PromptsModule],
  controllers: [ReviewsController],
  providers: [ReviewService, StreamSessionStore],
  exports: [ReviewService],
})
export class ReviewsModule {}
```

- [ ] **Step 5: 在 review.service.ts 加 reviewSection**

import 区追加:

```typescript
import type { SectionReviewResponse } from "@bytedance-aigc/shared";
import { StreamSessionStore } from "./stream-session";
```

constructor 加 `streamSessions`:

```typescript
  constructor(
    private readonly drafts: DraftsService,
    private readonly prisma: PrismaService,
    private readonly llm: LlmClient,
    private readonly prompts: PromptsService,
    private readonly streamSessions: StreamSessionStore,
  ) {}
```

在 `reviewPrompt` 之后新增方法:

```typescript
  /**
   * Phase 2.5 ③ — 流式生成中段落审核
   * 同 sessionId 内连续 ≥ 3 段 high → abortStream
   */
  async reviewSection(input: {
    draftId: string;
    userSub: string;
    sessionId: string;
    range: { from: number; to: number };
    text: string;
  }): Promise<SectionReviewResponse> {
    const { draftId, userSub, sessionId, text } = input;
    await this.drafts.assertAuthor(draftId, userSub);

    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      throw new InternalServerErrorException("section text 必须非空且 ≤ 2000 字");
    }

    const promptCfg = await this.prompts.findDefaultByTool("SECTION_REVIEW");
    const messages = [
      { role: "system" as const, content: `${promptCfg.systemPrompt}\n\n${buildPromptHints()}` },
      { role: "user" as const, content: trimmed },
    ];

    let raw = "";
    let ms = 0;
    try {
      const r = await this.timed(() => this.llm.chat(messages, { temperature: 0.0 }));
      raw = r.value;
      ms = r.ms;
    } catch (err) {
      this.logger.warn(`reviewSection LLM error: ${(err as Error).message}`);
      return {
        recommendation: "ALLOW",
        hitCategories: [],
        severity: "low",
        message: "审核服务暂时不可用",
        abortStream: false,
        reviewId: "",
      };
    }

    const safety = this.parseSafetyOf7Cats(raw);
    const isHigh = safety.dimensions.some((d) => d.severity === "high");
    const isMedium = !isHigh && safety.dimensions.some((d) => d.severity === "medium");
    const recommendation: "ALLOW" | "WARN" | "BLOCK" = isHigh ? "BLOCK" : isMedium ? "WARN" : "ALLOW";
    const severity: "low" | "medium" | "high" = isHigh ? "high" : isMedium ? "medium" : "low";
    const hitCategories = safety.dimensions
      .filter((d) => d.severity === "high" || d.severity === "medium")
      .map((d) => d.key as SensitiveCategory);

    const { shouldAbort } = this.streamSessions.recordSegment(sessionId, isHigh);

    let reviewId = "";
    if (recommendation !== "ALLOW") {
      const review = await this.prisma.review.create({
        data: {
          draftId,
          stage: "SECTION_INLINE",
          safety: safety as unknown as Prisma.InputJsonValue,
          quality: { overall: 0, dimensions: [], note: "本阶段不评质量" } as unknown as Prisma.InputJsonValue,
          recommendation,
          modelMeta: {
            latencyMsSafety: ms,
            latencyMsQuality: 0,
            totalMs: ms,
            truncated: false,
          },
        },
      });
      reviewId = review.id;
    }

    const message = recommendation === "ALLOW"
      ? "段落正常"
      : `段落可能涉及 ${hitCategories.join("/")}`;

    return { recommendation, hitCategories, severity, message, abortStream: shouldAbort, reviewId };
  }
```

- [ ] **Step 6: 单测 mock 加 streamSessions 注入**

打开 `apps/api/src/reviews/review.service.spec.ts`,找到 `Test.createTestingModule({...providers: [...]})` 块,加入 `StreamSessionStore`:

```typescript
import { StreamSessionStore } from "./stream-session";
// ...
providers: [
  ReviewService,
  StreamSessionStore,
  { provide: DraftsService, useValue: drafts },
  { provide: PrismaService, useValue: prisma },
  { provide: LlmClient, useValue: llm },
  { provide: PromptsService, useValue: prompts },
],
```

并在每个 describe 的 beforeEach 调 `app.get(StreamSessionStore).__reset()`:

```typescript
let store: StreamSessionStore;
// ...beforeAll:
store = moduleRef.get(StreamSessionStore);
// ...beforeEach:
store.__reset();
```

- [ ] **Step 7: 跑测试,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/api test -- review.service
```

预期:9 + 4 = 13 条全绿。

- [ ] **Step 8: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/api lint
pnpm --filter @bytedance-aigc/api typecheck
```

- [ ] **Step 9: commit**

```bash
git add apps/api/src/reviews/stream-session.ts apps/api/src/reviews/reviews.module.ts apps/api/src/reviews/review.service.ts apps/api/src/reviews/review.service.spec.ts
git commit -m "feat(api): review.service 加 reviewSection + StreamSessionStore

- StreamSessionStore 内存级 sessionId → 连续 high 计数,30min TTL
- reviewSection 接 LLM 7 类目审核 + 计数 ≥ 3 触发 abortStream
- ALLOW 不落 Review;非 ALLOW 落 stage=SECTION_INLINE
- 单测 4 条:ALLOW/medium/连续 3 段/sessionId 隔离"
```

---

## Task 6: reviews.controller 加 2 端点 + e2e

**Files:**

- Create: `apps/api/src/reviews/dto/review-prompt.dto.ts`
- Create: `apps/api/src/reviews/dto/review-section.dto.ts`
- Modify: `apps/api/src/reviews/reviews.controller.ts`(加 2 个 POST 端点;**注意:必须脱离 `/drafts` 前缀**)
- Create: `apps/api/test/review-prompt.e2e-spec.ts`(4 条)
- Create: `apps/api/test/review-section.e2e-spec.ts`(5 条)

**WHY 路由结构变更:** 现有 `@Controller("drafts")` 把所有端点都挂到 `/drafts/...`。新端点是 `/reviews/prompt` / `/reviews/section`,需要从 controller 拆出 prefix。最小改动:**保留** `ReviewsController` 在 `/drafts` 前缀,**新建** `ReviewsActionController` 在 `/reviews` 前缀。

- [ ] **Step 1: 写 DTO**

`apps/api/src/reviews/dto/review-prompt.dto.ts`:

```typescript
import { IsString, MaxLength, MinLength } from "class-validator";

export class ReviewPromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}
```

`apps/api/src/reviews/dto/review-section.dto.ts`:

```typescript
import { Type } from "class-transformer";
import { IsInt, IsString, MaxLength, MinLength, ValidateNested, Min } from "class-validator";

class RangeDto {
  @IsInt()
  @Min(0)
  from!: number;

  @IsInt()
  @Min(0)
  to!: number;
}

export class ReviewSectionDto {
  @IsString()
  @MinLength(1)
  draftId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId!: string;

  @ValidateNested()
  @Type(() => RangeDto)
  range!: RangeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
```

- [ ] **Step 2: 新建 ReviewsActionController**

`apps/api/src/reviews/reviews-action.controller.ts`:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import type { PromptReviewResponse, SectionReviewResponse } from "@bytedance-aigc/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import type { JwtPayload } from "../auth/jwt-payload.interface";
import { UserGuard } from "../auth/user.guard";
import { ReviewService } from "./review.service";
import { ReviewPromptDto } from "./dto/review-prompt.dto";
import { ReviewSectionDto } from "./dto/review-section.dto";

@Controller("reviews")
@UseGuards(UserGuard)
export class ReviewsActionController {
  constructor(private readonly reviews: ReviewService) {}

  @Post("prompt")
  @HttpCode(HttpStatus.OK)
  reviewPrompt(
    @Body() body: ReviewPromptDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PromptReviewResponse> {
    return this.reviews.reviewPrompt(body.text, user.sub);
  }

  @Post("section")
  @HttpCode(HttpStatus.OK)
  reviewSection(
    @Body() body: ReviewSectionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<SectionReviewResponse> {
    return this.reviews.reviewSection({
      draftId: body.draftId,
      userSub: user.sub,
      sessionId: body.sessionId,
      range: body.range,
      text: body.text,
    });
  }
}
```

- [ ] **Step 3: reviews.module.ts 注册新 controller**

```typescript
import { ReviewsActionController } from "./reviews-action.controller";
// ...
@Module({
  imports: [AuthModule, DraftsModule, PromptsModule],
  controllers: [ReviewsController, ReviewsActionController],
  providers: [ReviewService, StreamSessionStore],
  exports: [ReviewService],
})
```

- [ ] **Step 4: 写 review-prompt.e2e-spec.ts**

`apps/api/test/review-prompt.e2e-spec.ts`:

```typescript
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

const ALL_LOW = JSON.stringify({
  dimensions: [
    { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
  ],
});

const POLITICS_HIGH = JSON.stringify({
  dimensions: [
    { key: "politics", score: 90, severity: "high", hits: ["x"], reason: "命中" },
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
  ],
});

const VULGAR_MEDIUM = JSON.stringify({
  dimensions: [
    { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "vulgarity", score: 50, severity: "medium", hits: [], reason: "" },
    { key: "fraud", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "medical", score: 0, severity: "low", hits: [], reason: "无" },
  ],
});

describe("Phase 2.5 review prompt (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const llmChatMock = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: llmChatMock, chatStream: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await applyAllFixtures(prisma);
    token = await loginAsDemo(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  beforeEach(() => llmChatMock.mockReset());

  it("ALLOW: 全 low → 200 + recommendation ALLOW", async () => {
    llmChatMock.mockResolvedValueOnce(ALL_LOW);
    const res = await request(app.getHttpServer())
      .post("/reviews/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "正常选题" })
      .expect(200);
    const body = res.body as { recommendation: string; hitCategories: string[] };
    expect(body.recommendation).toBe("ALLOW");
    expect(body.hitCategories).toEqual([]);
  });

  it("BLOCK: politics high → recommendation BLOCK + 命中类目", async () => {
    llmChatMock.mockResolvedValueOnce(POLITICS_HIGH);
    const res = await request(app.getHttpServer())
      .post("/reviews/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "敏感选题" })
      .expect(200);
    const body = res.body as { recommendation: string; hitCategories: string[] };
    expect(body.recommendation).toBe("BLOCK");
    expect(body.hitCategories).toContain("politics");
  });

  it("WARN: vulgarity medium → recommendation WARN", async () => {
    llmChatMock.mockResolvedValueOnce(VULGAR_MEDIUM);
    const res = await request(app.getHttpServer())
      .post("/reviews/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "略低俗" })
      .expect(200);
    expect((res.body as { recommendation: string }).recommendation).toBe("WARN");
  });

  it("401 无 token", async () => {
    await request(app.getHttpServer())
      .post("/reviews/prompt")
      .send({ text: "无 token" })
      .expect(401);
    expect(llmChatMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 写 review-section.e2e-spec.ts**

`apps/api/test/review-section.e2e-spec.ts`:

```typescript
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

const DEMO_DRAFT_ID = "demodraft0000000000000001";
const OTHER_AUTHOR_ID = "otherauthor00000000000003";
const OTHER_DRAFT_ID = "otherdraftxxxxxxxxxxxxxx3";

const cats = ["politics", "pornography", "gambling", "drugs", "vulgarity", "fraud", "medical"];
const allLow = JSON.stringify({
  dimensions: cats.map((k) => ({ key: k, score: 0, severity: "low", hits: [], reason: "无" })),
});
const politicsHigh = JSON.stringify({
  dimensions: cats.map((k) => ({
    key: k,
    score: k === "politics" ? 90 : 0,
    severity: k === "politics" ? "high" : "low",
    hits: k === "politics" ? ["x"] : [],
    reason: "",
  })),
});
const vulgarMedium = JSON.stringify({
  dimensions: cats.map((k) => ({
    key: k,
    score: k === "vulgarity" ? 50 : 0,
    severity: k === "vulgarity" ? "medium" : "low",
    hits: [],
    reason: "",
  })),
});

describe("Phase 2.5 review section (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const llmChatMock = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: llmChatMock, chatStream: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await applyAllFixtures(prisma);

    await prisma.user.create({ data: { id: OTHER_AUTHOR_ID, handle: "section-other" } });
    await prisma.draft.create({
      data: {
        id: OTHER_DRAFT_ID,
        authorId: OTHER_AUTHOR_ID,
        mode: "FAST",
        title: "他人草稿",
        body: { type: "doc", content: [] },
        version: 1,
      },
    });

    token = await loginAsDemo(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  beforeEach(() => llmChatMock.mockReset());

  const post = (body: Record<string, unknown>, t = token) =>
    request(app.getHttpServer())
      .post("/reviews/section")
      .set("Authorization", `Bearer ${t}`)
      .send(body);

  it("ALLOW: 不落 Review", async () => {
    llmChatMock.mockResolvedValueOnce(allLow);
    const before = await prisma.review.count({ where: { stage: "SECTION_INLINE" } });
    const res = await post({
      draftId: DEMO_DRAFT_ID,
      sessionId: "sess-allow",
      range: { from: 0, to: 50 },
      text: "正常",
    }).expect(200);
    expect((res.body as { recommendation: string }).recommendation).toBe("ALLOW");
    const after = await prisma.review.count({ where: { stage: "SECTION_INLINE" } });
    expect(after).toBe(before);
  });

  it("medium: 落 Review + abortStream=false", async () => {
    llmChatMock.mockResolvedValueOnce(vulgarMedium);
    const res = await post({
      draftId: DEMO_DRAFT_ID,
      sessionId: "sess-medium",
      range: { from: 0, to: 100 },
      text: "略低俗",
    }).expect(200);
    const body = res.body as { recommendation: string; abortStream: boolean; reviewId: string };
    expect(body.recommendation).toBe("WARN");
    expect(body.abortStream).toBe(false);
    const stored = await prisma.review.findUnique({ where: { id: body.reviewId } });
    expect(stored?.stage).toBe("SECTION_INLINE");
  });

  it("连续 3 段 high → 第 3 次 abortStream=true", async () => {
    llmChatMock
      .mockResolvedValueOnce(politicsHigh)
      .mockResolvedValueOnce(politicsHigh)
      .mockResolvedValueOnce(politicsHigh);
    const sid = "sess-burst";
    const r1 = await post({
      draftId: DEMO_DRAFT_ID,
      sessionId: sid,
      range: { from: 0, to: 50 },
      text: "段 1",
    }).expect(200);
    const r2 = await post({
      draftId: DEMO_DRAFT_ID,
      sessionId: sid,
      range: { from: 51, to: 100 },
      text: "段 2",
    }).expect(200);
    const r3 = await post({
      draftId: DEMO_DRAFT_ID,
      sessionId: sid,
      range: { from: 101, to: 150 },
      text: "段 3",
    }).expect(200);
    expect((r1.body as { abortStream: boolean }).abortStream).toBe(false);
    expect((r2.body as { abortStream: boolean }).abortStream).toBe(false);
    expect((r3.body as { abortStream: boolean }).abortStream).toBe(true);
  });

  it("401: 无 token", async () => {
    await request(app.getHttpServer())
      .post("/reviews/section")
      .send({ draftId: DEMO_DRAFT_ID, sessionId: "x", range: { from: 0, to: 1 }, text: "x" })
      .expect(401);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("403: 别人草稿", async () => {
    await post({
      draftId: OTHER_DRAFT_ID,
      sessionId: "x",
      range: { from: 0, to: 1 },
      text: "x",
    }).expect(403);
    expect(llmChatMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 跑 e2e**

```bash
pnpm --filter @bytedance-aigc/api test:e2e -- --testPathPattern='review-(prompt|section)'
```

预期:9 条全绿(prompt 4 + section 5)。

- [ ] **Step 7: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/api lint
pnpm --filter @bytedance-aigc/api typecheck
```

- [ ] **Step 8: commit**

```bash
git add apps/api/src/reviews apps/api/test/review-prompt.e2e-spec.ts apps/api/test/review-section.e2e-spec.ts
git commit -m "feat(api): /reviews/prompt + /reviews/section 端点 + e2e

- 新建 ReviewsActionController(脱离 /drafts 前缀)
- ReviewPromptDto / ReviewSectionDto class-validator 校验
- e2e prompt 4 用例(ALLOW/BLOCK/WARN/401)
- e2e section 5 用例(ALLOW/medium/连续 3 段/401/403)"
```

---

## Task 7: sensitive-words.json + 类型 + 校验脚本

**Files:**

- Create: `packages/shared/src/sensitive-words.json`(骨架,T14 配合补全)
- Create: `packages/shared/src/sensitive-words.ts`(类型 + 加载工具)
- Create: `packages/shared/scripts/validate-words.ts`
- Modify: `packages/shared/package.json`(加 `validate:words` script)

- [ ] **Step 1: 写 sensitive-words.ts(类型 + loader)**

`packages/shared/src/sensitive-words.ts`:

```typescript
import type { SensitiveCategory } from "./review";

export type WordSeverity = "low" | "medium" | "high";

export interface SensitiveWordList {
  version: string;
  categories: {
    [cat in SensitiveCategory]: {
      severity: WordSeverity;
      words: string[];
    };
  };
}

import wordsJson from "./sensitive-words.json";

/** 加载静态 JSON 词库;Worker 启动时一次性注入。 */
export function loadSensitiveWords(): SensitiveWordList {
  return wordsJson as SensitiveWordList;
}

/** 把词库展开成扁平数组(给 Aho-Corasick 构建 trie)。 */
export interface FlatWordEntry {
  word: string;
  category: SensitiveCategory;
  severity: WordSeverity;
}

export function flattenWords(list: SensitiveWordList): FlatWordEntry[] {
  const out: FlatWordEntry[] = [];
  (Object.keys(list.categories) as SensitiveCategory[]).forEach((cat) => {
    const block = list.categories[cat];
    for (const w of block.words) {
      out.push({ word: w, category: cat, severity: block.severity });
    }
  });
  return out;
}
```

- [ ] **Step 2: 建词库 JSON 骨架**

`packages/shared/src/sensitive-words.json`(每类目占 3-5 个示例词,T14 填全 2000-5000):

```json
{
  "version": "2026-06-06",
  "categories": {
    "politics": {
      "severity": "high",
      "words": ["占位词1", "占位词2", "占位词3"]
    },
    "pornography": {
      "severity": "high",
      "words": ["占位porn1", "占位porn2"]
    },
    "gambling": {
      "severity": "high",
      "words": ["占位gamb1", "占位gamb2"]
    },
    "drugs": {
      "severity": "high",
      "words": ["占位drug1", "占位drug2"]
    },
    "vulgarity": {
      "severity": "medium",
      "words": ["占位俗1", "占位俗2"]
    },
    "fraud": {
      "severity": "medium",
      "words": ["秒到账", "包治百病", "暴富"]
    },
    "medical": {
      "severity": "medium",
      "words": ["祖传秘方", "包治"]
    }
  }
}
```

- [ ] **Step 3: tsconfig 允许 import json(若已允许跳过)**

检查 `packages/shared/tsconfig.json` 的 `compilerOptions` 含 `"resolveJsonModule": true`。若没有,加上。

- [ ] **Step 4: 写校验脚本**

`packages/shared/scripts/validate-words.ts`:

```typescript
import { loadSensitiveWords, flattenWords } from "../src/sensitive-words";
import { SENSITIVE_CATEGORIES } from "../src/review";

function main(): void {
  const list = loadSensitiveWords();
  const errors: string[] = [];

  if (typeof list.version !== "string" || list.version.length === 0) {
    errors.push("缺 version");
  }

  for (const cat of SENSITIVE_CATEGORIES) {
    const block = list.categories[cat];
    if (!block) {
      errors.push(`缺类目 ${cat}`);
      continue;
    }
    if (!["low", "medium", "high"].includes(block.severity)) {
      errors.push(`${cat} severity 非法: ${block.severity}`);
    }
    if (!Array.isArray(block.words) || block.words.length === 0) {
      errors.push(`${cat} words 必须非空数组`);
    }
    for (const w of block.words) {
      if (typeof w !== "string" || w.length < 2) {
        errors.push(`${cat} 词长度需 ≥ 2: ${JSON.stringify(w)}`);
      }
    }
  }

  const flat = flattenWords(list);
  const seen = new Set<string>();
  for (const e of flat) {
    if (seen.has(e.word)) errors.push(`重复词: ${e.word}`);
    seen.add(e.word);
  }

  if (errors.length > 0) {
    console.error("validate-words FAIL:");
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }
  console.log(`validate-words OK: ${flat.length} 条词,${SENSITIVE_CATEGORIES.length} 类目`);
}

main();
```

- [ ] **Step 5: 加 npm script**

`packages/shared/package.json`,在 `"scripts"` 块加:

```json
    "validate:words": "tsx scripts/validate-words.ts"
```

如 packages/shared 没有 tsx,先装:

```bash
pnpm --filter @bytedance-aigc/shared add -D tsx@^4.19.2
```

- [ ] **Step 6: 跑校验**

```bash
pnpm --filter @bytedance-aigc/shared validate:words
```

预期:`validate-words OK: 19 条词,7 类目`(占位词总数,T14 后会增长)。

- [ ] **Step 7: 把 sensitive-words 加入 shared index export**

`packages/shared/src/index.ts` 末尾追加:

```typescript
export * from "./sensitive-words";
```

- [ ] **Step 8: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 9: commit**

```bash
git add packages/shared/src/sensitive-words.ts packages/shared/src/sensitive-words.json packages/shared/scripts/validate-words.ts packages/shared/src/index.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(shared): 加敏感词 JSON 骨架 + 类型 + validate:words 脚本

- sensitive-words.json:7 类目,目前每类 3-5 占位词(T14 填全)
- sensitive-words.ts:loadSensitiveWords / flattenWords / 类型
- validate-words.ts:结构校验脚本(可入 CI)
- 装 tsx@4 给 shared 跑 ts 脚本"
```

---

## Task 8: Aho-Corasick 实现 + 单测

**Files:**

- Create: `apps/web/src/workers/aho-corasick.ts`(纯函数,可在 main thread 单测)
- Create: `apps/web/src/workers/aho-corasick.test.ts`

- [ ] **Step 1: 写单测(先红)**

`apps/web/src/workers/aho-corasick.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAC, search } from "./aho-corasick";

describe("Aho-Corasick", () => {
  it("空词库 → search 返空数组", () => {
    const ac = buildAC([]);
    expect(search(ac, "随便文本")).toEqual([]);
  });

  it("单词命中:返 from/to/word", () => {
    const ac = buildAC([{ word: "敏感", category: "politics", severity: "high" }]);
    const hits = search(ac, "前缀敏感词后缀");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      word: "敏感",
      from: 2,
      to: 4,
      category: "politics",
      severity: "high",
    });
  });

  it("多词同时命中:from 升序", () => {
    const ac = buildAC([
      { word: "abc", category: "vulgarity", severity: "medium" },
      { word: "bcd", category: "vulgarity", severity: "medium" },
    ]);
    const hits = search(ac, "abcd");
    expect(hits.map((h) => h.word)).toEqual(["abc", "bcd"]);
    expect(hits[0].from).toBe(0);
    expect(hits[1].from).toBe(1);
  });

  it("重叠词命中:都返", () => {
    const ac = buildAC([
      { word: "中国", category: "politics", severity: "high" },
      { word: "国共", category: "politics", severity: "high" },
    ]);
    const hits = search(ac, "中国共产党");
    expect(hits.map((h) => h.word).sort()).toEqual(["中国", "国共"]);
  });

  it("无命中:空数组", () => {
    const ac = buildAC([{ word: "xxx", category: "politics", severity: "high" }]);
    expect(search(ac, "yyy")).toEqual([]);
  });

  it("UTF-16 surrogate(emoji)不影响 from/to:返字符串 index", () => {
    const ac = buildAC([{ word: "测试", category: "politics", severity: "high" }]);
    const hits = search(ac, "🎉测试🎉");
    // emoji 是 surrogate pair = 2 个 UTF-16 code unit;"测试" 起点 = 2
    expect(hits[0].from).toBe(2);
    expect(hits[0].to).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试,确认 FAIL**

```bash
pnpm --filter @bytedance-aigc/web test -- aho-corasick
```

预期:`Cannot find module './aho-corasick'`。

- [ ] **Step 3: 实现 aho-corasick.ts**

`apps/web/src/workers/aho-corasick.ts`:

```typescript
/**
 * 极简 Aho-Corasick 自动机:
 *   - buildAC(words): 构建 trie + fail 指针
 *   - search(ac, text): 单次扫描返所有命中
 * 复杂度:build O(Σ词长),search O(|text| + 命中数)
 */

export interface ACWord {
  word: string;
  category: string;
  severity: "low" | "medium" | "high";
}

export interface ACHit {
  from: number;
  to: number;
  word: string;
  category: string;
  severity: "low" | "medium" | "high";
}

interface Node {
  next: Map<string, Node>;
  fail: Node | null;
  output: ACWord[];
  depth: number;
}

export interface AC {
  root: Node;
}

export function buildAC(words: ACWord[]): AC {
  const root: Node = { next: new Map(), fail: null, output: [], depth: 0 };

  for (const w of words) {
    if (!w.word) continue;
    let cur = root;
    for (const ch of w.word) {
      let nxt = cur.next.get(ch);
      if (!nxt) {
        nxt = { next: new Map(), fail: null, output: [], depth: cur.depth + 1 };
        cur.next.set(ch, nxt);
      }
      cur = nxt;
    }
    cur.output.push(w);
  }

  // BFS 建 fail 指针
  const queue: Node[] = [];
  for (const child of root.next.values()) {
    child.fail = root;
    queue.push(child);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const [ch, child] of node.next.entries()) {
      let f = node.fail;
      while (f && !f.next.has(ch)) f = f.fail;
      child.fail = f ? (f.next.get(ch) ?? root) : root;
      child.output = child.output.concat(child.fail.output);
      queue.push(child);
    }
  }

  return { root };
}

export function search(ac: AC, text: string): ACHit[] {
  const hits: ACHit[] = [];
  let node = ac.root;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (node !== ac.root && !node.next.has(ch)) {
      node = node.fail ?? ac.root;
    }
    node = node.next.get(ch) ?? ac.root;
    if (node.output.length > 0) {
      for (const out of node.output) {
        const to = i + 1;
        const from = to - out.word.length;
        hits.push({ from, to, word: out.word, category: out.category, severity: out.severity });
      }
    }
  }

  hits.sort((a, b) => a.from - b.from || a.to - b.to);
  return hits;
}
```

- [ ] **Step 4: 跑测试,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/web test -- aho-corasick
```

预期:6 条全绿。

- [ ] **Step 5: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/web lint
pnpm --filter @bytedance-aigc/web typecheck
```

- [ ] **Step 6: commit**

```bash
git add apps/web/src/workers/aho-corasick.ts apps/web/src/workers/aho-corasick.test.ts
git commit -m "feat(web): 自写 Aho-Corasick 自动机 + 单测

- buildAC(words) 构建 trie + BFS 建 fail 指针
- search(ac, text) 单次扫描返排序后的 hits
- 单测 6 条:空词库/单词命中/多词/重叠/无命中/emoji surrogate"
```

---

## Task 9: sensitive-scanner.worker + 单测 + Next.js 16 Worker 加载踩点

**Files:**

- Create: `apps/web/src/workers/sensitive-scanner.worker.ts`
- Create: `apps/web/src/workers/sensitive-scanner.test.ts`
- 踩点:`node_modules/next/dist/docs/` 找 Worker 文档

- [ ] **Step 1: 摸 Next.js 16 Worker 文档**

```bash
ls /Users/calvin/Desktop/Project/bytedance-aigc/apps/web/node_modules/next/dist/docs/ 2>/dev/null | head -20
grep -r "new Worker" /Users/calvin/Desktop/Project/bytedance-aigc/apps/web/node_modules/next/dist/docs/ 2>/dev/null | head -10
grep -r "WebWorker" /Users/calvin/Desktop/Project/bytedance-aigc/apps/web/node_modules/next/dist/docs/ 2>/dev/null | head -10
```

预期:Next.js 16 支持 `new Worker(new URL("./xxx.worker.ts", import.meta.url))`,Webpack 5 默认 worker entry 配置已开。如果文档说要 turbo / 特殊 next.config 配置,在 commit message 标注。

- [ ] **Step 2: 写 sensitive-scanner.test.ts(直接测主 logic 函数,不 spawn 真实 Worker)**

`apps/web/src/workers/sensitive-scanner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { handleScanRequest } from "./sensitive-scanner.worker";
import type { SensitiveWordList } from "@bytedance-aigc/shared";

const wordList: SensitiveWordList = {
  version: "test",
  categories: {
    politics: { severity: "high", words: ["敏感词"] },
    pornography: { severity: "high", words: [] },
    gambling: { severity: "high", words: [] },
    drugs: { severity: "high", words: [] },
    vulgarity: { severity: "medium", words: ["俗话"] },
    fraud: { severity: "medium", words: ["秒到账"] },
    medical: { severity: "medium", words: [] },
  },
};

describe("sensitive-scanner.worker (logic)", () => {
  it("空文本 → hits 空", () => {
    const res = handleScanRequest(wordList, { id: "r1", text: "" });
    expect(res).toEqual({ id: "r1", hits: [] });
  });

  it("命中政治高危 + 词库 fraud 中危,各返 1 hit", () => {
    const res = handleScanRequest(wordList, { id: "r2", text: "前缀敏感词后,有秒到账提示" });
    expect(res.id).toBe("r2");
    expect(res.hits).toHaveLength(2);
    const cats = res.hits.map((h) => h.category).sort();
    expect(cats).toEqual(["fraud", "politics"]);
  });

  it("命中 hits 含 from/to/severity", () => {
    const res = handleScanRequest(wordList, { id: "r3", text: "敏感词" });
    expect(res.hits[0]).toMatchObject({
      from: 0,
      to: 3,
      word: "敏感词",
      category: "politics",
      severity: "high",
    });
  });
});
```

- [ ] **Step 3: 跑测,确认 FAIL**

```bash
pnpm --filter @bytedance-aigc/web test -- sensitive-scanner
```

- [ ] **Step 4: 实现 sensitive-scanner.worker.ts**

`apps/web/src/workers/sensitive-scanner.worker.ts`:

```typescript
/// <reference lib="webworker" />

import type { SensitiveWordList } from "@bytedance-aigc/shared";
import { flattenWords } from "@bytedance-aigc/shared";
import { buildAC, search } from "./aho-corasick";
import type { AC, ACHit } from "./aho-corasick";

export interface ScanRequest {
  id: string;
  text: string;
}

export interface ScanResponse {
  id: string;
  hits: ACHit[];
}

type WorkerInbound =
  | { type: "init"; words: SensitiveWordList }
  | { type: "scan"; req: ScanRequest };

type WorkerOutbound = { type: "ready" } | { type: "scan"; res: ScanResponse };

let ac: AC | null = null;

/**
 * 纯函数包装,便于单测;Worker handler 直接复用。
 */
export function handleScanRequest(words: SensitiveWordList, req: ScanRequest): ScanResponse {
  const localAc = buildAC(flattenWords(words));
  const hits = search(localAc, req.text);
  return { id: req.id, hits };
}

// Worker entry — 仅在 worker 上下文执行
declare const self: DedicatedWorkerGlobalScope;
if (
  typeof self !== "undefined" &&
  typeof (self as DedicatedWorkerGlobalScope).postMessage === "function"
) {
  self.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
    const data = ev.data;
    if (data.type === "init") {
      ac = buildAC(flattenWords(data.words));
      const out: WorkerOutbound = { type: "ready" };
      self.postMessage(out);
      return;
    }
    if (data.type === "scan") {
      if (!ac) {
        // 未初始化:返空
        const out: WorkerOutbound = { type: "scan", res: { id: data.req.id, hits: [] } };
        self.postMessage(out);
        return;
      }
      const hits = search(ac, data.req.text);
      const out: WorkerOutbound = { type: "scan", res: { id: data.req.id, hits } };
      self.postMessage(out);
    }
  });
}

export type { WorkerInbound, WorkerOutbound };
```

- [ ] **Step 5: 跑测,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/web test -- sensitive-scanner
```

预期:3 条全绿。

- [ ] **Step 6: vitest 配置确保 Worker 文件不被当成 entrypoint**

如 vitest 报错 "self is not defined",在 `apps/web/vitest.config.ts` 的 `test.environment` 应保持 `jsdom`。若仍报错,把 worker 文件名改 `.worker.ts` 并在 vitest 配置 `test.exclude` 排除真实 Worker 上下文(单测只调 `handleScanRequest`)。

- [ ] **Step 7: commit**

```bash
git add apps/web/src/workers/sensitive-scanner.worker.ts apps/web/src/workers/sensitive-scanner.test.ts
git commit -m "feat(web): sensitive-scanner Web Worker + handleScanRequest 单测

- worker 接 init(注入词库)/ scan(扫描请求)消息
- handleScanRequest 纯函数包装供单测,不依赖 self
- Aho-Corasick build 在 init 时一次摊销,scan 仅 search"
```

---

## Task 10: review-decorations.ts(ProseMirror Plugin) + 单测

**Files:**

- Create: `apps/web/src/lib/tiptap/review-decorations.ts`
- Create: `apps/web/src/lib/tiptap/review-decorations.test.tsx`

- [ ] **Step 1: 写单测(先红)**

`apps/web/src/lib/tiptap/review-decorations.test.tsx`:

```typescript
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ReviewDecorationsExt, dispatchSetViolations } from "./review-decorations";
import type { Violation } from "./review-decorations";

describe("ReviewDecorationsExt", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit, ReviewDecorationsExt],
      content: "<p>Hello sensitive world</p>",
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("初始无 violations", () => {
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation").length).toBe(0);
  });

  it("setWordViolations:渲染对应 decoration", () => {
    const violations: Violation[] = [
      {
        id: "v1",
        from: 7,
        to: 16,
        severity: "high",
        category: "vulgarity",
        source: "word",
        message: "test",
      },
    ];
    dispatchSetViolations(editor, "word", violations);
    const dom = editor.view.dom as HTMLElement;
    const els = dom.querySelectorAll(".review-violation--word");
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it("clear 清空指定 source 的 decoration", () => {
    dispatchSetViolations(editor, "word", [
      {
        id: "v1",
        from: 1,
        to: 4,
        severity: "low",
        category: "vulgarity",
        source: "word",
        message: "",
      },
    ]);
    dispatchSetViolations(editor, "word", []);
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation--word").length).toBe(0);
  });

  it("section 与 word 互不影响", () => {
    dispatchSetViolations(editor, "word", [
      {
        id: "v1",
        from: 1,
        to: 3,
        severity: "low",
        category: "vulgarity",
        source: "word",
        message: "",
      },
    ]);
    dispatchSetViolations(editor, "section", [
      {
        id: "v2",
        from: 5,
        to: 8,
        severity: "high",
        category: "politics",
        source: "section",
        message: "",
      },
    ]);
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelectorAll(".review-violation--word").length).toBeGreaterThanOrEqual(1);
    expect(dom.querySelectorAll(".review-violation--section").length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 实现 review-decorations.ts**

`apps/web/src/lib/tiptap/review-decorations.ts`:

```typescript
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
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
```

- [ ] **Step 3: 跑测,验证 PASS**

```bash
pnpm --filter @bytedance-aigc/web test -- review-decorations
```

预期:4 条全绿。

- [ ] **Step 4: 加 CSS 样式**

`apps/web/src/app/globals.css`(找到现有样式块末尾)追加:

```css
.review-violation {
  text-decoration-style: wavy;
  text-decoration-line: underline;
  text-underline-offset: 3px;
  cursor: help;
}
.review-violation--low {
  text-decoration-color: #a3a3a3;
}
.review-violation--medium {
  text-decoration-color: #f59e0b;
}
.review-violation--high {
  text-decoration-color: #dc2626;
}
.review-violation--section {
  background-color: rgba(220, 38, 38, 0.06);
  border-left: 3px solid #dc2626;
  padding-left: 6px;
}
```

- [ ] **Step 5: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/web lint
pnpm --filter @bytedance-aigc/web typecheck
```

- [ ] **Step 6: commit**

```bash
git add apps/web/src/lib/tiptap/review-decorations.ts apps/web/src/lib/tiptap/review-decorations.test.tsx apps/web/src/app/globals.css
git commit -m "feat(web): review-decorations ProseMirror Plugin + CSS

- ReviewDecorationsExt:state 按 source 分(word/section),互不覆盖
- dispatchSetViolations(editor, source, list) 通过 tr.setMeta 切换
- 越界 from/to 自动 drop;range 0 长度 drop
- CSS 波浪线 3 色 + section 红框
- 单测 4 条:初始空 / word 渲染 / clear / word+section 共存"
```

---

## Task 11: use-sensitive-scan + 接入 TiptapBody

**Files:**

- Create: `apps/web/src/hooks/use-sensitive-scan.ts`
- Modify: `apps/web/src/components/tiptap-body.tsx`(挂 ReviewDecorationsExt + 接 hook)

- [ ] **Step 1: 写 hook**

`apps/web/src/hooks/use-sensitive-scan.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { loadSensitiveWords } from "@bytedance-aigc/shared";

import { dispatchSetViolations, type Violation } from "@/lib/tiptap/review-decorations";
import type { WorkerInbound, WorkerOutbound } from "@/workers/sensitive-scanner.worker";

const DEBOUNCE_MS = 1500;

/**
 * 启动 Worker、注入词库;TipTap update 1.5s 防抖后投递扫描请求。
 * Worker 失败 → silent no-op。
 */
export function useSensitiveScan(editor: Editor | null): void {
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!editor) return;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../workers/sensitive-scanner.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (err) {
      console.warn("[use-sensitive-scan] Worker 不支持,降级 no-op:", err);
      return;
    }

    workerRef.current = worker;
    const initMsg: WorkerInbound = { type: "init", words: loadSensitiveWords() };
    worker.postMessage(initMsg);

    worker.addEventListener("message", (ev: MessageEvent<WorkerOutbound>) => {
      const data = ev.data;
      if (data.type !== "scan") return;
      const violations: Violation[] = data.res.hits.map((h, idx) => ({
        id: `word-${data.res.id}-${idx}`,
        from: h.from,
        to: h.to,
        severity: h.severity,
        category: h.category,
        source: "word",
        message: `${h.category}:${h.word}`,
      }));
      dispatchSetViolations(editor, "word", violations);
    });

    const handleUpdate = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const text = editor.getText();
        const id = `r${++reqIdRef.current}`;
        const msg: WorkerInbound = { type: "scan", req: { id, text } };
        worker?.postMessage(msg);
      }, DEBOUNCE_MS);
    };

    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
      if (timerRef.current) clearTimeout(timerRef.current);
      worker?.terminate();
      workerRef.current = null;
    };
  }, [editor]);
}
```

- [ ] **Step 2: 接入 TiptapBody**

修改 `apps/web/src/components/tiptap-body.tsx`:

(a) import 区追加:

```typescript
import { ReviewDecorationsExt } from "@/lib/tiptap/review-decorations";
import { useSensitiveScan } from "@/hooks/use-sensitive-scan";
```

(b) `useEditor.extensions` 改为:

```typescript
extensions: [StarterKit, ReviewDecorationsExt],
```

(c) 在 `useEffect(() => { onReady?.(editor); ... })` 之后调用 hook:

```typescript
useSensitiveScan(editor);
```

- [ ] **Step 3: 跑既有单测,确认 TiptapBody 没破**

```bash
pnpm --filter @bytedance-aigc/web test
```

预期:既有单测全绿。

- [ ] **Step 4: lint + typecheck**

```bash
pnpm --filter @bytedance-aigc/web lint
pnpm --filter @bytedance-aigc/web typecheck
```

- [ ] **Step 5: commit**

```bash
git add apps/web/src/hooks/use-sensitive-scan.ts apps/web/src/components/tiptap-body.tsx
git commit -m "feat(web): use-sensitive-scan 接入 TiptapBody

- 启动 Worker + 注入静态词库
- editor on('update') 1.5s 防抖 → postMessage scan
- 收到响应 → dispatchSetViolations(word)
- Worker 失败 silent no-op,console.warn"
```

---

## Task 12: use-prompt-review + PromptReviewBanner + 接入 FastModeDialog

**Files:**

- Create: `apps/web/src/hooks/use-prompt-review.ts`
- Create: `apps/web/src/app/drafts/[id]/_components/PromptReviewBanner.tsx`
- Modify: `apps/web/src/app/drafts/[id]/_components/FastModeDialog.tsx`

- [ ] **Step 1: 写 hook**

`apps/web/src/hooks/use-prompt-review.ts`:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";
import type { PromptReviewResponse } from "@bytedance-aigc/shared";

import { apiFetch } from "@/lib/auth";

const DEBOUNCE_MS = 800;

export interface UsePromptReviewState {
  loading: boolean;
  result: PromptReviewResponse | null;
  trigger: (text: string) => void;
  dismiss: () => void;
}

/**
 * topic / hint 失焦 800ms 防抖 → POST /reviews/prompt。
 * 同 sessionId 内连续多次失焦合并为一次审核。
 */
export function usePromptReview(): UsePromptReviewState {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptReviewResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const trigger = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length === 0) {
      setResult(null);
      return;
    }
    timerRef.current = setTimeout(async () => {
      inflightRef.current?.abort();
      const ac = new AbortController();
      inflightRef.current = ac;
      setLoading(true);
      try {
        const res = await apiFetch("/reviews/prompt", {
          method: "POST",
          body: JSON.stringify({ text: text.trim() }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setResult(null);
          return;
        }
        const body = (await res.json()) as PromptReviewResponse;
        if (body.recommendation !== "ALLOW") {
          setResult(body);
        } else {
          setResult(null);
        }
      } catch {
        // abort 或网络错误 → silent
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const dismiss = useCallback(() => {
    setResult(null);
  }, []);

  return { loading, result, trigger, dismiss };
}
```

**注**:`apiFetch` 现签名见 `apps/web/src/lib/auth.ts`,需检查是否支持 `signal` 选项;若不支持,将 `signal: ac.signal` 行删掉,改为前端只用 timer 自抢占。

- [ ] **Step 2: 写 PromptReviewBanner 组件**

`apps/web/src/app/drafts/[id]/_components/PromptReviewBanner.tsx`:

```typescript
"use client";

import type { PromptReviewResponse } from "@bytedance-aigc/shared";

interface Props {
  result: PromptReviewResponse;
  onDismiss: () => void;
  onChangeAngle: () => void;
}

export function PromptReviewBanner({ result, onDismiss, onChangeAngle }: Props) {
  const tone =
    result.recommendation === "BLOCK"
      ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200"
      : "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200";

  return (
    <div
      role="alert"
      className={`mt-2 rounded border-l-4 px-3 py-2 text-sm flex items-start gap-3 ${tone}`}
    >
      <div className="flex-1">
        <div className="font-medium">
          {result.recommendation === "BLOCK" ? "选题风险较高" : "选题需注意"}
        </div>
        <div className="mt-0.5">{result.message}</div>
        {result.hitCategories.length > 0 && (
          <div className="mt-0.5 text-xs opacity-75">
            涉及类目:{result.hitCategories.join("、")}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="text-xs rounded border border-current px-2 py-0.5 hover:bg-white/30"
          onClick={onChangeAngle}
        >
          换角度
        </button>
        <button
          type="button"
          className="text-xs rounded px-2 py-0.5 hover:bg-white/30"
          onClick={onDismiss}
        >
          有把握继续
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 接入 FastModeDialog**

修改 `apps/web/src/app/drafts/[id]/_components/FastModeDialog.tsx`:

(a) import 区追加:

```typescript
import { usePromptReview } from "@/hooks/use-prompt-review";
import { PromptReviewBanner } from "./PromptReviewBanner";
```

(b) 在 `const [submitting, setSubmitting] = ...` 后加:

```typescript
const promptReview = usePromptReview();
const composedText = (): string => `${topic.trim()}\n${hint.trim()}`.trim();
```

(c) 给 input(第 58-65 行)和 textarea(第 68-75 行)加 `onBlur`:

```tsx
<input
  type="text"
  value={topic}
  onChange={(e) => setTopic(e.target.value)}
  onBlur={() => promptReview.trigger(composedText())}
  className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:border-zinc-500"
  placeholder="例:5G-A 商用启动"
/>
```

```tsx
<textarea
  value={hint}
  onChange={(e) => setHint(e.target.value)}
  onBlur={() => promptReview.trigger(composedText())}
  rows={3}
  className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:border-zinc-500"
  placeholder="例:请聚焦运营商成本下降的具体数据"
/>
```

(d) 在 `{error && ...}` 之上、按钮 div 之上,挂 banner:

```tsx
{
  promptReview.result && (
    <PromptReviewBanner
      result={promptReview.result}
      onDismiss={promptReview.dismiss}
      onChangeAngle={() => {
        setTopic("");
        setHint("");
        promptReview.dismiss();
      }}
    />
  );
}
```

- [ ] **Step 4: lint + typecheck + 既有单测**

```bash
pnpm --filter @bytedance-aigc/web lint
pnpm --filter @bytedance-aigc/web typecheck
pnpm --filter @bytedance-aigc/web test
```

- [ ] **Step 5: commit**

```bash
git add apps/web/src/hooks/use-prompt-review.ts apps/web/src/app/drafts/[id]/_components/PromptReviewBanner.tsx apps/web/src/app/drafts/[id]/_components/FastModeDialog.tsx
git commit -m "feat(web): ① Prompt 阶段审核接入 FastModeDialog

- usePromptReview hook:topic/hint 失焦 800ms 防抖,合并发起
- PromptReviewBanner 组件:三色边框 + 换角度/有把握继续
- 仅在 recommendation !== ALLOW 时弹 banner;ALLOW 不打扰
- 不阻断生成大纲(PRD §4.1.1 末)"
```

---

## Task 13: use-section-review + SectionReviewCard + 接入 SectionStream

**Files:**

- Create: `apps/web/src/hooks/use-section-review.ts`
- Create: `apps/web/src/app/drafts/[id]/_components/SectionReviewCard.tsx`
- Modify: `apps/web/src/app/drafts/[id]/_components/SectionStream.tsx`

- [ ] **Step 1: 写 hook**

`apps/web/src/hooks/use-section-review.ts`:

```typescript
"use client";

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { SectionReviewResponse } from "@bytedance-aigc/shared";

import { apiFetch } from "@/lib/auth";
import { dispatchSetViolations, type Violation } from "@/lib/tiptap/review-decorations";

export interface SectionReviewItem {
  range: { from: number; to: number };
  result: SectionReviewResponse;
}

export interface UseSectionReviewState {
  items: SectionReviewItem[];
  reviewSection: (input: {
    draftId: string;
    sessionId: string;
    range: { from: number; to: number };
    text: string;
  }) => Promise<SectionReviewResponse | null>;
  reset: () => void;
}

/**
 * fire-and-forget 段落审核;命中 → dispatchSetViolations(section)。
 * 返回 result 给调用方判断 abortStream。
 */
export function useSectionReview(editor: Editor | null): UseSectionReviewState {
  const [items, setItems] = useState<SectionReviewItem[]>([]);
  const violationsRef = useRef<Violation[]>([]);

  const reviewSection: UseSectionReviewState["reviewSection"] = useCallback(
    async (input) => {
      try {
        const res = await apiFetch("/reviews/section", {
          method: "POST",
          body: JSON.stringify(input),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as SectionReviewResponse;
        if (body.recommendation !== "ALLOW" && editor) {
          const v: Violation = {
            id: body.reviewId || `sect-${input.range.from}-${input.range.to}`,
            from: input.range.from,
            to: Math.min(input.range.to, editor.state.doc.content.size),
            severity: body.severity,
            category: body.hitCategories[0] ?? "section",
            source: "section",
            message: body.message,
          };
          if (v.from < v.to) {
            violationsRef.current = [...violationsRef.current, v];
            dispatchSetViolations(editor, "section", violationsRef.current);
            setItems((prev) => [...prev, { range: input.range, result: body }]);
          }
        }
        return body;
      } catch {
        return null;
      }
    },
    [editor],
  );

  const reset = useCallback(() => {
    violationsRef.current = [];
    setItems([]);
    if (editor) dispatchSetViolations(editor, "section", []);
  }, [editor]);

  return { items, reviewSection, reset };
}
```

- [ ] **Step 2: 写 SectionReviewCard 组件**

`apps/web/src/app/drafts/[id]/_components/SectionReviewCard.tsx`:

```typescript
"use client";

import type { SectionReviewItem } from "@/hooks/use-section-review";

interface Props {
  item: SectionReviewItem;
  onRegenerate: (range: { from: number; to: number }) => void;
  onSuggest: () => void;
  onKeep: () => void;
}

export function SectionReviewCard({ item, onRegenerate, onSuggest, onKeep }: Props) {
  const tone =
    item.result.severity === "high"
      ? "border-red-500 bg-red-50 dark:bg-red-950/40"
      : "border-amber-500 bg-amber-50 dark:bg-amber-950/40";

  return (
    <div className={`mt-2 rounded border-l-4 px-3 py-2 text-sm ${tone}`}>
      <div className="font-medium">段落风险:{item.result.message}</div>
      {item.result.hitCategories.length > 0 && (
        <div className="text-xs opacity-75 mt-0.5">
          涉及:{item.result.hitCategories.join("、")}
        </div>
      )}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="text-xs rounded border border-current px-2 py-0.5"
          onClick={() => onRegenerate(item.range)}
        >
          重新生成
        </button>
        <button type="button" className="text-xs rounded px-2 py-0.5" onClick={onSuggest}>
          修改建议
        </button>
        <button type="button" className="text-xs rounded px-2 py-0.5 opacity-75" onClick={onKeep}>
          仍要保留
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 接入 SectionStream**

修改 `apps/web/src/app/drafts/[id]/_components/SectionStream.tsx`:

(a) Props 加 `editor`(已有)+ 内部用 `useSectionReview`:

```typescript
import { useMemo, useRef, useState } from "react";
import { useSectionReview } from "@/hooks/use-section-review";
import { SectionReviewCard } from "./SectionReviewCard";
```

(b) component 内顶部加:

```typescript
const review = useSectionReview(editor);
const sessionIdRef = useRef<string>(`sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
```

(c) `onSectionEnd` 里改写为(替换原本 `onSectionEnd: () => { editor.chain()...insertContent({type:"paragraph"}).run(); }`):

```typescript
          onSectionEnd: () => {
            // 段落落地,记录 range 并 fire-and-forget 审核
            const to = editor.state.doc.content.size;
            const from = sectionEnds.length > 0 ? sectionEnds[sectionEnds.length - 1] : 0;
            sectionEnds.push(to);

            // 取段落文本
            const text = editor.state.doc.textBetween(from, to, "\n");
            void review
              .reviewSection({
                draftId,
                sessionId: sessionIdRef.current,
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
```

注:`sectionEnds.push(editor.state.doc.content.size);` 那行原本在 `onSectionStart`,本改后在 `onSectionEnd` 也 push;为避免和 `onSectionStart` 重复 push,审视原文件:`onSectionStart` 把 heading 插入后 push 一次(spec §D-B6 假设);现在我们仅在 `onSectionEnd` 用前一个 push 的值作为 from。**修正**:不动 `onSectionStart` 的 push,在 `onSectionEnd` 仅读不 push。重写如下:

```typescript
          onSectionEnd: () => {
            const to = editor.state.doc.content.size;
            const from = sectionEnds.length > 0 ? sectionEnds[sectionEnds.length - 1] : 0;
            const text = editor.state.doc.textBetween(from, to, "\n");
            void review
              .reviewSection({
                draftId,
                sessionId: sessionIdRef.current,
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
```

(d) 渲染区追加 cards:

```tsx
{
  review.items.map((item, idx) => (
    <SectionReviewCard
      key={`${item.range.from}-${item.range.to}-${idx}`}
      item={item}
      onRegenerate={() => {
        // 占位:Phase 2.5 不真正重生成;Phase 2.6 接 sections/stream 部分重做
        console.log("regenerate", item.range);
      }}
      onSuggest={() => console.log("suggest", item.range)}
      onKeep={() => console.log("keep", item.range)}
    />
  ));
}
```

- [ ] **Step 4: lint + typecheck + 既有单测**

```bash
pnpm --filter @bytedance-aigc/web lint
pnpm --filter @bytedance-aigc/web typecheck
pnpm --filter @bytedance-aigc/web test
```

- [ ] **Step 5: commit**

```bash
git add apps/web/src/hooks/use-section-review.ts apps/web/src/app/drafts/[id]/_components/SectionReviewCard.tsx apps/web/src/app/drafts/[id]/_components/SectionStream.tsx
git commit -m "feat(web): ③ 段落审核接入 SectionStream

- useSectionReview:fire-and-forget POST /reviews/section
- 命中 → dispatchSetViolations(section) 红框 + 加 SectionReviewCard
- abortStream=true → setErrMsg + stop() 中断 SSE
- 卡片 3 占位按钮(重新生成/修改建议/仍要保留)Phase 2.5 仅 console.log
- sessionId 一次生成实例;每次新流式重置"
```

---

## Task 14: rules yaml 完整填(每类 ≥ 10 条规则)

**Files:**

- Modify: `packages/shared/rules/{politics,pornography,gambling,drugs,vulgarity,fraud,medical}.yaml`

**目标:** 每个 yaml 从 1 条占位扩充到 ≥ 10 条规则,positive/negative 样本各 ≥ 3 条/规则;规则 id 自增 `SEC-<CAT>-001` ... `SEC-<CAT>-010+`。

- [ ] **Step 1: 写 politics.yaml(10 条规则)**

完整覆盖维度:领导人调侃 / 涉港台/疆 / 涉政体制嘲讽 / 历史事件不当言论 / 社运煽动 / 民族矛盾 / 涉台独藏独 / 政治阴谋论 / 政府政策恶意嘲讽 / 涉外关系敏感。

每条规则模板:

```yaml
- rule_id: SEC-POLITICS-002
  category: politics
  severity: high
  description: <一句话描述>
  prompt_hint: |
    若文本包含 ...,判 high;含 ... 判 medium。
  examples_positive:
    - "(写 3 条具体应被命中样本,不必真敏感,可用占位描述)"
    - "..."
    - "..."
  examples_negative:
    - "(写 3 条应被放过的样本)"
    - "..."
    - "..."
```

— 实施时由用户(PE 角色)填具体内容;**plan 不堆 30 段 yaml**(空间太占,且具体词条属运营性内容)。

- [ ] **Step 2: 同样填 pornography / gambling / drugs / vulgarity / fraud / medical(各 ≥ 10 条规则)**

- [ ] **Step 3: 跑 rule-loader 单测验证结构**

```bash
pnpm --filter @bytedance-aigc/api test -- rule-loader
```

预期:3 条全绿。

- [ ] **Step 4: commit**

```bash
git add packages/shared/rules
git commit -m "feat(shared): rules yaml 7 类目 × 10+ 条规则填全

每类目至少 10 条规则,每条规则 ≥ 3 条 positive/negative 样本。
规则源:PRD §4.4 平台合规导向 + 国家网信办公开规范 + 头条创作者规范。"
```

---

## Task 15: 300 条标注集

**Files:**

- Create: `apps/api/test/fixtures/safety-eval/{politics,pornography,gambling,drugs,vulgarity,fraud,medical}.jsonl`
- Create: `apps/api/test/fixtures/safety-eval/allow.jsonl`(≥ 50 条 ALLOW 负样本)

每行格式:

```json
{
  "text": "...",
  "expected_recommendation": "BLOCK",
  "expected_categories": ["politics"],
  "source": "manual"
}
```

数量:politics/pornography/gambling/drugs 各 ≥ 50 条 / vulgarity/fraud/medical 各 ≥ 30 条 / allow.jsonl ≥ 50 条 → 总 ≥ 350 条。

- [ ] **Step 1: 建 jsonl 骨架**

每文件先放 5 条占位:

```jsonl
{"text":"占位敏感样本 1","expected_recommendation":"BLOCK","expected_categories":["politics"],"source":"manual"}
{"text":"占位敏感样本 2","expected_recommendation":"WARN","expected_categories":["politics"],"source":"manual"}
{"text":"占位中性样本","expected_recommendation":"ALLOW","expected_categories":[],"source":"manual"}
```

- [ ] **Step 2: 实施时由用户分批补全(可借助开源数据集 + 手筛)**

每批 ≥ 50 条提交一次 commit,避免单 PR 巨大。

- [ ] **Step 3: 数量校验脚本(可选,但建议)**

`apps/api/scripts/eval-fixtures-count.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..", "test", "fixtures", "safety-eval");
const min: Record<string, number> = {
  "politics.jsonl": 50,
  "pornography.jsonl": 50,
  "gambling.jsonl": 50,
  "drugs.jsonl": 50,
  "vulgarity.jsonl": 30,
  "fraud.jsonl": 30,
  "medical.jsonl": 30,
  "allow.jsonl": 50,
};

let fail = false;
for (const file of readdirSync(dir)) {
  const lines = readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean);
  const need = min[file] ?? 0;
  console.log(`${file}: ${lines.length}/${need}`);
  if (lines.length < need) {
    fail = true;
    console.error(`  ✗ 不足 ${need} 条`);
  }
}
process.exit(fail ? 1 : 0);
```

跑:

```bash
pnpm --filter @bytedance-aigc/api exec ts-node --compiler-options '{"module":"CommonJS"}' scripts/eval-fixtures-count.ts
```

- [ ] **Step 4: commit(分多次,每补一批 commit 一次)**

```bash
git add apps/api/test/fixtures/safety-eval apps/api/scripts/eval-fixtures-count.ts
git commit -m "test(api): 安全审核 300 标注集 + 数量校验脚本

7 类目 jsonl + allow.jsonl(50+),expected_recommendation 三态标注。
后续可用 eval:safety 跑全集计算 Precision/Recall/F1。"
```

---

## Task 16: eval-safety 脚本 + 跑 + commit 报告

**Files:**

- Create: `apps/api/scripts/eval-safety.ts`
- Create: `docs/perf/safety-eval-2026-06-XX.md`(脚本生成)
- Modify: `apps/api/package.json`(加 `eval:safety` script)

- [ ] **Step 1: 写脚本**

`apps/api/scripts/eval-safety.ts`:

```typescript
import { NestFactory } from "@nestjs/core";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { AppModule } from "../src/app.module";
import { ReviewService } from "../src/reviews/review.service";

interface Sample {
  text: string;
  expected_recommendation: "ALLOW" | "WARN" | "BLOCK";
  expected_categories: string[];
  source: string;
}

interface ResultRow {
  category: string;
  total: number;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}

async function main(): Promise<void> {
  const fixturesDir = join(__dirname, "..", "test", "fixtures", "safety-eval");
  const reportsDir = join(__dirname, "..", "..", "..", "docs", "perf");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const reviews = app.get(ReviewService);

  const cats = ["politics", "pornography", "gambling", "drugs", "vulgarity", "fraud", "medical"];
  const rows: ResultRow[] = [];
  let totalTP = 0,
    totalFN = 0,
    totalFP = 0,
    totalTN = 0;

  for (const cat of cats) {
    const samples = readSamples(join(fixturesDir, `${cat}.jsonl`));
    const allowSamples = readSamples(join(fixturesDir, "allow.jsonl"));
    const merged = [...samples, ...allowSamples.map((s) => ({ ...s, _negativeOf: cat }))];

    let tp = 0,
      fn = 0,
      fp = 0,
      tn = 0;
    for (const s of merged) {
      const res = await reviews.reviewPrompt(s.text, "demo-author");
      const isHit = res.recommendation !== "ALLOW" && res.hitCategories.includes(cat);
      const expectedHit =
        s.expected_recommendation !== "ALLOW" && s.expected_categories.includes(cat);

      if (expectedHit && isHit) tp++;
      else if (expectedHit && !isHit) fn++;
      else if (!expectedHit && isHit) fp++;
      else tn++;
    }
    rows.push({ category: cat, total: merged.length, tp, fn, fp, tn });
    totalTP += tp;
    totalFN += fn;
    totalFP += fp;
    totalTN += tn;
  }

  const md = renderReport(rows, totalTP, totalFN, totalFP, totalTN);
  const date = new Date().toISOString().slice(0, 10);
  const out = join(reportsDir, `safety-eval-${date}.md`);
  writeFileSync(out, md, "utf8");
  console.log(`报告写入: ${out}`);
  await app.close();
}

function readSamples(path: string): Sample[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Sample);
}

function renderReport(rows: ResultRow[], tp: number, fn: number, fp: number, tn: number): string {
  const f = (a: number, b: number) => (b === 0 ? 0 : a / b);
  const lines: string[] = [];
  lines.push(`# 安全审核准确率报告 (${new Date().toISOString().slice(0, 10)})`);
  lines.push("");
  lines.push("| 类目 | 样本数 | TP | FN | FP | TN | Precision | Recall | F1 |");
  lines.push("|------|--------|----|----|----|----|-----------|--------|----|");
  for (const r of rows) {
    const p = f(r.tp, r.tp + r.fp);
    const rc = f(r.tp, r.tp + r.fn);
    const f1 = p + rc === 0 ? 0 : (2 * p * rc) / (p + rc);
    lines.push(
      `| ${r.category} | ${r.total} | ${r.tp} | ${r.fn} | ${r.fp} | ${r.tn} | ${p.toFixed(3)} | ${rc.toFixed(3)} | ${f1.toFixed(3)} |`,
    );
  }
  const total = tp + fn + fp + tn;
  const acc = total === 0 ? 0 : (tp + tn) / total;
  const p = f(tp, tp + fp);
  const rc = f(tp, tp + fn);
  const f1 = p + rc === 0 ? 0 : (2 * p * rc) / (p + rc);
  lines.push("");
  lines.push("## 总体");
  lines.push(`- Accuracy: ${acc.toFixed(3)}`);
  lines.push(`- Precision: ${p.toFixed(3)}`);
  lines.push(`- Recall: ${rc.toFixed(3)}`);
  lines.push(`- F1: ${f1.toFixed(3)}`);
  lines.push("");
  lines.push(`**目标:** Accuracy ≥ 0.90;实际 ${acc >= 0.9 ? "✅ 达标" : "⚠ 未达标,需调 Prompt"}`);
  return lines.join("\n");
}

void main();
```

- [ ] **Step 2: 加 npm script**

`apps/api/package.json` `scripts` 块加:

```json
    "eval:safety": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' scripts/eval-safety.ts"
```

- [ ] **Step 3: 跑脚本**

```bash
# 需要 docker postgres + 真实 LLM key,所以这步在 .env 已配 LLM_API_KEY 的环境跑
pnpm --filter @bytedance-aigc/api eval:safety
```

预期:控制台输出 `报告写入: ...safety-eval-2026-06-XX.md`。LLM 费用 ≈ $1-3。

- [ ] **Step 4: 看报告决定是否调 Prompt**

```bash
cat /Users/calvin/Desktop/Project/bytedance-aigc/docs/perf/safety-eval-2026-06-*.md
```

若 Accuracy < 0.90:

1. 看哪类 Recall 低 → 该类 yaml 加 prompt_hint 细化 + 加 examples_positive
2. 看哪类 Precision 低 → 该类 yaml 加 examples_negative
3. fixtures 重 seed(若改了 SAFETY_REVIEW / PROMPT_REVIEW 的 systemPrompt):
   ```bash
   pnpm --filter @bytedance-aigc/api exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
   ```
4. 重跑 eval:safety
5. 迭代直到 ≥ 0.90 或确认达不到(在报告里诚实标注)

- [ ] **Step 5: commit 最终报告**

```bash
git add docs/perf apps/api/scripts/eval-safety.ts apps/api/package.json
git commit -m "test(api): 安全审核准确率报告 + eval:safety 脚本

- eval:safety 启 NestApplicationContext + 跑 ReviewService.reviewPrompt 全集
- 输出 docs/perf/safety-eval-YYYY-MM-DD.md(类目级 P/R/F1 + 总体 Accuracy)
- 本次实测 Accuracy = X.XXX(交付物 #3 / #4 硬证据)"
```

---

## Task 17: README 加 Phase 2.5 小节 + 收尾静态五连 + 全 e2e

**Files:**

- Modify: `README.md`
- 跑全仓静态五连 + e2e

- [ ] **Step 1: README 追加 Phase 2.5 小节**

在 `README.md` 的 Phase 2.4 信息流分发小节之后追加:

```markdown
### Phase 2.5 — 三阶段内容审核 + 规则库 + 准确率验证

PDF §4.1.1-4.1.3 三阶段审核全部接通:

- **① Prompt 阶段**:`FastModeDialog` 中 topic / hint 失焦 800ms 防抖触发 `POST /reviews/prompt`,LLM 7 类目审核(politics / pornography / gambling / drugs / vulgarity / fraud / medical),命中 BLOCK / WARN 弹 `PromptReviewBanner`,作者可"换角度"或"有把握继续"
- **② 输入阶段**:TipTap `update` 1.5s 防抖,`sensitive-scanner.worker.ts` Web Worker 内自写 Aho-Corasick 自动机扫描静态词库(`packages/shared/src/sensitive-words.json`),命中通过 `review-decoration` ProseMirror 插件渲染红/橙/灰波浪线,主线程零阻塞
- **③ 生成中阶段**:`SectionStream.onSectionEnd` fire-and-forget `POST /reviews/section`,命中 → 段落红框 + `SectionReviewCard`(重新生成 / 修改建议 / 仍要保留);`StreamSessionStore` 记录同 sessionId 连续违规,≥ 3 段 high → `abortStream=true` 中断流式

#### 规则库 §4.4

- 位置:[`packages/shared/rules/`](./packages/shared/rules/) 7 个 yaml(politics / pornography / gambling / drugs / vulgarity / fraud / medical)
- schema:`rule_id` / `category` / `severity` / `description` / `prompt_hint` / `examples_positive` / `examples_negative`
- review.service 启动时 `loadRules()` 加载并缓存,审核请求时 `buildPromptHints()` 拼接到 system message
- 词库:[`packages/shared/src/sensitive-words.json`](./packages/shared/src/sensitive-words.json) 7 类目静态 JSON,Worker 启动一次性注入

#### 准确率指标 §4.4.3

- 标注集:[`apps/api/test/fixtures/safety-eval/`](./apps/api/test/fixtures/safety-eval/) 7 类目 × ≥ 30 条 + allow.jsonl × ≥ 50 条,共 ≥ 350 条
- 跑评估:`pnpm --filter @bytedance-aigc/api eval:safety`(消耗 LLM 配额)
- 最新报告:[`docs/perf/safety-eval-2026-06-XX.md`](./docs/perf/) 类目级 P/R/F1 + 总体 Accuracy
- **目标 Accuracy ≥ 90%**(PDF §4.4.3 硬指标)
```

- [ ] **Step 2: 全仓静态五连**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

预期:全绿。test 数量大致 = api(30+ 单测,新增 7+)+ web(12+ 既有 + 新增 13:aho-corasick 6 + sensitive-scanner 3 + review-decorations 4)。

- [ ] **Step 3: 全 e2e**

```bash
pnpm --filter @bytedance-aigc/api test:e2e
```

预期:既有 49(Phase 2.4 末态)+ Phase 2.5 prompt 4 + section 5 = 58 条全绿。

- [ ] **Step 4: 浏览器手测 8 步**

需要本地起 docker postgres + redis + LLM key:

```bash
docker compose up -d
pnpm --filter @bytedance-aigc/api start:dev &
pnpm --filter @bytedance-aigc/web dev
```

人工验证清单:

1. 登录 → 进 `/drafts/[id]` 创建草稿
2. 打开 FastModeDialog,在 topic 填"领导人调侃"敏感选题,失焦 → 800ms 后看到 PromptReviewBanner red
3. 点"有把握继续" → banner 消失,按"生成大纲"仍可走通
4. 在编辑器输入含词库测试词的段落 → 1.5s 后看到红波浪
5. 走 FAST 模式生成正文 → 段落落地后红框出现(若 LLM 命中)
6. 故意构造连续 3 段 high → SectionStream 自动 stop,显示"已中断"
7. 改 topic 为正常选题 → banner 不再出现
8. 切换 Theme(若有暗色模式)看波浪线/边框颜色对比

- [ ] **Step 5: commit**

```bash
git add README.md
git commit -m "docs(readme): Phase 2.5 三阶段审核 + 规则库 + 准确率小节"
```

- [ ] **Step 6: push 到 origin/main**

```bash
git push origin main
```

观察 CI 全绿(lint / typecheck / test / build 四关 + Phase 2.4 后已修复的 prisma generate 顺序)。

---

## Task 18: 学习笔记追写

**Files:**

- Modify: `/Users/calvin/Desktop/Project/bytedance-aigc-notes/notes-02.md`(若 < 1500 行)
- 或 Create: `/Users/calvin/Desktop/Project/bytedance-aigc-notes/notes-03.md`(若 02 ≥ 1500 行)

- [ ] **Step 1: 检查 notes-02.md 行数**

```bash
wc -l /Users/calvin/Desktop/Project/bytedance-aigc-notes/notes-02.md
```

- [ ] **Step 2: 追写或新开**

按既有节奏,新开一章 "第 N+? 课:三阶段审核接入与准确率验证",至少覆盖以下教学点:

1. **多阶段审核共用 service 的取舍**:为何 reviewPrompt 不落库而 reviewSection 落库 → 数据库压力 + 审计价值取舍
2. **Web Worker 在 Next.js 16 App Router 的踩点**:`new Worker(new URL(...), { type: "module" })` + Webpack/Turbopack 的差异
3. **Aho-Corasick 自写收益**:相比库的 50 行自由度,关于 fail 指针 BFS 的直觉
4. **ProseMirror Plugin state apply meta 模式**:为何不用 React state 而用 transaction meta 同步 decoration
5. **3 段 high 中断 = 内存级 vs Redis**:why 30min TTL 内存级方案对 3 周 demo 项目最优
6. **300 条标注集为何不进 CI**:LLM 抖动 + 费用,以及"发布前手动跑 + commit 报告"的工程取舍
7. **诚实交付**:Accuracy < 90% 时不硬刷数据,而是在报告里标注差距 — 工程价值观

- [ ] **Step 3: commit notes 仓库(单独仓库,不影响主项目)**

```bash
cd /Users/calvin/Desktop/Project/bytedance-aigc-notes
git add notes-02.md  # 或 notes-03.md
git commit -m "docs: 第 N+? 课 — Phase 2.5 三阶段审核接入与准确率验证"
```

---

## 收尾归档(由本 plan 之外的常规收尾流程触发)

完成全部 18 task + push 后,按既有惯例:

```bash
git mv docs/superpowers/specs/2026-06-06-phase-2-5-five-stage-review-design.md docs/superpowers/specs/shipped/
git mv docs/superpowers/plans/2026-06-06-phase-2-5-five-stage-review.md docs/superpowers/plans/shipped/
git commit -m "chore(docs): 归档 Phase 2.5 spec/plan 到 shipped/"
```

并更新 `~/.claude/projects/-Users-calvin-Desktop-Project-bytedance-aigc/memory/project_bytedance_aigc_creator_platform.md` 加 "Phase 2.5 ship 全表"段。

---

## Self-Review 备忘(plan 写完后自查)

| 检查项                                                             | 状态                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 每 task 含 Files / Steps / 完整 code 块                            | ✅ T1-T18                                                   |
| 无 "TBD / TODO / 类似 Task N" 占位                                 | ✅(T14/T15 显式标注由用户填具体内容,这是运营性 ≠ plan 占位) |
| 类型签名一致(reviewPrompt / reviewSection / dispatchSetViolations) | ✅ T2 → T4 → T5 → T10 → T12/T13                             |
| Spec D-B0~D-B9 全部覆盖                                            | ✅                                                          |
| TDD 红→绿→commit 节奏                                              | ✅ T3/T4/T5/T6/T8/T9/T10 显式                               |
| 每 commit 中文 body + commitlint 100 字符                          | ✅(均拆短行)                                                |
| Worker 加载方式预留踩点(D-B9)                                      | ✅ T9 Step 1                                                |
| 准确率脚本 + 报告(D-B4)                                            | ✅ T16                                                      |
| 注释:JSDoc + WHY 中文                                              | ✅ rule-loader / stream-session / reviewPrompt              |
