# AI 创作者辅助生产与分发平台 — 技术文档

> Phase 2.28 交付物 #2 · 飞书在线文档本地草稿 · 2026-06-10

## 1. 项目概述

### 1.1 定位与三角色叙事

面向创作者的 AI 辅助生产与分发平台，覆盖中长图文（头条资讯形态），围绕三个角色叙事构建：

| 角色     | 职责                                       | 对应 PRD 章节 |
| -------- | ------------------------------------------ | ------------- |
| 得力助手 | 双轨创作、AI 工具卡、两层 Prompt 体系      | §3            |
| 守门员   | 5 阶段审核、4 维质量评分、规则库、素材合规 | §4            |
| 导航员   | 信息流分发、加权排序、双榜单、数据回流诊断 | §5            |

### 1.2 核心功能架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         apps/web (Next.js 16)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  创作工作台   │  │  安全/质量面板│  │  信息流/榜单  │  │  Admin    │  │
│  │  TipTap Editor│  │  ScorePanel  │  │  Feed+Rank   │  │  工作台   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                  │                │         │
└─────────┼─────────────────┼──────────────────┼────────────────┼─────────┘
          │ HTTP/SSE        │ HTTP             │ HTTP           │ HTTP
┌─────────┼─────────────────┼──────────────────┼────────────────┼─────────┐
│         ▼                 ▼                  ▼                ▼         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     apps/api (NestJS 11)                         │   │
│  │                                                                  │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │   │
│  │  │ creation/  │  │ reviews/   │  │   feed/    │  │  admin/  │  │   │
│  │  │ drafts     │  │ rule-loader│  │  ranking   │  │ prompt-  │  │   │
│  │  │ tools      │  │ safe-rewrite│ │  feed.svc  │  │  lab     │  │   │
│  │  │ outline    │  │ scoring    │  │  posts     │  │ reports  │  │   │
│  │  │ sections   │  │ asset-     │  │  me        │  │ sample-  │  │   │
│  │  │ prompts    │  │  review    │  │            │  │  audit   │  │   │
│  │  │ assets     │  │            │  │            │  │ rule-    │  │   │
│  │  │ versions   │  │            │  │            │  │ recheck  │  │   │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────┬─────┘  │   │
│  │        │               │               │              │         │   │
│  │  ┌─────┴───────────────┴───────────────┴──────────────┴─────┐   │   │
│  │  │                    共享基础设施                              │   │   │
│  │  │  auth/  llm/  prisma/  config/  logging/  health         │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                 │                                       │
│              ┌──────────────────┼──────────────────┐                   │
│              ▼                  ▼                  ▼                    │
│        ┌──────────┐      ┌──────────┐      ┌──────────┐               │
│        │PostgreSQL│      │  Redis   │      │  LLM API │               │
│        │   (Prisma)│      │ (本地缓存)│      │(OpenAI SDK)│              │
│        └──────────┘      └──────────┘      └──────────┘               │
│                                                                        │
│                    Docker Compose 本地开发环境                           │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. 技术选型

### 2.1 Monorepo: pnpm workspace

```
bytedance-aigc/
├── apps/
│   ├── web         # Next.js 16 + React 19 — 用户界面 + SSR
│   └── api         # NestJS 11 — 业务编排 + AI 网关 + 审核 + 评分
├── packages/
│   └── shared      # TS 类型 / 常量 / 枚举 / 排序算法(双端共用)
└── docker-compose.yml  # 本地 PG 16 + Redis 7
```

### 2.2 前端: Next.js 16 + React 19 + Tailwind v4

| 选型         | 版本   | 理由                               |
| ------------ | ------ | ---------------------------------- |
| Next.js      | 16.2.6 | App Router SSR + Server Components |
| React        | 19.2.4 | 并发特性 + use() hook              |
| Tailwind CSS | v4     | 原子化样式，无设计系统依赖         |
| TipTap       | 3.26.x | 基于 ProseMirror 的富文本编辑器    |
| idb-keyval   | 6.2.5  | IndexedDB 离线缓存轻量封装         |
| Vitest       | 4.1.7  | 单元测试                           |
| Playwright   | -      | 端到端测试                         |

### 2.3 后端: NestJS 11 + Prisma 5 + PostgreSQL + Redis

