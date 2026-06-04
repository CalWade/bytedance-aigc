# Phase 2.4 信息流分发(读路径) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 PRD §5 内容分发的读路径——5 页面(信息流/双榜单/详情页/我的创作)+ 6 个 GET 端点 + 跨前后端共享的排序公式;HotnessScore 用确定性 mock,Phase 2.5 单点替换。

**Architecture:**

- 数据层:复用 `Draft where status='PUBLISHED'` 作为 Post 视角(不开新表);新增 `PostStat` 表占位 schema(本 phase 不写入)。fixtures 加 30 条 PUBLISHED 草稿 + 多作者 + 每篇挂 PREFLIGHT review。
- 排序层:`packages/shared/src/ranking.ts` 暴露纯函数 `computeScore(post, ctx)`,前后端共用;cursor 编码 `{rank, weights}`,翻页中途调权重则 400 强制回第一页。
- 后端:新建 `apps/api/src/feed/` 模块,4 个 controller(feed / rank / post / me-works);全局 `JwtAuthGuard` 已默认拦截,公开端点用 `@Public()`。
- 前端:4 个新页面 + 重写 `/post/[id]`,Server Components SSR(LCP ≤ 2.5s);权重抽屉 localStorage 持久化。

**Tech Stack:** NestJS 11 + Prisma 5 + Next.js 16 (App Router, Server Components) + React 19 + TypeScript 5 严格 + Jest (api / shared) + Vitest (web) + supertest (e2e)

---

## File Structure

**新建 (Create):**

- `packages/shared/src/post.ts` — `PostDto` / `PostDetailDto` / `FeedResponse` / `FeedWeights` 类型导出
- `packages/shared/src/ranking.ts` — 纯函数 `computeScore` / `timeDecayScore` / `normalizeHotness` / `hotnessMockBase`
- `apps/api/src/feed/feed.module.ts` — Nest 模块
- `apps/api/src/feed/feed.service.ts` — 候选池查询 + 排序 + 切 cursor
- `apps/api/src/feed/feed.controller.ts` — `/feed` `/rank/hot` `/rank/best`
- `apps/api/src/feed/posts.controller.ts` — `/post/:id` `/authors/:id/posts`
- `apps/api/src/feed/me.controller.ts` — `/me/works`
- `apps/api/src/feed/cursor.ts` — cursor encode/decode + weights 校验
- `apps/api/src/feed/feed.dto.ts` — class-validator DTO
- `apps/api/src/feed/ranking.spec.ts` — ranking 纯函数单测(挂 api 的 jest)
- `apps/api/test/feed.e2e-spec.ts`
- `apps/api/test/rank.e2e-spec.ts`
- `apps/api/test/post-detail.e2e-spec.ts`
- `apps/api/test/me-works.e2e-spec.ts`
- `apps/api/prisma/migrations/2026XXXXXXXX_phase24_post_stat/migration.sql`(prisma migrate dev 自动生成)
- `apps/web/src/lib/server-fetch.ts` — SSR 用的 server-side fetch helper(无 token)
- `apps/web/src/app/_components/PostCard.tsx` — Server Component
- `apps/web/src/app/_components/RankTabs.tsx` — Client(active 状态联 pathname)
- `apps/web/src/app/_components/WeightDrawer.tsx` — Client(localStorage 滑块)
- `apps/web/src/app/_components/FeedList.tsx` — Server Component
- `apps/web/src/app/_components/LoadMore.tsx` — Client(intersection observer)
- `apps/web/src/app/rank/hot/page.tsx`
- `apps/web/src/app/rank/best/page.tsx`
- `apps/web/src/app/me/works/page.tsx`
- `apps/web/src/app/_components/PostCard.test.tsx`
- `apps/web/src/app/_components/WeightDrawer.test.tsx`
- `apps/web/public/covers/cover-1.webp` ~ `cover-5.webp`
- `docs/perf/lighthouse-feed-2026-06-XX.png` (收尾 task 跑 Lighthouse 截图)

**修改 (Modify):**

- `apps/api/prisma/schema.prisma` — 新增 `PostStat` model + `Draft.stat PostStat?` 反向关系
- `apps/api/prisma/fixtures/users.ts` — 新增 2 个 author
- `apps/api/prisma/fixtures/drafts.ts` — 新增 30 条 PUBLISHED Draft
- `apps/api/prisma/fixtures/index.ts` — 加 reviews 写入 + cleanup 顺序扩展
- `apps/api/prisma/fixtures/reviews.ts`(新建,但放 fixtures 目录)
- `apps/api/src/app.module.ts` — 注册 FeedModule
- `packages/shared/src/index.ts` — re-export post.ts + ranking.ts
- `apps/web/src/app/page.tsx` — 重写为信息流首页
- `apps/web/src/app/post/[id]/page.tsx` — 重写为详情页(从 Phase 2.3 占位)
- `apps/web/src/app/drafts/mine/page.tsx` — 加 status=DRAFT filter(改 1 行)
- `README.md` — 新增 Phase 2.4 信息流小节

**删除/废弃:** 无

---

## 决策细化(spec 之外)

- **D-X1 ranking.spec 挂在哪**:挂 `apps/api/src/feed/ranking.spec.ts`,跟着 api 的 jest(rootDir=src,匹配 `.spec.ts`)。**不**给 shared 单独配 jest。理由:shared 是纯类型 + 纯函数,api 已有 jest 基建,直接 import 测之最经济。
- **D-X2 SSR 怎么取数据**:Next.js 16 Server Component 直接 `await fetch(serverUrl + '/feed', { cache: 'no-store' })`。新建 `apps/web/src/lib/server-fetch.ts`,基础 URL 用 `process.env.NEXT_PUBLIC_API_BASE_URL`(运行时,不进 Next 静态优化)。
- **D-X3 spec 里"对现有 e2e 的影响"判断有误**:实际 `drafts.e2e-spec.ts`(`toBeGreaterThanOrEqual(3)`)和 `drafts-mine.e2e-spec.ts`(`toBeGreaterThanOrEqual(2)`)已用 `>=` 风格断言,fixtures 增量不会导致这两个文件失败。**plan 不再单独修这两个文件**;若执行时发现问题再加 task。
- **D-X4 公开端点装饰**:`/feed` `/rank/hot` `/rank/best` `/post/:id` `/authors/:id/posts` 用 `@Public()`(全局 JwtAuthGuard 默认拦截);`/me/works` 不标,自然走守卫。
- **D-X5 cover 图来源**:用 placeholder 服务下载到 `apps/web/public/covers/cover-{1..5}.webp`(curl 指令在 Task 9)。1280×720,WebP 格式,平均每张 < 100KB。
- **D-X6 fixtures 多作者 ID**:`demoauthor000000000000001`(现有) + `techauthor000000000000002` + `lifeauthor000000000000003`,各挂 10 篇。
- **D-X7 publishedAt 散布算法**:基准 `BASE_NOW = Date.now()`(运行时,不写死,避免 e2e 跑老了过期);第 i 篇 (0-indexed)的 `publishedAt = BASE_NOW - (i * 6 * 3600 * 1000) - 1800_000`(每篇间隔 6h + 加 30min 错开 hot 窗口边界)。前 2 篇在 12h 内(命中 hot)、前 12 篇在 72h 内(命中 best)、全部 30 篇在 180h ≈ 7.5d 内(命中 feed 30d 窗口)。

---

## Task 1: PostStat 表 + schema migration + 反向关系

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create (auto): `apps/api/prisma/migrations/<timestamp>_phase24_post_stat/migration.sql`

- [ ] **Step 1: 在 schema.prisma 末尾追加 PostStat model**

在 `apps/api/prisma/schema.prisma` 末尾(Review model 之后)追加:

```prisma
model PostStat {
  id         String   @id @default(cuid())
  draftId    String   @unique
  impression Int      @default(0)
  click      Int      @default(0)
  dwellUnit  Int      @default(0)
  like       Int      @default(0)
  collect    Int      @default(0)
  share      Int      @default(0)
  report     Int      @default(0)
  updatedAt  DateTime @updatedAt

  draft Draft @relation(fields: [draftId], references: [id], onDelete: Cascade)

  @@map("post_stats")
}
```

- [ ] **Step 2: 在 Draft model 加反向关系字段**

在 `apps/api/prisma/schema.prisma` 中 Draft model 内,跟 `lastReview` / `reviews` 同级追加:

