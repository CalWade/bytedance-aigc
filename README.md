# AI 创作者辅助生产与分发平台

[![CI](https://github.com/CalWade/bytedance-aigc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CalWade/bytedance-aigc/actions/workflows/ci.yml)

字节头条 AI 前端训练营课题：面向创作者的 AI 辅助生产与分发平台，覆盖**得力助手 / 守门员 / 导航员**三角色叙事，专注中长图文（头条资讯形态）。

> 本仓库为训练营 3 周交付项目，处于 Phase 0 工程化基建阶段。

## 文档

- 产品需求文档（PRD）：[`docs/PRD.md`](./docs/PRD.md)
- 系统架构草稿：[`docs/architecture.md`](./docs/architecture.md)（Phase 0 Step 7 产出）
- 架构决策记录（ADR）：[`docs/decisions/`](./docs/decisions/)
  - [ADR-0001](./docs/decisions/0001-api-framework.md) 后端框架——NestJS
  - [ADR-0002](./docs/decisions/0002-data-layer.md) 数据层 ORM——Prisma

## 核心能力（PRD 摘要）

- **双轨创作入口**：快速稿（AI 主导生成）+ 精耀稿（人主导 + AI 工具）
- **两层 Prompt 体系**：平台内置 Prompt 库（只读默认款）+ 作者私人层（复制后可编辑）
- **5 阶段审核链路**：Prompt / 输入 / 生成（流式）/ 发布前 / 发布后，分级响应
- **4 维质量评分**：内容价值 / 表达质量 / 读者体验 / 传播潜力
- **加权榜单**：`score = α·质量 + β·热度 + γ·时间衰减`，权重 UI 可配置

## 技术栈

| 层       | 选型                                                           |
| -------- | -------------------------------------------------------------- |
| Monorepo | pnpm workspace                                                 |
| 前端     | Next.js 16 + React 19 + Tailwind v4 + App Router（`apps/web`） |
| 后端     | NestJS 11（`apps/api`）                                        |
| 共享     | TypeScript 类型 / 常量 / 工具（`packages/shared`）             |
| 数据     | PostgreSQL + Redis（本地 Docker Compose）                      |
| 测试     | Vitest（单元）+ Playwright（端到端）                           |
| CI       | GitHub Actions（lint / typecheck / test / build 四关）         |

## 本地开发

> 需要：Node ≥ 22、pnpm ≥ 10、Docker（含 Compose v2，docker engine ≥ 20.10）

```bash
# 一次性
cp .env.example .env
pnpm install

# 启动数据基建（PostgreSQL + Redis，后台运行）
pnpm db:up

# 启动应用（apps/web + apps/api 并行 dev 模式）
pnpm dev
```

| 命令            | 作用                                   |
| --------------- | -------------------------------------- |
| `pnpm db:up`    | 启动 Postgres + Redis（后台）          |
| `pnpm db:down`  | 停止容器（保留数据）                   |
| `pnpm db:reset` | 停止并删除数据卷（谨慎，全部数据丢失） |
| `pnpm db:logs`  | 查看容器日志                           |

数据持久化：使用 docker named volume（`pg_data` / `redis_data`），不映射到宿主机文件系统。`pnpm db:down` 不会丢数据，只有 `pnpm db:reset` 会。

### 数据层（Prisma）

`apps/api` 使用 Prisma 5 作为 ORM，schema 单一事实源在 [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma)。

| 命令                   | 作用                                                 |
| ---------------------- | ---------------------------------------------------- |
| `pnpm prisma:generate` | 根据 schema 重新生成 `@prisma/client` 类型           |
| `pnpm prisma:migrate`  | 开发态迁移(修改 schema 后生成 + 应用 SQL,需 PG 在跑) |
| `pnpm prisma:seed`     | 灌入平台默认 Prompt(9 条 starter,dev 幂等)           |
| `pnpm prisma:studio`   | 打开 Prisma Studio 浏览数据                          |

首次接入 / 拉新代码后:

```bash
pnpm db:up                 # 起 PG
pnpm prisma:migrate        # 应用最新迁移到本地库
pnpm prisma:seed           # 灌默认 Prompt(只读浏览端点依赖)
pnpm dev                   # 启动 web + api
```

`apps/api` e2e 测试(`/drafts` + `/prompts` 端点)依赖真实 PG,运行:

```bash
pnpm db:up
pnpm --filter @bytedance-aigc/api test:e2e
```

## 内容生产 / 编辑器

- 路由：`/drafts/[id]` 富文本编辑器；`/drafts/mine` 列表 + 新建按钮
- 编辑器：TipTap（基于 ProseMirror），ProseMirror JSON 落 `drafts.body Json` 字段
- 自动保存：`useAutosave` hook，1.5s 防抖，PATCH 一次发 `{title, body}`，service 端 `version: { increment: 1 }`
- SSR 配方：TipTap `useEditor({ immediatelyRender: false })` 避免 Next.js hydration mismatch
- 端点：`PATCH /drafts/:id`（UserGuard + service 层作者校验，非作者 403，不存在 404）

### FAST 模式 + 9 AI 工具卡 + Prompt 自定义

Phase 2.2 接入：

- **FAST 模式**：选题 → 大纲 → 流式正文。两段 POST 接力 `POST /drafts/:id/outline`(同步返大纲)+ `POST /drafts/:id/sections/stream`(SSE,frame: `section.start` / `token` / `section.end` / `done` / `error`)。流式期间 `useAutosave` 暂停防抖,流前 / 流末各一次 `flush()` 落库。
- **9 个工具卡**:`POST /drafts/:id/tools/invoke`,DTO union narrow 9 种(改写 4 + 标题 2 + 扩展 3)。返候选数组(`text` / `image` 二选一),前端三态卡(采用 / 修改 / 关闭)。
- **两层 Prompt**:平台 starter 9 条只读(`prisma:seed`)+ 私人复制层。`/prompts` Public 列表,`/prompts/private` UserGuard 复制 / 编辑 / 删除。`promptId` 不传时后端自动用 `isStarter:true` 默认款。

## LLM 接入

后端通过 OpenAI SDK + 自定义 `baseURL` 接入,任意 OpenAI 兼容端点都可用。本地 `.env` **必须**填以下三项,否则 api 拒启动:

```
LLM_BASE_URL=<OpenAI 兼容 endpoint>
LLM_API_KEY=<密钥>
LLM_MODEL=<模型/endpoint 标识>
```

典型厂商填法:

| 厂商         | LLM_BASE_URL                                                  | LLM_MODEL 示例                   |
| ------------ | ------------------------------------------------------------- | -------------------------------- |
| OpenAI 官方  | `https://api.openai.com/v1`                                   | `gpt-4o-mini`                    |
| 火山方舟 ARK | `https://ark.cn-beijing.volces.com/api/v3`                    | `ep-20260101-xxxxx`(endpoint id) |
| DeepSeek     | `https://api.deepseek.com/v1`                                 | `deepseek-chat`                  |
| 自建/中转    | 形如 `https://<host>/v1`,需 OpenAI 兼容 chat completions 协议 | 视网关而定                       |

切换厂商只改 `.env` 三项 + 重启 api,代码不绑定厂商。

## Phase 2.3 — 发布前审核 + 4 维质量分

作者点"发布"按钮 → 同步并发跑 2 个 LLM(`SAFETY_REVIEW` + `QUALITY_REVIEW`,温度 0.0/0.4)→ 弹窗展示 6 维安全分 + 4 维质量分 + ALLOW/WARN/BLOCK 推荐 → 通过后落 `status=PUBLISHED`。

- 端点:
  - `POST /drafts/:id/preflight` — 同步,2 次 LLM 并发,落 Review 行
  - `POST /drafts/:id/publish` — 校验 `lastReview.stage===PREFLIGHT && rec!==BLOCK && now-createdAt<24h`,否则 409 PREFLIGHT_REQUIRED/PREFLIGHT_BLOCKED/PREFLIGHT_EXPIRED
  - `GET /drafts/:id/reviews?limit=10` — 历史审核(为 Phase 2.4 发布后审核留接口形态)
- Prompt 体系:`SAFETY_REVIEW` / `QUALITY_REVIEW` 是平台保留 Prompt(PRD §4.7.1 / §4.7.2),`PromptsService.copyToPrivate` 守卫禁止作者复制,`PromptsController.list` 默认隐藏。
- 数据模型:`Review` 表(一对多)+ `Draft.lastReviewId` 快读外键 + `Draft.status` / `Draft.publishedAt`。

## Phase 2.4 — 信息流分发 + 实时排序

PRD §5。已发布稿(复用 `Draft where status='PUBLISHED'`,**未引入 Post 表**)按 `score = α·QualityScore + β·HotnessScore + γ·TimeDecayScore` 实时排序;默认 α=0.5/β=0.3/γ=0.2,前端权重抽屉可热调,通过 query 透传。`HotnessScore` 当前用 `hotnessMockBase(postId)` 确定性 hash 占位,Phase 2.5 接 `PostStat` 表(已建好,空表)在 `feed.service.ts` 单点替换 `// PHASE_2_5_REPLACE_HERE`。

- 端点(均 `@Public()` 公开,`/me/works` 鉴权):
  - `GET /feed?alpha&beta&gamma&cursor&limit` — 信息流(τ=24h、窗口=30d)
  - `GET /rank/hot?cursor&limit` — 热点榜(τ=12h、窗口=12h、固定 α=0.2/β=0.5/γ=0.3)
  - `GET /rank/best?cursor&limit` — 爆文榜(τ=72h、窗口=72h、固定 α=0.5/β=0.4/γ=0.1)
  - `GET /post/:id` — 详情(BLOCK 或非 PUBLISHED 一律 404)
  - `GET /authors/:id/posts` — 作者已发布稿
  - `GET /me/works?status=ALL|PUBLISHED|DRAFT` — 我的作品(草稿+已发布合并视图)
- 排序与分页:`packages/shared/src/ranking.ts` 提供 `timeDecayScore` / `normalizeHotness`(pool<50 用 P95)/ `computeScore`;cursor 编码 `{rank, weights}` base64url,翻页时 `weights` 不一致返 400 `CURSOR_WEIGHTS_MISMATCH` 强制回到第 1 页。
- Fixtures:3 作者(demo/tech/life) × 10 PUBLISHED = 30 条,`publishedAt = now - i·6h - 30min`(前 2 落 12h 窗口,前 12 落 72h 窗口),5 张 WebP 封面在 `apps/web/public/covers/`。
- 前端 SSR:`page.tsx`(信息流)/ `rank/hot` / `rank/best` / `post/[id]` 均 Server Component;`me/works` 客户端鉴权。`WeightDrawer` localStorage(`phase24:feed-weights`)+ `router.replace(?alpha&beta&gamma)` 热调权重。`LoadMore` 用 IntersectionObserver 触发 cursor 下一页。

## Phase 2.5 — 三阶段内容审核 + 规则库 + 准确率验证

PRD §4.1.1-4.1.3 三阶段审核全部接通:

- **① Prompt 阶段**:`FastModeDialog` 中 topic / hint 失焦 800ms 防抖触发 `POST /reviews/prompt`,LLM 7 类目审核(politics / pornography / gambling / drugs / vulgarity / fraud / medical),命中 BLOCK / WARN 弹 `PromptReviewBanner`,作者可"换角度"或"有把握继续"。WHY 不落库:① 阶段触发频次高(每次失焦)且无 draftId 关联,reviewId 仅作日志追溯。
- **② 输入阶段**:TipTap `update` 1.5s 防抖,`sensitive-scanner.worker.ts` Web Worker 内自写 Aho-Corasick 自动机扫描静态词库(`packages/shared/src/sensitive-words.json`),命中通过 `review-decorations` ProseMirror 插件渲染红/橙/灰波浪线,主线程零阻塞。
- **③ 生成中阶段**:`SectionStream.onSectionEnd` fire-and-forget `POST /reviews/section`,命中 → 段落红框 + `SectionReviewCard`(重新生成 / 修改建议 / 仍要保留 — Phase 2.6 实现);`StreamSessionStore` 内存级记录同 sessionId 连续违规,≥ 3 段 high → `abortStream=true` 中断流式(沿用 `useStreamingGeneration.stop()` 的 AbortController)。

#### 规则库 §4.4

- 位置:[`packages/shared/rules/`](./packages/shared/rules/) 7 个 yaml(politics / pornography / gambling / drugs / vulgarity / fraud / medical)
- schema:`rule_id` / `category` / `severity` / `description` / `prompt_hint` / `examples_positive` / `examples_negative`
- `review.service` 启动时 `loadRules()` 加载并缓存,审核请求时 `buildPromptHints()` 拼接到 system message
- 词库:[`packages/shared/src/sensitive-words.json`](./packages/shared/src/sensitive-words.json) 7 类目静态 JSON,Worker 启动一次性注入

#### 准确率指标 §4.4.3

- 标注集:[`apps/api/test/fixtures/safety-eval/`](./apps/api/test/fixtures/safety-eval/) 7 类目 + allow.jsonl,目标 ≥ 350 条(当前 40 条占位骨架,PE 分批补齐)
- 数量校验:`pnpm --filter @bytedance-aigc/api exec ts-node scripts/eval-fixtures-count.ts`
- 跑评估:`pnpm --filter @bytedance-aigc/api eval:safety`(消耗真 LLM 配额,fixtures 补齐后再跑)
- 报告位置:[`docs/perf/safety-eval-YYYY-MM-DD.md`](./docs/perf/) 类目级 P/R/F1 + 总体 Accuracy
- **目标 Accuracy ≥ 90%**(PRD §4.4.3 硬指标)

## 交付物清单

- [x] PRD 终稿
- [ ] 可运行系统（线上 URL / 二维码）
- [ ] 飞书技术文档
- [ ] 效果评估报告
- [ ] 规则库说明文档
- [ ] GitHub 项目代码（`main` 分支）

## License

[MIT](./LICENSE)