| 选型         | 版本 | 理由                                    |
| ------------ | ---- | --------------------------------------- |
| NestJS       | 11   | 模块化架构，Guard/Interceptor/Pipe 切面 |
| Prisma       | 5    | 类型最强 ORM，schema 单一事实源         |
| PostgreSQL   | 16   | JSON 字段支持(text[])，全文检索基础     |
| Redis        | 7    | 榜单 sorted set / 缓存(预留)            |
| OpenAI SDK   | -    | 兼容层，支持火山方舟/DeepSeek/OpenAI    |
| p-limit      | -    | 并发控制(评测/批量复审)                 |
| Aho-Corasick | 自写 | 敏感词扫描 Web Worker，主线程零阻塞     |

### 2.4 大模型: OpenAI SDK 兼容层

通过 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 三项 .env 配置，支持任意 OpenAI 兼容端点：

| 厂商         | LLM_BASE_URL 示例                          | LLM_MODEL 示例      |
| ------------ | ------------------------------------------ | ------------------- |
| OpenAI 官方  | `https://api.openai.com/v1`                | `gpt-4o-mini`       |
| 火山方舟 ARK | `https://ark.cn-beijing.volces.com/api/v3` | `ep-20260101-xxxxx` |
| DeepSeek     | `https://api.deepseek.com/v1`              | `deepseek-chat`     |
| 自建/中转    | `https://<host>/v1`                        | 视网关而定          |

切换厂商只改 .env 三项 + 重启 api，代码不绑定厂商。

## 3. 模块设计

### 3.1 创作工作台（得力助手）

#### 双轨创作

| 模式 | 流程                                | 特点                    |
| ---- | ----------------------------------- | ----------------------- |
| FAST | 选题 -> 大纲(同步) -> 流式正文(SSE) | AI 主导，两段 POST 接力 |
| FINE | 人工编辑 + 按需调用 AI 工具卡       | 人主导，AI 辅助         |

#### TipTap 编辑器

- 基于 ProseMirror，ProseMirror JSON 落 `drafts.body Json` 字段
- 自动保存：`useAutosave` hook，1.5s 防抖，PATCH `{title, body}`
- SSR 配方：`useEditor({ immediatelyRender: false })` 避免 hydration mismatch
- 离线兜底：IndexedDB 1s 防抖 + 云端 30s 周期 + 版本号乐观锁

#### 流式 AI 输出

- SSE 帧：`section.start` / `token` / `section.end` / `done` / `error`
- 流式期间暂停 `useAutosave`，流前/流末各一次 `flush()` 落库
- 连续违规检测：`StreamSessionStore` 内存级记录，>= 3 段 high 中断流式

#### 两层 Prompt 体系

| 层级     | 存储    | 权限                | 数量  |
| -------- | ------- | ------------------- | ----- |
| 平台内置 | DB seed | 只读(默认款+风格款) | 24 条 |
| 作者私人 | DB CRUD | 复制后可编辑        | 不限  |

- 平台保留 Prompt（SAFETY_REVIEW 等 6 条）不可复制、不可见
- 3 快照版本管理 + "恢复默认"按钮（Phase 2.17）

### 3.2 安全与质量管控（守门员）

#### 5 阶段审核

| 阶段   | 触发点              | 实现方式                          |
| ------ | ------------------- | --------------------------------- |
| Prompt | 选题/提示失焦 800ms | LLM 7 类目审核 + Banner 提示      |
| 输入   | TipTap update 1.5s  | Aho-Corasick Worker + 波浪线      |
| 生成中 | 段落流式完成        | LLM + 段落红框 + 连续违规中断     |
| 发布前 | 点"发布"            | 双 LLM 并发(safety+quality)       |
| 发布后 | 举报/抽样/规则复审  | 举报闭环 + 5% 抽样 + 规则版本复审 |

#### 4 维质量分

| 维度     | 评分范围 | 含义       |
| -------- | -------- | ---------- |
| 内容价值 | 0-100    | 信息密度   |
| 表达质量 | 0-100    | 行文流畅度 |
| 读者体验 | 0-100    | 可读性     |
| 传播潜力 | 0-100    | 传播预期   |

发布前与安全审核并行运行（同一 Review 记录），推荐结果 ALLOW/WARN/BLOCK。

#### 规则库

- 7 个 YAML（pornography/gambling/abuse/fraud/illicit_ads + politics/drugs 降级为词库）
- schema: `rule_id / category / severity / description / prompt_hint / examples_positive / examples_negative`
- 敏感词库：`sensitive-words.json`，5 类目共 140 条