```prisma
  stat PostStat?
```

- [ ] **Step 3: 跑 prisma migrate dev 生成 migration**

```bash
cd apps/api
set -a && source ../../.env && set +a
pnpm exec prisma migrate dev --name phase24_post_stat --create-only
```

预期:在 `apps/api/prisma/migrations/2026MMDDHHMMSS_phase24_post_stat/migration.sql` 生成 CREATE TABLE 语句。**不**自动 apply(先看 SQL 再决定)。

- [ ] **Step 4: 检查生成的 SQL 合理后 apply**

```bash
cd apps/api
set -a && source ../../.env && set +a
pnpm exec prisma migrate dev
```

预期:`Database schema is up to date`。

- [ ] **Step 5: 跑 typecheck 确认 prisma client 已重生**

```bash
pnpm typecheck
```

预期:整库 typecheck 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): Phase 2.4 T1 — PostStat 表 + Draft.stat 反向关系(占位 schema,本 phase 不写入)"
```

---

## Task 2: shared 包加 PostDto / FeedWeights 类型 + 索引导出

**Files:**

- Create: `packages/shared/src/post.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 创建 packages/shared/src/post.ts**

```ts
/**
 * Phase 2.4 信息流相关类型;前后端共享的 source-of-truth。
 * Phase 2.5 接埋点后,PostDto.hotnessMock 字段可能 rename,但端点契约不变。
 */

export interface PostDto {
  id: string;
  title: string;
  authorId: string;
  authorHandle: string;
  publishedAt: string; // ISO
  qualityOverall: number; // 0-100
  hotnessMock: number; // 0-100; Phase 2.5 接埋点后由真实计算替换
  coverIndex: number; // 1-5
  excerpt: string; // 取 body 前 80 字
}

export interface PostDetailDto extends PostDto {
  body: unknown; // TipTap JSONContent
  qualityRecommendation: "ALLOW" | "WARN" | "BLOCK";
}

export interface FeedResponse {
  items: PostDto[];
  nextCursor: string | null;
}

export interface FeedWeights {
  alpha: number; // QualityScore 权重
  beta: number; // HotnessScore 权重
  gamma: number; // TimeDecayScore 权重
}

export const DEFAULT_FEED_WEIGHTS: FeedWeights = {
  alpha: 0.5,
  beta: 0.3,
  gamma: 0.2,
};

export type FeedMode = "all" | "hot" | "best";

/** 各 mode 对应的 τ(小时) — TimeDecayScore 用 */
export const TAU_HOURS: Record<FeedMode, number> = {
  all: 24,
  hot: 12,
  best: 72,
};

/** 各 mode 候选池窗口(小时,小于此 publishedAt 才入候选) */
export const WINDOW_HOURS: Record<FeedMode, number> = {
  all: 24 * 30, // 30 天
  hot: 12,
  best: 72,
};
```

- [ ] **Step 2: 在 packages/shared/src/index.ts 加 export**

文件原内容:

```ts
export * from "./draft-tools";
export * from "./review";
```

改成:

```ts
export * from "./draft-tools";
export * from "./review";
export * from "./post";
```

- [ ] **Step 3: typecheck 确认无环引**

```bash
pnpm typecheck
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/post.ts packages/shared/src/index.ts
git commit -m "feat(shared): Phase 2.4 T2 — PostDto/FeedWeights/TAU_HOURS/WINDOW_HOURS 共享类型"
```

---

## Task 3: shared 包加 ranking.ts + index 导出(无单测,见 Task 4)

**Files:**

- Create: `packages/shared/src/ranking.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 创建 packages/shared/src/ranking.ts**

```ts
/**
 * Phase 2.4 排序公式 — 纯函数,前后端共享。
 *
 * score = α · QualityScore + β · HotnessScore + γ · TimeDecayScore
 *
 * - QualityScore: 4 维质量分总分(由 Phase 2.3 写入 Review.quality.overall),0-100
 * - HotnessScore: 候选池内 min-max 归一化(Phase 2.4 输入是 hotnessMockBase 哈希;
 *   Phase 2.5 接埋点后输入是 PostStat 加权 raw)。归一化保证排序公式不被原始量级吞噬。
 * - TimeDecayScore: 100·exp(-Δh / τ),Δh = 当前时刻减发布时刻的小时数
 *
 * 关键不变量:
 * - 输入纯数据,无 IO,可前后端复用
 * - hotnessRaw 在 Phase 2.4 = hotnessMockBase(post.id);Phase 2.5 = computeRawFromStats(stat, window)
 *   单点替换路径,见 apps/api/src/feed/feed.service.ts 的 // PHASE_2_5_REPLACE_HERE
 */

import type { FeedWeights } from "./post";

export interface Scoreable {
  id: string;
  publishedAt: Date;
  qualityOverall: number; // 0-100
  hotnessRaw: number; // Phase 2.4 = mock; Phase 2.5 = 真实加权
}

export interface ScoreContext {
  weights: FeedWeights;
  tauHours: number;
  now: Date;
  hotnessPool: number[]; // 当前候选池所有 hotnessRaw,用于 min-max 归一化
}

/** TimeDecayScore = 100 · exp(-Δh / τ);0-100,publishedAt 越新越接近 100 */
export function timeDecayScore(publishedAt: Date, now: Date, tauHours: number): number {
  const dh = Math.max(0, (now.getTime() - publishedAt.getTime()) / 3600_000);
  return 100 * Math.exp(-dh / tauHours);
}

/**
 * min-max 归一化到 0-100。
 * - 空池或 max==min:返 0(无意义,候选池不足以归一化)
 * - 池规模 < 50:用候选池 P95 作为 max(避免单 outlier 把其他全压成 0)
 * - 否则用 max
 */
export function normalizeHotness(raw: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  const min = Math.min(...pool);
  const sorted = pool.length < 50 ? [...pool].sort((a, b) => a - b) : null;
  const max = sorted ? sorted[Math.floor(sorted.length * 0.95)] : Math.max(...pool);
  if (max === min) return 0;
  const clamped = Math.max(min, Math.min(max, raw));
  return 100 * ((clamped - min) / (max - min));
}

/** α·Q + β·H + γ·T;输入纯数据,无 IO */
export function computeScore(p: Scoreable, ctx: ScoreContext): number {
  const q = p.qualityOverall;
  const h = normalizeHotness(p.hotnessRaw, ctx.hotnessPool);
  const t = timeDecayScore(p.publishedAt, ctx.now, ctx.tauHours);
  return ctx.weights.alpha * q + ctx.weights.beta * h + ctx.weights.gamma * t;
}

/**
 * Phase 2.4 mock:稳定哈希,跨调用一致;输入同 id 永远同输出。
 * Phase 2.5 接埋点后此函数仍保留(Phase 2.4 的 e2e 还在用),但 feed.service 不再调用。
 */
export function hotnessMockBase(postId: string): number {
  let h = 0;
  for (let i = 0; i < postId.length; i++) {
    h = (h * 31 + postId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
```

- [ ] **Step 2: 在 packages/shared/src/index.ts 加 export**

```ts
export * from "./draft-tools";
export * from "./review";
export * from "./post";
export * from "./ranking";
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/ranking.ts packages/shared/src/index.ts
git commit -m "feat(shared): Phase 2.4 T3 — ranking 排序公式 + hotnessMockBase 占位"
```

---

## Task 4: ranking 单测(挂 apps/api/src/feed/ 下,跟 api 的 jest)

**Files:**

- Create: `apps/api/src/feed/ranking.spec.ts`

> 此 task 没实现代码,纯测试覆盖 Task 3 写好的 ranking.ts。
> 把单测放在 apps/api/src/feed/ 是因为 api 的 jest rootDir=src 已配好;shared 没自己的 jest。

- [ ] **Step 1: 建目录 + 写单测**

```bash
mkdir -p apps/api/src/feed
```

文件 `apps/api/src/feed/ranking.spec.ts`:

```ts
import {
  computeScore,
  hotnessMockBase,
  normalizeHotness,
  timeDecayScore,
  type Scoreable,
  type ScoreContext,
} from "@bytedance-aigc/shared";

describe("timeDecayScore", () => {
  it("Δh=0 时返 100", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    expect(timeDecayScore(now, now, 12)).toBeCloseTo(100, 5);
  });

  it("Δh=τ 时返 100/e ≈ 36.79", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    const past = new Date(now.getTime() - 12 * 3600_000);
    expect(timeDecayScore(past, now, 12)).toBeCloseTo(100 / Math.E, 3);
  });

  it("τ 越小越偏新内容(τ=12 比 τ=72 衰减更快)", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    const past = new Date(now.getTime() - 24 * 3600_000); // 24h 前
    const t12 = timeDecayScore(past, now, 12);
    const t72 = timeDecayScore(past, now, 72);
    expect(t12).toBeLessThan(t72);
  });

  it("publishedAt 在未来(时钟漂)返 100,不返负数", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    const future = new Date(now.getTime() + 3600_000);
    expect(timeDecayScore(future, now, 12)).toBe(100);
  });
});

describe("normalizeHotness", () => {
  it("空池返 0", () => {
    expect(normalizeHotness(50, [])).toBe(0);
  });

  it("max==min 返 0(无差异)", () => {
    expect(normalizeHotness(7, [7, 7, 7])).toBe(0);
  });

  it("typical 池 raw=max 返 100", () => {
    const pool = [10, 20, 30, 40, 50];
    expect(normalizeHotness(50, pool)).toBe(100);
  });

  it("typical 池 raw=min 返 0", () => {
    const pool = [10, 20, 30, 40, 50];
    expect(normalizeHotness(10, pool)).toBe(0);
  });

  it("池规模 < 50 用 P95 作为 max(单 outlier 不能压低其他)", () => {
    // 49 个 1-49 + 1 个 9999;不带 P95 的话,raw=49 会被压到接近 0
    const pool = Array.from({ length: 49 }, (_, i) => i + 1).concat([9999]);
    const score = normalizeHotness(49, pool);
    // P95 ≈ 第 47 大 ≈ 47-48,raw=49 会被 clamp 到 P95 → 接近 100
    expect(score).toBeGreaterThan(80);
  });

  it("raw 超 max 被 clamp(不返 > 100)", () => {
    const pool = [10, 20, 30];
    expect(normalizeHotness(9999, pool)).toBe(100);
  });
});