#### 素材合规

- 两次校验：INGEST（入库严格）+ PRE_INSERT（插入前宽松）
- 4 维度：face / watermark / sensitive / ai_unmarked
- AI 未标注硬规则：aiDeclared=false + ai_unmarked=high + aiGenerated=false -> INGEST BLOCK

### 3.3 内容分发（导航员）

#### 排序公式

```
score = alpha * QualityScore + beta * HotnessScore + gamma * TimeDecayScore
```

- `TimeDecayScore = exp(-deltaHours / tau) * 100`
- `normalizeHotness`：pool < 50 用 P95，防止单 outlier 压低其他
- 信息流默认 alpha=0.5 / beta=0.3 / gamma=0.2，前端可热调

#### 双榜单

| 榜单   | tau | 窗口 | alpha | beta | gamma | 偏好     |
| ------ | --- | ---- | ----- | ---- | ----- | -------- |
| 热点榜 | 12h | 12h  | 0.2   | 0.5  | 0.3   | 实时热度 |
| 爆文榜 | 72h | 72h  | 0.5   | 0.4  | 0.1   | 质量沉淀 |

#### 数据回流诊断

`FeedService.diagnosePost()` 根据阅读/互动/质量数据，返回优化建议 + 推荐工具：

- 低阅读 + 高质量 -> "好文章被埋了" / HEADLINE_NEW
- 高阅读 + 低完读 -> "标题吸引但留不住" / REWRITE_OPENING
- 低阅读 + 高完读 -> "写得好但话题冷" / ADD_TOPIC
- 低互动率 -> "缺少互动钩子" / ADD_TOPIC

## 4. 数据模型

### 4.1 ER 图（Prisma schema）

```
User 1──N Draft 1──N DraftVersion
     │         │
     │         ├── 1──0..1 PostStat
     │         ├── 1──N Review
     │         ├── 1──N Report
     │         ├── 1──N SampleAudit
     │         └── 1──N Notification
     │
     ├── 1──N Prompt 1──N PromptSnapshot
     │              └── 1──N PromptEvalRun
     │
     ├── 1──N Asset
     └── 1──N Report (as reporter)

PromptLabAction (独立审计表)
RuleRecheckRun  (独立运行记录表)
PromptTestCase  (独立测试用例表)
```

### 4.2 核心表字段

| 表                 | 关键字段                                                                    | 说明                |
| ------------------ | --------------------------------------------------------------------------- | ------------------- |
| users              | id, handle, createdAt                                                       | MVP 单角色"作者"    |
| drafts             | id, authorId, mode, status, title, body(Json), publishedBody?               | 核心内容实体        |
| draft_versions     | id, draftId, kind(AUTO/NAMED/PUBLISHED/OFFLINE_CONFLICT), snapshot          | 版本历史            |
| prompts            | id, owner(PLATFORM/PRIVATE), tool, systemPrompt, isStarter                  | 两层 Prompt         |
| prompt_snapshots   | id, promptId, systemPrompt, createdAt                                       | 3 快照版本管理      |
| reviews            | id, draftId, stage, safety(Json), quality(Json), recommendation             | 审核记录            |
| post_stats         | id, draftId, impression, click, dwellUnit, like                             | 热度数据            |
| reports            | id, postId, reporterId, category, status, resolution                        | 举报闭环            |
| sample_audits      | id, draftId, status, reviewedBy                                             | 5% 抽样巡检         |
| rule_recheck_runs  | id, ruleVersion, totalScanned, totalOffline, status                         | 规则版本复审        |
| assets             | id, userId, key, url, aiGenerated, sceneTags[], subjectTags[], reviewStatus | 素材管理            |
| prompt_test_cases  | id, tool, input, expected, category                                         | Prompt 实验室测试集 |
| prompt_eval_runs   | id, tool, promptId, totalCases, accuracy, stability, status                 | 评估运行            |
| prompt_lab_actions | id, tool, action, fromPromptId, toPromptId, evalRunId, operatedBy           | 操作审计            |
| notifications      | id, userId, type, title, body, read                                         | 通知中心            |

### 4.3 枚举