describe("hotnessMockBase", () => {
  it("同 id 多次调一致", () => {
    const a = hotnessMockBase("post-abc-123");
    const b = hotnessMockBase("post-abc-123");
    expect(a).toBe(b);
  });

  it("结果在 [0, 100) 范围", () => {
    for (const id of ["a", "ab", "long-cuid-id-foo-bar-baz-qux"]) {
      const v = hotnessMockBase(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it("不同 id 大概率不同(抽样不要求 perfect 但要有差异)", () => {
    const set = new Set<number>();
    for (let i = 0; i < 30; i++) set.add(hotnessMockBase(`id-${i}`));
    expect(set.size).toBeGreaterThan(15); // 至少 50% 唯一
  });
});

describe("computeScore", () => {
  const now = new Date("2026-06-04T12:00:00Z");
  const baseCtx: ScoreContext = {
    weights: { alpha: 0.5, beta: 0.3, gamma: 0.2 },
    tauHours: 24,
    now,
    hotnessPool: [10, 50, 90],
  };

  function mk(id: string, qual: number, hot: number, agoHours: number): Scoreable {
    return {
      id,
      qualityOverall: qual,
      hotnessRaw: hot,
      publishedAt: new Date(now.getTime() - agoHours * 3600_000),
    };
  }

  it("α=1, β=γ=0 时按 quality 降序", () => {
    const ctx: ScoreContext = { ...baseCtx, weights: { alpha: 1, beta: 0, gamma: 0 } };
    const a = computeScore(mk("a", 90, 10, 0), ctx);
    const b = computeScore(mk("b", 60, 90, 0), ctx);
    expect(a).toBeGreaterThan(b);
  });

  it("α=γ=0, β=1 时按 hotness(归一化后)降序", () => {
    const ctx: ScoreContext = { ...baseCtx, weights: { alpha: 0, beta: 1, gamma: 0 } };
    const a = computeScore(mk("a", 60, 90, 0), ctx);
    const b = computeScore(mk("b", 90, 10, 0), ctx);
    expect(a).toBeGreaterThan(b);
  });

  it("α=β=0, γ=1 时按 publishedAt 降序", () => {
    const ctx: ScoreContext = { ...baseCtx, weights: { alpha: 0, beta: 0, gamma: 1 } };
    const fresh = computeScore(mk("a", 60, 50, 1), ctx);
    const old = computeScore(mk("b", 90, 50, 24), ctx);
    expect(fresh).toBeGreaterThan(old);
  });

  it("默认权重 0.5/0.3/0.2 — 三项加和", () => {
    const ctx = baseCtx;
    const s = computeScore(mk("a", 80, 50, 0), ctx);
    // q=80, h=normalize(50,[10,50,90])=50, t=100
    // s = 0.5*80 + 0.3*50 + 0.2*100 = 40 + 15 + 20 = 75
    expect(s).toBeCloseTo(75, 3);
  });
});
```

- [ ] **Step 2: 跑单测**

```bash
pnpm --filter @bytedance-aigc/api test ranking
```

预期:`Tests: XX passed`(应 ≥ 16 条)。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/feed/ranking.spec.ts
git commit -m "test(api): Phase 2.4 T4 — ranking 公式单测(timeDecay/normalize/computeScore/mockBase 16+ 用例)"
```

---

## Task 5: cursor encode/decode + weights 校验

**Files:**

- Create: `apps/api/src/feed/cursor.ts`

- [ ] **Step 1: 写 cursor 编码/解码**

文件 `apps/api/src/feed/cursor.ts`:

```ts
import type { FeedWeights } from "@bytedance-aigc/shared";

/**
 * Cursor 表示「翻到候选池中第几条」+ 当时的权重快照。
 * 因为 score 是运行时计算且依赖权重,无法用 SQL WHERE 比较;
 * 所以 cursor 不带 score,只带 rank(0-indexed)+ weights。
 * 翻页中途若 weights 变,backend 校验失败 → 400 强制回第一页。
 */
export interface FeedCursor {
  rank: number;
  weights: FeedWeights;
}

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): FeedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("CURSOR_INVALID");
  }
  if (!isFeedCursor(parsed)) throw new Error("CURSOR_INVALID");
  return parsed;
}

function isFeedCursor(x: unknown): x is FeedCursor {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.rank !== "number" || !Number.isFinite(o.rank) || o.rank < 0) return false;
  const w = o.weights;
  if (typeof w !== "object" || w === null) return false;
  const wo = w as Record<string, unknown>;
  return (
    typeof wo.alpha === "number" && typeof wo.beta === "number" && typeof wo.gamma === "number"
  );
}

/** 严格相等(浮点 1e-9 容差);不等返 false 触发 CURSOR_WEIGHTS_MISMATCH */
export function weightsEqual(a: FeedWeights, b: FeedWeights): boolean {
  const eps = 1e-9;
  return (
    Math.abs(a.alpha - b.alpha) < eps &&
    Math.abs(a.beta - b.beta) < eps &&
    Math.abs(a.gamma - b.gamma) < eps
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期:全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/feed/cursor.ts
git commit -m "feat(api): Phase 2.4 T5 — cursor encode/decode + weights 校验"
```

---

## Task 6: feed.dto.ts class-validator DTO

**Files:**

- Create: `apps/api/src/feed/feed.dto.ts`

- [ ] **Step 1: 写 query DTO**

文件 `apps/api/src/feed/feed.dto.ts`:

```ts
import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  alpha?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  beta?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  gamma?: number;
}

export class AuthorPostsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MeWorksQueryDto {
  @IsOptional()
  @IsString()
  status?: "DRAFT" | "PUBLISHED" | "ALL";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/feed/feed.dto.ts
git commit -m "feat(api): Phase 2.4 T6 — feed/authors/me-works query DTO 校验"
```

---

## Task 7: feed.service.ts(候选池查询 + 排序 + 切 cursor)

**Files:**

- Create: `apps/api/src/feed/feed.service.ts`

- [ ] **Step 1: 写 service**

文件 `apps/api/src/feed/feed.service.ts`:

```ts
import { Injectable, BadRequestException } from "@nestjs/common";
import {
  computeScore,
  hotnessMockBase,
  normalizeHotness,
  TAU_HOURS,
  WINDOW_HOURS,
  DEFAULT_FEED_WEIGHTS,
  type FeedMode,
  type FeedWeights,
  type PostDto,
  type Scoreable,
} from "@bytedance-aigc/shared";
import { PrismaService } from "../prisma/prisma.service";
import { decodeCursor, encodeCursor, weightsEqual } from "./cursor";

const DEFAULT_LIMIT = 10;

interface GetFeedOpts {
  mode: FeedMode;
  cursor?: string;
  limit?: number;
  weights?: Partial<FeedWeights>;
}

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(opts: GetFeedOpts): Promise<{ items: PostDto[]; nextCursor: string | null }> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const weights: FeedWeights = {
      alpha: opts.weights?.alpha ?? DEFAULT_FEED_WEIGHTS.alpha,
      beta: opts.weights?.beta ?? DEFAULT_FEED_WEIGHTS.beta,
      gamma: opts.weights?.gamma ?? DEFAULT_FEED_WEIGHTS.gamma,
    };

    let startRank = 0;
    if (opts.cursor) {
      let decoded;
      try {
        decoded = decodeCursor(opts.cursor);
      } catch {
        throw new BadRequestException({ code: "CURSOR_INVALID", message: "cursor 解析失败" });
      }
      if (!weightsEqual(decoded.weights, weights)) {
        throw new BadRequestException({
          code: "CURSOR_WEIGHTS_MISMATCH",
          message: "权重已变更,请回到第一页",
        });
      }
      startRank = decoded.rank;
    }

    const now = new Date();
    const windowMs = WINDOW_HOURS[opts.mode] * 3600_000;
    const since = new Date(now.getTime() - windowMs);

    const drafts = await this.prisma.draft.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: since } },
      include: {
        author: { select: { id: true, name: true } },
        lastReview: { select: { quality: true } },
      },
    });

    const scoreables: (Scoreable & { draft: (typeof drafts)[number] })[] = drafts.map((d) => {
      // PHASE_2_5_REPLACE_HERE: 把 hotnessMockBase 换成基于 PostStat 的真实加权
      const hotnessRaw = hotnessMockBase(d.id);
      const q = readQualityOverall(d.lastReview?.quality);
      return {
        id: d.id,
        publishedAt: d.publishedAt ?? d.updatedAt,
        qualityOverall: q,
        hotnessRaw,
        draft: d,
      };
    });

    const hotnessPool = scoreables.map((s) => s.hotnessRaw);
    const tauHours = TAU_HOURS[opts.mode];

    const ranked = scoreables
      .map((s) => ({ s, score: computeScore(s, { weights, tauHours, now, hotnessPool }) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const pa = a.s.publishedAt.getTime();
        const pb = b.s.publishedAt.getTime();
        if (pa !== pb) return pb - pa;
        return a.s.id.localeCompare(b.s.id);
      });

    const slice = ranked.slice(startRank, startRank + limit);
    const items: PostDto[] = slice.map(({ s }) => toPostDto(s.draft, s.hotnessRaw, hotnessPool));

    const endRank = startRank + slice.length;
    const nextCursor = endRank < ranked.length ? encodeCursor({ rank: endRank, weights }) : null;
    return { items, nextCursor };
  }

  async getPostDetail(id: string) {
    const draft = await this.prisma.draft.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        lastReview: { select: { quality: true, recommendation: true } },
      },
    });
    if (!draft || draft.status !== "PUBLISHED") return null;
    if (draft.lastReview?.recommendation === "BLOCK") return null;
    return draft;
  }

  async getAuthorPosts(authorId: string, limit = DEFAULT_LIMIT) {
    const drafts = await this.prisma.draft.findMany({
      where: { authorId, status: "PUBLISHED" },
      include: {
        author: { select: { id: true, name: true } },
        lastReview: { select: { quality: true } },
      },
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
    const hotnessPool = drafts.map((d) => hotnessMockBase(d.id));
    return drafts.map((d) => toPostDto(d, hotnessMockBase(d.id), hotnessPool));
  }

  async getMyWorks(userId: string, status: "DRAFT" | "PUBLISHED" | "ALL", limit = 20) {
    const where: { authorId: string; status?: "DRAFT" | "PUBLISHED" } = { authorId: userId };
    if (status !== "ALL") where.status = status;
    const drafts = await this.prisma.draft.findMany({
      where,
      include: { lastReview: { select: { quality: true, recommendation: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return drafts.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      mode: d.mode,
      publishedAt: d.publishedAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
      qualityOverall: readQualityOverall(d.lastReview?.quality),
      recommendation: d.lastReview?.recommendation ?? null,
    }));
  }
}

function readQualityOverall(quality: unknown): number {
  if (typeof quality !== "object" || quality === null) return 0;
  const v = (quality as Record<string, unknown>).overall;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function toPostDto(
  draft: {
    id: string;
    title: string;
    authorId: string;
    publishedAt: Date | null;
    updatedAt: Date;
    body: unknown;
    author: { id: string; name: string };
    lastReview: { quality: unknown } | null;
  },
  hotnessRaw: number,
  hotnessPool: number[],
): PostDto {
  const hotnessMock = normalizeHotness(hotnessRaw, hotnessPool);
  return {
    id: draft.id,
    title: draft.title,
    authorId: draft.authorId,
    authorHandle: draft.author.name,
    publishedAt: (draft.publishedAt ?? draft.updatedAt).toISOString(),
    qualityOverall: readQualityOverall(draft.lastReview?.quality),
    hotnessMock,
    coverIndex: pickCoverIndex(draft.id),
    excerpt: extractExcerpt(draft.body),
  };
}

function pickCoverIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 5) + 1;
}

function extractExcerpt(body: unknown): string {
  return collectText(body).slice(0, 80);
}

function collectText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(collectText).join("");
  return "";
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期:全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/feed/feed.service.ts
git commit -m "feat(api): Phase 2.4 T7 — feed.service 候选池查询 + 排序 + cursor 切片"
```

---

## Task 8: feed.controller.ts(/feed /rank/hot /rank/best)

**Files:**

- Create: `apps/api/src/feed/feed.controller.ts`

- [ ] **Step 1: 写 controller**

```ts
import { Controller, Get, Query } from "@nestjs/common";
import type { FeedResponse } from "@bytedance-aigc/shared";
import { Public } from "../auth/public.decorator";
import { FeedService } from "./feed.service";
import { FeedQueryDto } from "./feed.dto";

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Public()
  @Get("feed")
  async getFeed(@Query() q: FeedQueryDto): Promise<FeedResponse> {
    return this.feed.getFeed({
      mode: "all",
      cursor: q.cursor,
      limit: q.limit,
      weights: pickWeights(q),
    });
  }

  @Public()
  @Get("rank/hot")
  async getHot(@Query() q: FeedQueryDto): Promise<FeedResponse> {
    return this.feed.getFeed({
      mode: "hot",
      cursor: q.cursor,
      limit: q.limit,
      weights: pickWeights(q),
    });
  }

  @Public()
  @Get("rank/best")
  async getBest(@Query() q: FeedQueryDto): Promise<FeedResponse> {
    return this.feed.getFeed({
      mode: "best",
      cursor: q.cursor,
      limit: q.limit,
      weights: pickWeights(q),
    });
  }
}

function pickWeights(
  q: FeedQueryDto,
): { alpha?: number; beta?: number; gamma?: number } | undefined {
  if (q.alpha === undefined && q.beta === undefined && q.gamma === undefined) return undefined;
  return { alpha: q.alpha, beta: q.beta, gamma: q.gamma };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/feed/feed.controller.ts
git commit -m "feat(api): Phase 2.4 T8 — /feed /rank/hot /rank/best 公开接口"
```

---

## Task 9: posts.controller.ts(/post/:id + /authors/:id/posts)

**Files:**

- Create: `apps/api/src/feed/posts.controller.ts`

- [ ] **Step 1: 写 controller**

```ts
import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import type { PostDetailDto, PostDto } from "@bytedance-aigc/shared";
import { hotnessMockBase, normalizeHotness } from "@bytedance-aigc/shared";
import { Public } from "../auth/public.decorator";
import { FeedService } from "./feed.service";
import { AuthorPostsQueryDto } from "./feed.dto";

@Controller()
export class PostsController {
  constructor(private readonly feed: FeedService) {}

  @Public()
  @Get("post/:id")
  async getPost(@Param("id") id: string): Promise<PostDetailDto> {
    const draft = await this.feed.getPostDetail(id);
    if (!draft)
      throw new NotFoundException({ code: "POST_NOT_FOUND", message: "稿件不存在或已下架" });

    const hotnessRaw = hotnessMockBase(draft.id);
    const quality = readQ(draft.lastReview?.quality);
    return {
      id: draft.id,
      title: draft.title,
      authorId: draft.authorId,
      authorHandle: draft.author.name,
      publishedAt: (draft.publishedAt ?? draft.updatedAt).toISOString(),
      qualityOverall: quality,
      hotnessMock: normalizeHotness(hotnessRaw, [hotnessRaw]),
      coverIndex: (Math.abs(hashId(draft.id)) % 5) + 1,
      excerpt: "",
      body: draft.body,
      qualityRecommendation: (draft.lastReview?.recommendation ?? "ALLOW") as
        | "ALLOW"
        | "WARN"
        | "BLOCK",
    };
  }

  @Public()
  @Get("authors/:id/posts")
  async getAuthorPosts(
    @Param("id") id: string,
    @Query() q: AuthorPostsQueryDto,
  ): Promise<{ items: PostDto[] }> {
    const items = await this.feed.getAuthorPosts(id, q.limit);
    return { items };
  }
}

function readQ(q: unknown): number {
  if (typeof q !== "object" || q === null) return 0;
  const v = (q as Record<string, unknown>).overall;
  return typeof v === "number" ? v : 0;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/feed/posts.controller.ts
git commit -m "feat(api): Phase 2.4 T9 — /post/:id + /authors/:id/posts 公开接口"
```

---

## Task 10: me.controller.ts(/me/works,需登录)

**Files:**

- Create: `apps/api/src/feed/me.controller.ts`

- [ ] **Step 1: 写 controller**

```ts
import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { FeedService } from "./feed.service";
import { MeWorksQueryDto } from "./feed.dto";

@Controller("me")
export class MeWorksController {
  constructor(private readonly feed: FeedService) {}

  @Get("works")
  async getWorks(@CurrentUser("id") userId: string, @Query() q: MeWorksQueryDto) {
    const status = q.status ?? "ALL";
    const items = await this.feed.getMyWorks(userId, status, q.limit);
    return { items };
  }
}
```

- [ ] **Step 2: 检查 CurrentUser 装饰器存在**

```bash
ls apps/api/src/auth/current-user.decorator.ts
```

预期:存在。若不存在,改用 `@Req() req` 然后 `req.user.id`。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/feed/me.controller.ts
git commit -m "feat(api): Phase 2.4 T10 — /me/works 我的创作(需登录)"
```

---

## Task 11: feed.module.ts + app.module.ts 注册

**Files:**

- Create: `apps/api/src/feed/feed.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 写 feed.module.ts**

```ts
import { Module } from "@nestjs/common";
import { FeedController } from "./feed.controller";
import { PostsController } from "./posts.controller";
import { MeWorksController } from "./me.controller";
import { FeedService } from "./feed.service";

@Module({
  controllers: [FeedController, PostsController, MeWorksController],
  providers: [FeedService],
})
export class FeedModule {}
```

- [ ] **Step 2: app.module.ts 加 import**

在 `apps/api/src/app.module.ts` 顶部加 `import { FeedModule } from "./feed/feed.module";`,imports 数组追加 `FeedModule`。

- [ ] **Step 3: dev 服务器手测**

```bash
pnpm --filter @bytedance-aigc/api start:dev &
sleep 5
curl -s http://localhost:3000/feed | head -c 200
curl -s http://localhost:3000/rank/hot | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/me/works  # 期望 401
```

- [ ] **Step 4: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/feed/feed.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): Phase 2.4 T11 — FeedModule 注册 + 接通 app.module"
```

---

## Task 12: fixtures 扩展(多作者 + 30 PUBLISHED + 关联 review)

**Files:**

- Modify: `apps/api/prisma/fixtures/users.ts`
- Modify: `apps/api/prisma/fixtures/drafts.ts`
- Create: `apps/api/prisma/fixtures/reviews.ts`
- Modify: `apps/api/prisma/fixtures/index.ts`

- [ ] **Step 1: users.ts 加 2 个 author**

在原有 `DEMO_AUTHOR_ID` 之后追加:

```ts
export const TECH_AUTHOR_ID = "techauthor000000000000002";
export const LIFE_AUTHOR_ID = "lifeauthor000000000000003";
```

并在 applyUsers 函数中扩展 upsert 列表(参照 demo author 的形态,name/email 适当填,hashedPassword 复用 demo 的)。

- [ ] **Step 2: drafts.ts 追加 30 条 PUBLISHED**

引入新作者 ID:

```ts
import { DEMO_AUTHOR_ID, TECH_AUTHOR_ID, LIFE_AUTHOR_ID } from "./users";
```

在 applyDrafts 中**保留** Phase 2.2 已有的 2 条 demo draft,**追加**:

```ts
const BASE_NOW = Date.now();
const PUBLISHED_AUTHORS = [DEMO_AUTHOR_ID, TECH_AUTHOR_ID, LIFE_AUTHOR_ID];
const TITLES_BY_AUTHOR: Record<string, string[]> = {
  [DEMO_AUTHOR_ID]: [
    "Demo:AI 时代的内容工作流",
    "Demo:Prompt 管理实战",
    "Demo:监控仪表盘搭建",
    "Demo:从 0 到 1 上线产品",
    "Demo:复盘一次故障",
  ],
  [TECH_AUTHOR_ID]: [
    "Tech:Next.js 16 升级踩坑",
    "Tech:Prisma 迁移实践",
    "Tech:NestJS Module 拆分",
    "Tech:TypeScript 严格模式",
    "Tech:E2E 测试设计",
  ],
  [LIFE_AUTHOR_ID]: [
    "Life:周末 city walk 攻略",
    "Life:咖啡探店日记",
    "Life:健身一年总结",
    "Life:读书清单",
    "Life:旅行的意义",
  ],
};

for (let i = 0; i < 30; i++) {
  const author = PUBLISHED_AUTHORS[i % 3];
  const titleArr = TITLES_BY_AUTHOR[author];
  const title = `${titleArr[Math.floor(i / 3) % titleArr.length]} #${i}`;
  const publishedAt = new Date(BASE_NOW - i * 6 * 3600_000 - 1800_000);
  const id = `pub${String(i).padStart(3, "0")}draft0000000000000000`;
  await prisma.draft.upsert({
    where: { id },
    create: {
      id,
      authorId: author,
      title,
      status: "PUBLISHED",
      mode: i % 2 === 0 ? "FAST" : "FINE",
      publishedAt,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `${title} —— 这是 fixtures 注入的发布稿正文。` }],
          },
        ],
      },
    },
    update: { publishedAt, status: "PUBLISHED" },
  });
}
```

- [ ] **Step 3: 新建 fixtures/reviews.ts**

```ts
import { PrismaClient } from "@prisma/client";

/** 给所有 PUBLISHED Draft 各挂一条 PREFLIGHT ALLOW Review */
export async function applyReviews(prisma: PrismaClient): Promise<void> {
  const drafts = await prisma.draft.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const overall = 60 + ((i * 7) % 36); // 60..95
    const id = `rv${String(i).padStart(3, "0")}review000000000000000`;
    const quality = {
      overall,
      dims: { value: overall, expression: overall, experience: overall, potential: overall },
    };
    await prisma.review.upsert({
      where: { id },
      create: {
        id,
        draftId: d.id,
        stage: "PREFLIGHT",
        recommendation: "ALLOW",
        safety: {
          violence: { severity: "low", note: "" },
          sexual: { severity: "low", note: "" },
          political: { severity: "low", note: "" },
          privacy: { severity: "low", note: "" },
          factuality: { severity: "low", note: "" },
          copyright: { severity: "low", note: "" },
        },
        quality,
        modelMeta: { providerSafety: "fixture", providerQuality: "fixture" },
      },
      update: { quality },
    });
    await prisma.draft.update({ where: { id: d.id }, data: { lastReviewId: id } });
  }
}
```

- [ ] **Step 4: index.ts 接通 reviews 写入 + cleanup 顺序**

修改 `apps/api/prisma/fixtures/index.ts`:在 `applyAllFixtures` 调 `applyDrafts` 之后追加 `await applyReviews(prisma)`;在 `cleanupAllFixtures` 中按外键依赖顺序追加 `await prisma.review.deleteMany({})`(在 draftVersion 之后、draft 之前)。

- [ ] **Step 5: 跑 e2e 看是否爆**

```bash
cd apps/api
set -a && source ../../.env && set +a
pnpm exec prisma migrate reset --force --skip-seed
cd ../..
pnpm --filter @bytedance-aigc/api test:e2e
```

预期:既有 e2e 全绿,fixtures 装载正常。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/fixtures/
git commit -m "feat(api): Phase 2.4 T12 — fixtures 扩 3 作者 + 30 PUBLISHED + PREFLIGHT review"
```