| 枚举                 | 值                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- |
| DraftStatus          | DRAFT / REVIEWING / PUBLISHED / OFFLINE                                            |
| DraftMode            | FAST / FINE                                                                        |
| DraftToolType        | 9 创作 + 6 平台保留 + DATA_DIAGNOSIS = 16 种                                       |
| ReviewStage          | PREFLIGHT / PROMPT_INPUT / SECTION_INLINE / POST_PUBLISH                           |
| ReviewRecommendation | ALLOW / WARN / BLOCK                                                               |
| AssetReviewStatus    | PENDING / PASSED / WARNED / BLOCKED                                                |
| PromptEvalRunStatus  | RUNNING / DONE / FAILED                                                            |
| NotificationType     | PUBLISH_APPROVED / PUBLISH_REJECTED / POST_TAKEN_DOWN / HOT_RANK / MILESTONE_VIEWS |

## 5. API 设计

### 5.1 核心端点清单

#### 创作工作台

| 方法  | 端点                               | 说明                   |
| ----- | ---------------------------------- | ---------------------- |
| POST  | `/drafts`                          | 新建草稿               |
| GET   | `/drafts`                          | 列表                   |
| GET   | `/drafts/mine`                     | 我的草稿               |
| GET   | `/drafts/:id`                      | 详情                   |
| PATCH | `/drafts/:id`                      | 更新(自动保存)         |
| POST  | `/drafts/:id/outline`              | FAST 模式生成大纲      |
| POST  | `/drafts/:id/sections/stream`      | FAST 模式流式正文(SSE) |
| POST  | `/drafts/:id/tools/invoke`         | AI 工具卡调用          |
| POST  | `/drafts/:id/edit`                 | 已发布稿改回草稿       |
| POST  | `/drafts/:id/publish`              | 发布                   |
| POST  | `/drafts/:id/takedown`             | 作者主动下线           |
| POST  | `/drafts/:id/restore-from-offline` | OFFLINE 重新提审       |

#### 版本管理

| 方法 | 端点                                | 说明           |
| ---- | ----------------------------------- | -------------- |
| GET  | `/drafts/:id/versions`              | 版本列表       |
| GET  | `/drafts/:id/versions/:vid`         | 版本详情       |
| POST | `/drafts/:id/versions`              | 创建命名版本   |
| POST | `/drafts/:id/versions/:vid/restore` | 回滚到指定版本 |

#### Prompt 管理

| 方法   | 端点                                     | 说明                    |
| ------ | ---------------------------------------- | ----------------------- |
| GET    | `/prompts`                               | 平台 + 私人 Prompt 列表 |
| GET    | `/prompts/:id`                           | 详情                    |
| GET    | `/prompts/private`                       | 我的私人 Prompt         |
| POST   | `/prompts/:platformId/copy`              | 复制平台 Prompt 到私人  |
| PATCH  | `/prompts/:id`                           | 编辑私人 Prompt         |
| DELETE | `/prompts/:id`                           | 删除私人 Prompt         |
| GET    | `/prompts/:id/snapshots`                 | 快照列表(最多 3 条)     |
| POST   | `/prompts/:id/snapshots/:snapId/restore` | 回滚到快照              |

#### 审核

| 方法 | 端点                    | 说明                    |
| ---- | ----------------------- | ----------------------- |
| POST | `/drafts/:id/preflight` | 发布前审核(双 LLM 并发) |
| GET  | `/drafts/:id/reviews`   | 历史审核记录            |
| POST | `/reviews/prompt`       | Prompt 阶段审核         |
| POST | `/reviews/section`      | 生成中段落审核          |
| POST | `/reviews/safe-rewrite` | 一键合规替代(SSE)       |

#### 信息流与榜单

| 方法 | 端点                 | 说明                  |
| ---- | -------------------- | --------------------- |
| GET  | `/feed`              | 信息流(权重可调)      |
| GET  | `/rank/hot`          | 热点榜                |
| GET  | `/rank/best`         | 爆文榜                |
| GET  | `/post/:id`          | 文章详情              |
| GET  | `/authors/:id/posts` | 作者已发布稿          |
| GET  | `/me/works`          | 我的作品(草稿+已发布) |
| GET  | `/me/analytics`      | 数据分析              |

#### 举报

| 方法 | 端点                 | 说明               |
| ---- | -------------------- | ------------------ |
| POST | `/posts/:id/reports` | 提交举报           |
| GET  | `/me/reports`        | 我的稿件被举报记录 |

#### 素材