---

## Task 13: cover 图下载

**Files:**

- Create: `apps/web/public/covers/cover-1.webp` ~ `cover-5.webp`

- [ ] **Step 1: 下载 5 张 placeholder 图**

```bash
mkdir -p apps/web/public/covers
for i in 1 2 3 4 5; do
  curl -L -o "apps/web/public/covers/cover-${i}.webp" \
    "https://picsum.photos/seed/aigc${i}/1280/720.webp"
done
ls -lh apps/web/public/covers/
```

预期:每张 < 200KB。若 picsum 不返 webp,改下 jpg 然后用 cwebp 转;若机器没装 cwebp,把 PostCard 里 `.webp` 全改 `.jpg`。

- [ ] **Step 2: Commit**

```bash
git add apps/web/public/covers/
git commit -m "feat(web): Phase 2.4 T13 — 5 张信息流 cover 占位图"
```

---

## Task 14: 后端 e2e 测试(feed / rank / post-detail / me-works)

**Files:**

- Create: `apps/api/test/feed.e2e-spec.ts`
- Create: `apps/api/test/rank.e2e-spec.ts`
- Create: `apps/api/test/post-detail.e2e-spec.ts`
- Create: `apps/api/test/me-works.e2e-spec.ts`

- [ ] **Step 1: feed.e2e-spec.ts**

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { applyAllFixtures, cleanupAllFixtures } from "../prisma/fixtures";
import { PrismaService } from "../src/prisma/prisma.service";

describe("/feed (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanupAllFixtures(prisma);
    await applyAllFixtures(prisma);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("GET /feed 公开返回 items[]", async () => {
    const res = await request(app.getHttpServer()).get("/feed?limit=10").expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.length).toBeLessThanOrEqual(10);
    expect(res.body.items[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      qualityOverall: expect.any(Number),
      hotnessMock: expect.any(Number),
    });
  });

  it("cursor 翻页可拿到不同 items", async () => {
    const r1 = await request(app.getHttpServer()).get("/feed?limit=5").expect(200);
    expect(r1.body.nextCursor).toBeTruthy();
    const r2 = await request(app.getHttpServer())
      .get(`/feed?limit=5&cursor=${encodeURIComponent(r1.body.nextCursor)}`)
      .expect(200);
    const ids1 = r1.body.items.map((x: { id: string }) => x.id);
    const ids2 = r2.body.items.map((x: { id: string }) => x.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("翻页中途权重变化 → 400 CURSOR_WEIGHTS_MISMATCH", async () => {
    const r1 = await request(app.getHttpServer()).get("/feed?limit=5").expect(200);
    const cursor = r1.body.nextCursor as string;
    const res = await request(app.getHttpServer())
      .get(`/feed?limit=5&cursor=${encodeURIComponent(cursor)}&alpha=0.9&beta=0.05&gamma=0.05`)
      .expect(400);
    expect(res.body.message?.code ?? res.body.code).toBe("CURSOR_WEIGHTS_MISMATCH");
  });

  it("非法 cursor → 400 CURSOR_INVALID", async () => {
    const res = await request(app.getHttpServer())
      .get("/feed?cursor=not-a-valid-cursor")
      .expect(400);
    expect(res.body.message?.code ?? res.body.code).toBe("CURSOR_INVALID");
  });
});
```

> 注:`res.body.message?.code ?? res.body.code` 是为兼容 NestJS BadRequestException 序列化形态(Phase 2.3 实测过 ConflictException 是 spread 平铺,但 BadRequestException 用 object payload 是嵌入 message)。先写双兼容,跑起来看实际是哪个。

- [ ] **Step 2: rank.e2e-spec.ts**

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { applyAllFixtures, cleanupAllFixtures } from "../prisma/fixtures";
import { PrismaService } from "../src/prisma/prisma.service";

describe("/rank (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanupAllFixtures(prisma);
    await applyAllFixtures(prisma);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("/rank/hot 返回 12h 内候选(>=2)", async () => {
    const res = await request(app.getHttpServer()).get("/rank/hot").expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it("/rank/best 返回 72h 内候选(>=10)", async () => {
    const res = await request(app.getHttpServer()).get("/rank/best").expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(10);
  });

  it("权重切换导致同 mode 排序变化", async () => {
    const rQ = await request(app.getHttpServer())
      .get("/rank/best?alpha=1&beta=0&gamma=0&limit=5")
      .expect(200);
    const rT = await request(app.getHttpServer())
      .get("/rank/best?alpha=0&beta=0&gamma=1&limit=5")
      .expect(200);
    const idsQ = rQ.body.items.map((x: { id: string }) => x.id);
    const idsT = rT.body.items.map((x: { id: string }) => x.id);
    expect(idsQ).not.toEqual(idsT);
  });
});
```

- [ ] **Step 3: post-detail.e2e-spec.ts**

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { applyAllFixtures, cleanupAllFixtures } from "../prisma/fixtures";
import { PrismaService } from "../src/prisma/prisma.service";

describe("/post/:id (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let publishedId: string;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanupAllFixtures(prisma);
    await applyAllFixtures(prisma);
    const d = await prisma.draft.findFirst({ where: { status: "PUBLISHED" } });
    publishedId = d!.id;
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("详情含 body/qualityRecommendation", async () => {
    const res = await request(app.getHttpServer()).get(`/post/${publishedId}`).expect(200);
    expect(res.body).toMatchObject({
      id: publishedId,
      body: expect.any(Object),
      qualityRecommendation: expect.stringMatching(/ALLOW|WARN|BLOCK/),
    });
  });

  it("不存在 → 404 POST_NOT_FOUND", async () => {
    const res = await request(app.getHttpServer())
      .get("/post/nonexistent000000000000000")
      .expect(404);
    expect(res.body.message?.code ?? res.body.code).toBe("POST_NOT_FOUND");
  });

  it("DRAFT 状态稿子 → 404", async () => {
    const draft = await prisma.draft.findFirst({ where: { status: "DRAFT" } });
    if (!draft) return;
    await request(app.getHttpServer()).get(`/post/${draft.id}`).expect(404);
  });
});
```

- [ ] **Step 4: me-works.e2e-spec.ts**

```ts
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { applyAllFixtures, cleanupAllFixtures } from "../prisma/fixtures";
import { PrismaService } from "../src/prisma/prisma.service";
import { signTestToken } from "./helpers/auth";

describe("/me/works (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanupAllFixtures(prisma);
    await applyAllFixtures(prisma);
    token = signTestToken({ id: "demoauthor000000000000001" });
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("无 token → 401", async () => {
    await request(app.getHttpServer()).get("/me/works").expect(401);
  });

  it("登录用户 status=ALL 返回所有稿(>=3)", async () => {
    const res = await request(app.getHttpServer())
      .get("/me/works?status=ALL")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("status=PUBLISHED 只返已发布", async () => {
    const res = await request(app.getHttpServer())
      .get("/me/works?status=PUBLISHED")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    for (const it of res.body.items) expect(it.status).toBe("PUBLISHED");
  });
});
```

> 注:`signTestToken` helper 名称按仓库实际为准(若叫 `createTestToken` / `mintToken` 等则改)。

- [ ] **Step 5: 跑 e2e**

```bash
pnpm --filter @bytedance-aigc/api test:e2e
```

预期:全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/feed.e2e-spec.ts apps/api/test/rank.e2e-spec.ts \
        apps/api/test/post-detail.e2e-spec.ts apps/api/test/me-works.e2e-spec.ts
git commit -m "test(api): Phase 2.4 T14 — feed/rank/post-detail/me-works e2e(15+ 用例)"
```

---

## Task 15: 前端 server-fetch + drafts/mine status filter

**Files:**

- Create: `apps/web/src/lib/server-fetch.ts`
- Modify: `apps/web/src/app/drafts/mine/page.tsx`

- [ ] **Step 1: 写 server-fetch helper**

```ts
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function serverFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) throw new Error(`server-fetch ${path} ${res.status}`);
  return (await res.json()) as T;
}
```

- [ ] **Step 2: drafts/mine 加 status=DRAFT filter**

打开 `apps/web/src/app/drafts/mine/page.tsx`,把现有 fetch 路径加 `?status=DRAFT`(具体 1 行改,根据现有调用现状)。

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server-fetch.ts apps/web/src/app/drafts/mine/page.tsx
git commit -m "feat(web): Phase 2.4 T15 — server-fetch helper + drafts/mine status=DRAFT 过滤"
```

---

## Task 16: 前端组件(PostCard / FeedList / RankTabs / WeightDrawer / LoadMore)

**Files:**

- Create: `apps/web/src/app/_components/PostCard.tsx`
- Create: `apps/web/src/app/_components/FeedList.tsx`
- Create: `apps/web/src/app/_components/RankTabs.tsx`
- Create: `apps/web/src/app/_components/WeightDrawer.tsx`
- Create: `apps/web/src/app/_components/LoadMore.tsx`

- [ ] **Step 1: PostCard.tsx(Server Component)**

```tsx
import Link from "next/link";
import Image from "next/image";
import type { PostDto } from "@bytedance-aigc/shared";

export function PostCard({ post }: { post: PostDto }) {
  return (
    <Link href={`/post/${post.id}`} className="block border rounded-lg p-3 hover:shadow-md">
      <div className="relative aspect-video mb-2">
        <Image
          src={`/covers/cover-${post.coverIndex}.webp`}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover rounded"
        />
      </div>
      <h3 className="font-medium line-clamp-2">{post.title}</h3>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{post.excerpt}</p>
      <div className="flex justify-between text-xs text-gray-400 mt-2">
        <span>{post.authorHandle}</span>
        <span>
          Q {post.qualityOverall.toFixed(0)} · H {post.hotnessMock.toFixed(0)}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: FeedList.tsx**

```tsx
import type { FeedResponse } from "@bytedance-aigc/shared";
import { PostCard } from "./PostCard";

export function FeedList({ data }: { data: FeedResponse }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: RankTabs.tsx(Client)**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "推荐" },
  { href: "/rank/hot", label: "热点榜" },
  { href: "/rank/best", label: "爆文榜" },
];

export function RankTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b mb-4">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`pb-2 ${active ? "border-b-2 border-black font-medium" : "text-gray-500"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: WeightDrawer.tsx(Client)**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_FEED_WEIGHTS, type FeedWeights } from "@bytedance-aigc/shared";

const KEY = "phase24:feed-weights";

export function WeightDrawer() {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState<FeedWeights>(DEFAULT_FEED_WEIGHTS);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setW(JSON.parse(raw));
    } catch {
      /* noop */
    }
  }, []);

  function commit(next: FeedWeights) {
    localStorage.setItem(KEY, JSON.stringify(next));
    setW(next);
    const sp = new URLSearchParams();
    sp.set("alpha", String(next.alpha));
    sp.set("beta", String(next.beta));
    sp.set("gamma", String(next.gamma));
    router.replace(`?${sp.toString()}`);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-sm underline">
        权重设置
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setOpen(false)}>
          <div
            className="absolute right-0 top-0 bottom-0 w-80 bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-medium mb-3">排序权重</h3>
            {(["alpha", "beta", "gamma"] as const).map((k) => (
              <label key={k} className="block mb-3 text-sm">
                {k} ({w[k].toFixed(2)})
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={w[k]}
                  onChange={(e) => setW({ ...w, [k]: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </label>
            ))}
            <button
              onClick={() => commit(w)}
              className="bg-black text-white px-4 py-2 rounded text-sm"
            >
              应用
            </button>
            <button onClick={() => commit(DEFAULT_FEED_WEIGHTS)} className="ml-2 text-sm underline">
              恢复默认
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: LoadMore.tsx(Client)**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedResponse, PostDto } from "@bytedance-aigc/shared";
import { PostCard } from "./PostCard";

export function LoadMore({
  initialCursor,
  endpoint,
}: {
  initialCursor: string | null;
  endpoint: string;
}) {
  const [items, setItems] = useState<PostDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cursor || !sentinel.current) return;
    const obs = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loading) return;
      setLoading(true);
      const url = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}${endpoint}&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await fetch(url);
        const data = (await res.json()) as FeedResponse;
        setItems((prev) => [...prev, ...data.items]);
        setCursor(data.nextCursor);
      } finally {
        setLoading(false);
      }
    });
    obs.observe(sentinel.current);
    return () => obs.disconnect();
  }, [cursor, endpoint, loading]);

  return (
    <>
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      <div ref={sentinel} className="h-10 mt-4 text-center text-sm text-gray-400">
        {loading ? "加载中…" : cursor ? "下拉加载更多" : "已加载全部"}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/_components/
git commit -m "feat(web): Phase 2.4 T16 — PostCard/FeedList/RankTabs/WeightDrawer/LoadMore"
```

---

## Task 17: 前端 5 个页面

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/rank/hot/page.tsx`
- Create: `apps/web/src/app/rank/best/page.tsx`
- Modify: `apps/web/src/app/post/[id]/page.tsx`
- Create: `apps/web/src/app/me/works/page.tsx`

- [ ] **Step 1: 信息流首页(重写 page.tsx)**

```tsx
import type { FeedResponse } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "./_components/FeedList";
import { RankTabs } from "./_components/RankTabs";
import { WeightDrawer } from "./_components/WeightDrawer";
import { LoadMore } from "./_components/LoadMore";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ alpha?: string; beta?: string; gamma?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: "10" });
  if (sp.alpha) qs.set("alpha", sp.alpha);
  if (sp.beta) qs.set("beta", sp.beta);
  if (sp.gamma) qs.set("gamma", sp.gamma);
  const data = await serverFetchJson<FeedResponse>(`/feed?${qs.toString()}`);

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">信息流</h1>
        <WeightDrawer />
      </div>
      <RankTabs />
      <FeedList data={data} />
      <LoadMore initialCursor={data.nextCursor} endpoint={`/feed?${qs.toString()}`} />
    </main>
  );
}
```

- [ ] **Step 2: /rank/hot/page.tsx**

```tsx
import type { FeedResponse } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";
import { FeedList } from "../../_components/FeedList";
import { RankTabs } from "../../_components/RankTabs";
import { WeightDrawer } from "../../_components/WeightDrawer";
import { LoadMore } from "../../_components/LoadMore";

export default async function HotPage({
  searchParams,
}: {
  searchParams: Promise<{ alpha?: string; beta?: string; gamma?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: "10" });
  if (sp.alpha) qs.set("alpha", sp.alpha);
  if (sp.beta) qs.set("beta", sp.beta);
  if (sp.gamma) qs.set("gamma", sp.gamma);
  const data = await serverFetchJson<FeedResponse>(`/rank/hot?${qs.toString()}`);

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">热点榜(12h)</h1>
        <WeightDrawer />
      </div>
      <RankTabs />
      <FeedList data={data} />
      <LoadMore initialCursor={data.nextCursor} endpoint={`/rank/hot?${qs.toString()}`} />
    </main>
  );
}
```

- [ ] **Step 3: /rank/best/page.tsx**

仿照 hot,把 `/rank/hot` 全替换为 `/rank/best`,标题换"爆文榜(72h)"。

- [ ] **Step 4: 重写 /post/[id]/page.tsx**

```tsx
import { notFound } from "next/navigation";
import type { PostDetailDto } from "@bytedance-aigc/shared";
import { serverFetchJson } from "@/lib/server-fetch";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let post: PostDetailDto;
  try {
    post = await serverFetchJson<PostDetailDto>(`/post/${id}`);
  } catch {
    notFound();
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">{post!.title}</h1>
      <div className="text-sm text-gray-500 mb-4">
        {post!.authorHandle} · {new Date(post!.publishedAt).toLocaleString("zh-CN")} · Q{" "}
        {post!.qualityOverall.toFixed(0)}
      </div>
      <article className="prose">{renderNode(post!.body)}</article>
    </main>
  );
}

function renderNode(node: unknown): React.ReactNode {
  if (typeof node !== "object" || node === null) return null;
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "paragraph") {
    return (
      <p>
        {(n.content ?? []).map((c, i) => (
          <span key={i}>{renderNode(c)}</span>
        ))}
      </p>
    );
  }
  if (Array.isArray(n.content)) {
    return n.content.map((c, i) => <div key={i}>{renderNode(c)}</div>);
  }
  return null;
}
```

- [ ] **Step 5: /me/works/page.tsx**

```tsx
import Link from "next/link";
import { cookies } from "next/headers";

interface MeWorksItem {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  mode: string;
  publishedAt: string | null;
  updatedAt: string;
  qualityOverall: number;
  recommendation: "ALLOW" | "WARN" | "BLOCK" | null;
}

export default async function MeWorksPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return <main className="p-4">请先登录</main>;

  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/me/works?status=ALL`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return <main className="p-4">加载失败</main>;
  const data = (await res.json()) as { items: MeWorksItem[] };

  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">我的创作</h1>
      <ul className="space-y-2">
        {data.items.map((it) => (
          <li key={it.id} className="border rounded p-3 flex justify-between">
            <div>
              <Link
                href={it.status === "PUBLISHED" ? `/post/${it.id}` : `/drafts/${it.id}`}
                className="font-medium"
              >
                {it.title}
              </Link>
              <div className="text-xs text-gray-500 mt-1">
                {it.status} · {it.mode} · 更新于 {new Date(it.updatedAt).toLocaleString("zh-CN")}
              </div>
            </div>
            <div className="text-xs text-right">
              <div>Q {it.qualityOverall.toFixed(0)}</div>
              {it.recommendation && <div>{it.recommendation}</div>}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

> 注:cookie 名 `auth_token` 看仓库实际(可能叫 `access_token` / `bytedance-aigc-token`)。

- [ ] **Step 6: 跑 dev 手测 5 页**

```bash
pnpm --filter @bytedance-aigc/api start:dev &
pnpm --filter @bytedance-aigc/web dev &
# 浏览器:/ , /rank/hot , /rank/best , /post/<id> , /me/works
```

- [ ] **Step 7: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/rank/ apps/web/src/app/post/ apps/web/src/app/me/
git commit -m "feat(web): Phase 2.4 T17 — 5 个 SSR 页面(信息流/双榜单/详情/我的创作)"
```

---

## Task 18: 前端单测(PostCard + WeightDrawer)

**Files:**

- Create: `apps/web/src/app/_components/PostCard.test.tsx`
- Create: `apps/web/src/app/_components/WeightDrawer.test.tsx`

- [ ] **Step 1: PostCard.test.tsx**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PostCard } from "./PostCard";

describe("PostCard", () => {
  const post = {
    id: "p1",
    title: "测试标题",
    authorId: "a1",
    authorHandle: "demo",
    publishedAt: "2026-06-04T00:00:00Z",
    qualityOverall: 88,
    hotnessMock: 50,
    coverIndex: 2,
    excerpt: "测试摘要",
  };

  it("渲染标题/作者/分数", () => {
    render(<PostCard post={post} />);
    expect(screen.getByText("测试标题")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText(/Q 88/)).toBeInTheDocument();
  });

  it("链接指向 /post/:id", () => {
    render(<PostCard post={post} />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe("/post/p1");
  });
});
```

- [ ] **Step 2: WeightDrawer.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WeightDrawer } from "./WeightDrawer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("WeightDrawer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("点击按钮打开抽屉", () => {
    render(<WeightDrawer />);
    fireEvent.click(screen.getByText("权重设置"));
    expect(screen.getByText("排序权重")).toBeInTheDocument();
  });

  it("点击应用后写入 localStorage", () => {
    render(<WeightDrawer />);
    fireEvent.click(screen.getByText("权重设置"));
    fireEvent.click(screen.getByText("应用"));
    const stored = localStorage.getItem("phase24:feed-weights");
    expect(stored).toBeTruthy();
    const w = JSON.parse(stored!);
    expect(w.alpha).toBeCloseTo(0.5);
  });

  it("恢复默认按钮重置 weights", () => {
    localStorage.setItem(
      "phase24:feed-weights",
      JSON.stringify({ alpha: 0.9, beta: 0.05, gamma: 0.05 }),
    );
    render(<WeightDrawer />);
    fireEvent.click(screen.getByText("权重设置"));
    fireEvent.click(screen.getByText("恢复默认"));
    const w = JSON.parse(localStorage.getItem("phase24:feed-weights")!);
    expect(w.alpha).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 3: 跑 web 单测**

```bash
pnpm --filter @bytedance-aigc/web test
```

预期:全绿。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/_components/PostCard.test.tsx apps/web/src/app/_components/WeightDrawer.test.tsx
git commit -m "test(web): Phase 2.4 T18 — PostCard + WeightDrawer 单测"
```

---

## Task 19: README + Lighthouse + 五连绿收口

**Files:**

- Modify: `README.md`
- Create: `docs/perf/lighthouse-feed-2026-06-XX.png`

- [ ] **Step 1: README 加 Phase 2.4 小节**

在 README "Phase 2.3" 小节之后追加:

```markdown
### Phase 2.4 信息流分发(读路径)

实现 PRD §5 的 5 页面 + 6 个 GET 端点,核心是排序公式与权重 UI:

- 排序公式:`score = α·QualityScore + β·HotnessScore + γ·TimeDecayScore`
- 默认权重:`α=0.5 / β=0.3 / γ=0.2`,UI 抽屉可调,localStorage 持久化
- 三种 mode:`/feed`(τ=24h,30d 窗口)、`/rank/hot`(τ=12h,12h 窗口)、`/rank/best`(τ=72h,72h 窗口)
- HotnessScore 在本 phase 用确定性 mock(`hotnessMockBase`),Phase 2.5 接埋点后单点替换
- SSR(Next.js 16 Server Components)首屏 LCP ≤ 2.5s
- Cursor 翻页编码 `{rank, weights}`,翻页中途调权重 → 400 强制回第一页

页面:

- `/` 信息流首页
- `/rank/hot` 热点榜
- `/rank/best` 爆文榜
- `/post/:id` 详情页
- `/me/works` 我的创作
```

- [ ] **Step 2: 跑 Lighthouse 取 LCP 截图**

```bash
pnpm --filter @bytedance-aigc/api start:dev &
pnpm --filter @bytedance-aigc/web build && pnpm --filter @bytedance-aigc/web start &
sleep 5
mkdir -p docs/perf
# 手动:Chrome → DevTools → Lighthouse → Performance → 截屏存到 docs/perf/lighthouse-feed-2026-06-XX.png
```

预期:LCP < 2.5s。若不达标,排查 next/image 用法 / SSR fetch 阻塞 / cover 图大小。

- [ ] **Step 3: 全仓五连绿**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm --filter @bytedance-aigc/api test:e2e
```

预期:全绿。e2e 应 ≥ 64(Phase 2.3 末态 49 + 新增 ~15)。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/perf/
git commit -m "docs(readme): Phase 2.4 信息流分发小节 + Lighthouse 截图"
```

- [ ] **Step 5: spec/plan 归档**

```bash
mkdir -p docs/superpowers/specs/shipped docs/superpowers/plans/shipped
git mv docs/superpowers/specs/2026-06-04-phase-2-4-feed-and-rank.md docs/superpowers/specs/shipped/
git mv docs/superpowers/plans/2026-06-04-phase-2-4-feed-and-rank.md docs/superpowers/plans/shipped/
git commit -m "docs(archive): Phase 2.4 spec/plan 归档"
```

---

## Self-Review Checklist(执行前过一遍)

- [ ] 19 个 task 全部有具体代码或具体命令,无 TBD/TODO
- [ ] T4 单测从 `@bytedance-aigc/shared` 导入(api 已配 paths)
- [ ] T7 feed.service `normalizeHotness` 顶部 import,不要 require
- [ ] T14 e2e 的 `signTestToken` helper 名按仓库实际改正
- [ ] T17 `/me/works` 的 cookie 名按仓库实际改正
- [ ] e2e 用例数应增 ~15(feed 4 + rank 3 + post-detail 3 + me-works 3 + ranking 16 单测)

---

## 失败与回滚

每个 task 都是独立 commit;若 Tn 后五连/e2e 不绿,可 `git reset --hard HEAD~1` 单步回滚。

migration(T1)若已 apply 但需回滚:`prisma migrate resolve --rolled-back <name>` + 手 SQL `DROP TABLE post_stats CASCADE;`(Phase 2.4 不写入,直接删表无数据损失)。