| 方法 | 端点                           | 说明           |
| ---- | ------------------------------ | -------------- |
| POST | `/assets/upload`               | 上传素材       |
| POST | `/assets/generate`             | AI 生图(mock)  |
| GET  | `/assets/mine`                 | 我的素材       |
| GET  | `/assets/search`               | 搜索(按标签)   |
| POST | `/assets/recommend`            | 推荐素材       |
| POST | `/assets/:id/check-for-insert` | 插入前合规校验 |

#### Admin

| 方法 | 端点                                      | 说明             |
| ---- | ----------------------------------------- | ---------------- |
| POST | `/admin/drafts/:id/offline`               | Admin 下线稿件   |
| GET  | `/admin/posts/:id`                        | Admin 查看稿件   |
| GET  | `/admin/reports`                          | 举报列表         |
| POST | `/admin/reports/:id/resolve`              | 处置举报         |
| POST | `/admin/sample-audits/enqueue`            | 触发 5% 抽样巡检 |
| GET  | `/admin/sample-audits`                    | 抽样巡检列表     |
| POST | `/admin/sample-audits/:id/decide`         | 巡检判定         |
| POST | `/admin/rule-rechecks`                    | 触发规则版本复审 |
| GET  | `/admin/rule-rechecks`                    | 规则复审列表     |
| POST | `/admin/prompt-lab/test-cases`            | 创建测试用例     |
| GET  | `/admin/prompt-lab/test-cases`            | 列出测试用例     |
| POST | `/admin/prompt-lab/eval-runs`             | 触发评估运行     |
| GET  | `/admin/prompt-lab/eval-runs`             | 评估运行列表     |
| GET  | `/admin/prompt-lab/eval-runs/:id/compare` | 版本对比         |
| POST | `/admin/prompt-lab/eval-runs/:id/promote` | 确认上线         |
| POST | `/admin/prompt-lab/rollback`              | 回滚             |

#### 认证与通知

| 方法  | 端点                          | 说明     |
| ----- | ----------------------------- | -------- |
| POST  | `/auth/login`                 | JWT 登录 |
| GET   | `/notifications`              | 通知列表 |
| PATCH | `/notifications/:id/read`     | 标记已读 |
| PATCH | `/notifications/read-all`     | 全部已读 |
| GET   | `/notifications/unread-count` | 未读数   |

## 6. 部署架构

### 6.1 Docker Compose 本地开发

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    volumes: [pg_data:/var/lib/postgresql/data]
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]
    ports: ["6379:6379"]
volumes:
  pg_data:
  redis_data:
```

启动步骤：

```bash
cp .env.example .env
pnpm install
pnpm db:up              # 启动 PG + Redis
pnpm prisma:migrate     # 应用迁移
pnpm prisma:seed        # 灌默认 Prompt
pnpm dev                # 启动 web + api
```

### 6.2 生产部署

**当前状态**：公网 URL 部署需用户提供云平台凭据后执行。

可选方案：

| 方案                  | 前端   | 后端    | 数据库         | 适合场景  |
| --------------------- | ------ | ------- | -------------- | --------- |
| Vercel + Railway      | Vercel | Railway | Railway PG     | 快速 Demo |
| 阿里云函数 + RDS      | Vercel | FC      | RDS PostgreSQL | 国内合规  |
| 单 VPS Docker Compose | Nginx  | Docker  | Docker PG      | 最简方案  |

### 6.3 CI

GitHub Actions 四关：lint / typecheck / test / build，push 到 main 分支自动触发。

## 7. 测试

### 7.1 测试体系

| 层级   | 框架        | 覆盖范围                                 |
| ------ | ----------- | ---------------------------------------- |
| 单元   | Vitest      | Service 层逻辑、排序算法、LLM 适配       |
| 端到端 | Playwright  | 用户操作流程                             |
| 评测   | eval-safety | 安全审核准确率(ChineseHarm-Bench 270 条) |

### 7.2 测试基线

| 指标     | 数量 | 状态 |
| -------- | ---- | ---- |
| api 单测 | 152  | 全绿 |
| e2e 测试 | 162  | 全绿 |
| web 单测 | 80   | 全绿 |

### 7.3 安全评测

- 数据集：ChineseHarm-Bench（arxiv 2506.10960, CC BY-NC 4.0）
- 样本数：270 条（5 类目 x 40 + allow 70）+ 30 条 buffer
- 评测命令：`pnpm --filter @bytedance-aigc/api eval:safety`
- 准确率：0.9333（达标，目标 >= 0.9）

---

> 本文档为飞书在线文档的本地草稿，上传飞书后可补充架构图截图、ER 图可视化等内容。
