# AI 创作者辅助生产与分发平台

> 课题：[头条AI前端训练营 - AI 创作者辅助生产与分发平台](https://bytedance.larkoffice.com/wiki/ZGiXwNujIiK4lNkMGObcJdtyn1g)

---

## 基本信息

| **项目名称** | AI 创作者辅助生产与分发平台                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **作者**     | 韦贺文 (CalvinWade)                                                                                                                                                                     |
| **技术栈**   | 前端 Next.js 16 + React 19 + Tailwind CSS v4 + TipTap / 后端 NestJS 11 + Prisma 5 + PostgreSQL 16 / 数据库 PostgreSQL 16 + Redis 7 / AI 能力 DeepSeek-V4-Flash + 阿里云 MultiModalGuard |

---

## 体验地址

- **在线访问地址**：本地开发模式，`pnpm dev` 启动后访问 `http://localhost:3000`
- **测试账号 / 密码**：通过 `/register` 页面手机号注册即可使用
- **演示视频**：（待录制，覆盖创作 → 审核 → 分发全链路）

---

## 项目介绍文档

### 项目简介

面向中长图文创作者的一站式 AI 辅助平台，围绕"得力助手 / 守门员 / 导航员"三角色叙事，覆盖从 AI 辅助创作、内容安全与质量管控、到智能分发与数据回流的完整闭环。

### 核心功能介绍

**AIGC 内容创作（得力助手）**

- **双轨创作模式**：FAST 模式（AI 主导：选题 → 大纲确认 → 逐段流式生成）和 FINE 模式（人主导：手动编辑 + 按需调用 AI 工具），两种模式可自由切换
- **9 种 AI 工具卡**：润色改写 (REWRITE_FLUENT)、扩写补充 (EXPAND)、风格转换 (TRANSFORM_STYLE)、标题优化 (HEADLINE_SUB)、新拟标题 (HEADLINE_NEW)、开头改写 (REWRITE_OPENING)、补充事实 (ADD_FACTS)、话题补充 (ADD_TOPIC)、图片建议 (IMAGE_SUGGEST)，每种配默认款 + 风格款两条 Prompt
- **两层 Prompt 体系**：24 条平台内置 Prompt（9 默认 + 9 风格 + 6 审核/改写）+ 作者私人 Prompt 不限量复制编辑，3 快照版本管理 + "恢复默认"按钮
- **TipTap 富文本编辑器**：基于 ProseMirror 的专业级编辑器，1.5s 防抖自动保存 + 30s 云端持久化 + 离线 IndexedDB 兜底 + 版本历史快照 + 冲突检测与自动 fork + 多标签页打开检测
- **素材管理**：图片上传 + 合规两次校验（入库 + 插入前），4 维度审核（人脸/水印/敏感内容/AI 未标记）

**AI 内容安全与质量管控（守门员）**

- **5 阶段审核链路**：Prompt 输入审核 → 选题输入审核（Aho-Corasick 敏感词 Worker 1.5s）→ 流式段落审核（连续 ≥3 段高危自动中断 AI 生成）→ 发布前预检（Guard + LLM 双路并行 + 质量评分）→ 发布后举报复审 + 5% 抽样巡检 + 规则复审
- **Guard + LLM 双路混合审核**：阿里云 MultiModalGuard 负责标准文本结构化审核（~200ms），DeepSeek-V4-Flash LLM 兜底覆盖暗语/emoji/谐音梗/拼音变体（~1.5s），两层结果取并集——任一路命中即命中
- **6 维安全类目**：涉黄 / 涉赌 / 涉毒 / 辱骂攻击 / 欺诈 / 黑产广告，统一 severity（high/medium/low）+ recommendation（ALLOW/WARN/BLOCK）映射
- **4 维质量评分**：内容价值 / 表达质量 / 读者体验 / 传播潜力，各 0-100 分，与安全审核共享同一 LLM 调用节省 token
- **规则库**：6 个 YAML 规则文件 + 敏感词库 5 类目共 140 条，prompt_hint 动态注入 LLM
- **一键合规替代（SAFE_REWRITE）**：双温度 0.6/1.0 候选，自动替换违规段落
- **Prompt 实验室**：测试集 → 批量评估 → 版本对比 → 人工确认上线 → 可追溯（5 步标准化流程）

**内容分发与榜单（导航员）**

- **加权排序公式**：`score = α·质量分 + β·热度 + γ·时间衰减 + δ·外部趋势`，前端 WeightDrawer 可热调权重
- **双榜单**：热点榜（tau=12h，偏重实时热度）+ 爆文榜（tau=72h，偏重质量沉淀），各有独立权重配置
- **抖音热榜外部数据源**：实时抓取抖音公开热榜，支持"以此选题创作"一键跳转 FAST 模式
- **数据回流诊断**：4 种场景自动推荐工具（好文章被埋没 → 拟新标题 / 标题吸引但留不住 → 改写开头 / 话题冷 → 补充话题 / 缺互动钩子 → 补充话题）
- **举报闭环**：用户举报 → LLM 推荐处置 → Admin 人工裁决 → 下线/警告/驳回

### 产品亮点与创新点

1. **人机协同创作流**：FAST 模式下 AI 逐段流式生成，用户可在大纲阶段调整方向、在生成阶段实时审核+干预，全程"AI 提主张、人做决定"
2. **双路混合审核引擎**：Guard（确定性结构化审核）+ LLM（语义深度理解）并行执行、结果取严，兼顾速度与准确率，容错降级保证服务可用
3. **连续违规中断机制**：流式生成中自动检测段落安全，连续 ≥3 段高危即中断 AI 生成，防止违规内容批量产出
4. **可热调排序权重**：信息流/榜单的 α/β/γ/δ 权重前端实时可调，Cursor 分页编码包含权重快照防止权重不一致翻页
5. **离线优先编辑器**：IndexedDB 本地快照 + 云端自动保存双层保障，断网不丢数据，上线自动同步
6. **Dark DevTools 美学风格**：深色主题 + 等宽字体 JetBrains Mono + 侧边栏沉浸式布局，面向创作者的专业工具感

### 界面截图

（关键页面截图待补充：首页信息流 / 编辑器工作台 / FAST 模式对话框 / 审核面板 / 榜单页 / Prompt 实验室）

### 功能完成度清单

**核心功能：**

- [x] **用户中心**：手机号登录注册、JWT 认证、安全退出登录
- [x] **AI 内容创作**：Prompt 与素材管理、9 种 AI 工具卡一键调用、FAST/FINE 双轨创作、草稿 30s 自动云端保存与 IndexedDB 离线恢复
- [x] **内容 AI 审核**：5 阶段审核链路、4 维质量评分、Guard+LLM 双路混合审核、一键合规替代内容
- [x] **热点与爆文 / 推荐榜单**：加权排序信息流、双榜单 + 抖音热榜、无限滚动加载、可热调权重

**进阶挑战：**

- [x] **短图文创意编辑器**：TipTap 富文本编辑器，AI 流式生成结构完整图文内容
- [x] **高精度内容安全识别**：Guard+LLM 双路混合审核 Accuracy 92.26%，高危问题识别准确率 ≥ 90%
- [x] **智能排序的热点榜单**：综合质量分、阅读热度、发布时间、用户反馈、外部趋势等多因子动态加权
- [x] **开放 API 集成**：接入抖音公开热榜 API，支持"以此选题创作"一键分发

---

## 项目技术文档

### 系统架构设计

```
bytedance-aigc/
├── apps/
│   ├── web             # Next.js 16 + React 19 — 用户界面 + SSR + ISR
│   ├── api             # NestJS 11 — 业务编排 + AI 网关 + 审核 + 评分
│   ├── web-consumer    # 读者端（预留）
│   └── web-studio      # 工作台独立端（预留）
├── packages/
│   ├── shared          # TS 类型 / 常量 / 排序算法（双端共用）
│   └── ui              # shadcn/ui 组件库 + 业务组件 + hooks/lib
└── docker-compose.yml  # 本地 PostgreSQL 16 + Redis 7 + MinIO
```

**数据流**：用户在 Next.js 前端操作 → API 请求至 NestJS 后端 → 后端编排 AI 调用/审核/评分 → SSE 流式返回生成内容 → 前端实时渲染。

**关键设计决策**：

- **薄前端 / 厚后端**：AI 调用、Prompt 渲染、审核裁决、评分计算、榜单排序全部放在后端，前端只做"输入 + 渲染 + 流式接收"
- **流式优先**：AI 输出接口默认走 SSE，帧协议：`section.start` / `token` / `section.end` / `done` / `error`
- **Prompt 是数据不是代码**：Prompt 模板存 DB，版本可追溯，不进 git
- **审核是切面不是主线**：用 NestJS Guard/Interceptor/Pipe 切入各阶段，不污染业务 controller
- **AI 只提主张，人做决定**：服务端返回 candidate/suggestion，持久化由用户显式 Accept 触发

### 技术选型与理由

| 层       | 选型                             | 版本   | 理由                                              |
| -------- | -------------------------------- | ------ | ------------------------------------------------- |
| 前端框架 | Next.js                          | 16.2.6 | App Router SSR + Server Components + ISR 缓存     |
| UI 库    | React                            | 19.2.4 | 并发特性 + use() hook                             |
| 样式     | Tailwind CSS                     | v4     | 原子化样式，无设计系统依赖                        |
| 组件     | shadcn/ui + Radix UI             | -      | 无样式行为基元 + Tailwind 封装，A11y 开箱即用     |
| 富文本   | TipTap                           | 3.26.x | 基于 ProseMirror，JSON 存储格式，可结构化喂给审核 |
| 后端框架 | NestJS                           | 11     | 模块化架构，Guard/Interceptor/Pipe 切面           |
| ORM      | Prisma                           | 5      | 类型最强 ORM，schema 单一事实源                   |
| 数据库   | PostgreSQL                       | 16     | JSON 字段支持，全文检索基础                       |
| 缓存     | Redis                            | 7      | 榜单 sorted set / 会话缓存                        |
| LLM 适配 | OpenAI SDK                       | 6.41   | 兼容层设计，只需改 .env 三项即可切换厂商          |
| 内容审核 | 阿里云 MultiModalGuard           | 3.3.0  | 结构化审核 API，低延迟确定性输出                  |
| 对象存储 | S3 兼容 (MinIO)                  | -      | 本地开发 MinIO，生产可切任意 S3 兼容服务          |
| 测试     | Vitest + Playwright + Jest       | -      | 前端单测 + E2E + 后端单测/e2e                     |
| 工程化   | Husky + lint-staged + commitlint | -      | Git hooks 自动化质量保障                          |

### 核心模块设计

**1. 创作工作台（得力助手）**

- `DraftsService`：文稿 CRUD、双轨模式标记、自动保存
- `PromptsService`：平台内置 Prompt（只读）+ 作者私人 Prompt（复制后可编辑），3 快照版本管理
- `LlmClient`：厂商无感 LLM 适配层，chat() 同步 + chatStream() 流式，finish_reason 归一
- `AssetsService`：图片上传 + 合规两次校验（INGEST + PRE_INSERT）

**2. 审核管道（守门员）**

4 个审核方法全部改为 Guard + LLM 双路并行：

```ts
const [g, l] = await Promise.all([
  this.guard.moderate(text, service), // Guard 安全
  this.llmChatSafety(text, tool), // LLM 安全
]);
```

- `preflight`：发布前预检，Guard+LLM 双路安全 + LLM 质量，三路并发
- `reviewPrompt`：选题审核，双路并行，降级时返回 ALLOW 不阻塞
- `reviewSection`：流式段落审核，连续 ≥3 段 high 自动 abortStream
- `reviewPostPublish`：举报触发复审，双路失败 fallback ALLOW（等 admin 裁决）

**3. 排序引擎（导航员）**

排序公式（前后端复用，shared 包纯函数）：

```
score = alpha * QualityScore + beta * HotnessScore + gamma * TimeDecayScore + delta * ExternalTrendScore
```

- `TimeDecayScore = 100 * exp(-deltaHours / tau)`
- `HotnessScore = log(impression+1)*1 + click*2 + like*5 + collect*8 + share*10 - report*20`
- `ExternalTrendScore`：抖音热榜相关性匹配（滑动窗口分词 + 子串匹配）
- 归一化：pool < 50 用 P95 作 max 防 outlier

双榜单配置差异：

| 维度          | 热点榜 | 爆文榜 |
| ------------- | ------ | ------ |
| tau           | 12h    | 72h    |
| alpha（质量） | 0.2    | 0.5    |
| beta（热度）  | 0.5    | 0.4    |
| gamma（时间） | 0.3    | 0.1    |

### AI 能力接入

**LLM 适配层**：只需修改 `.env` 中的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 三项即可切换厂商，代码不绑定任何特定厂商。当前使用 DeepSeek-V4-Flash（通过 OpenAI 兼容网关），支持火山方舟 ARK / OpenAI / 自建中转等任意兼容端点。

**Prompt 工程体系**：

| Prompt Tool         | 用途                | few-shot 条数 |
| ------------------- | ------------------- | ------------- |
| SAFETY_REVIEW       | 发布前安全审核      | 0             |
| PROMPT_REVIEW       | 选题/提示词风险审核 | 6             |
| SECTION_REVIEW      | 生成中段落审核      | 3             |
| POST_PUBLISH_REVIEW | 发布后举报复审      | 6             |
| QUALITY_REVIEW      | 4 维质量评分        | -             |

Prompt 结构：角色设定 → 6 类目定义与判定边界（含暗语/emoji/拼音变体等效规则）→ 判定要点 → 严格 JSON 输出格式 → 字段约束。

**审核双路合并策略（mergeSafety）**：

- severity：取两者中更高的（high > medium > low），平局时 Guard 优先
- score：取 Math.max
- hits：从 winner 取全部，从 loser 补充去重
- reason：优先使用 winner 的 reason

### 数据库设计

**PostgreSQL 18 个核心模型**：

| 模型            | 说明            | 关键字段                                                                                               |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| User            | 用户            | handle, phone/email, role(AUTHOR/ADMIN)                                                                |
| Draft           | 文稿            | mode(FAST/FINE), status, title, body(JSON), publishedBody, publishedVersion                            |
| DraftVersion    | 版本快照        | kind(AUTO/NAMED/PUBLISHED/OFFLINE_CONFLICT), snapshot(JSON), wordCount                                 |
| Prompt          | Prompt 模板     | owner(PLATFORM/PRIVATE), tool, systemPrompt, params, fewShots, isStarter, sourcePromptId(自引用)       |
| PromptSnapshot  | Prompt 历史快照 | promptId, systemPrompt, params, fewShots                                                               |
| Review          | 审核记录        | stage(PREFLIGHT/PROMPT_INPUT/SECTION_INLINE/POST_PUBLISH), safety(JSON), quality(JSON), recommendation |
| PostStat        | 文章统计        | impression, click, dwellUnit, like, collect, share, report                                             |
| Report          | 用户举报        | category, status, resolution, llmRecommendation, llmReason                                             |
| Reaction        | 用户反应        | kind(LIKE/COLLECT), unique([userId, postId, kind])                                                     |
| Asset           | 资源文件        | key, url, mime, size, aiGenerated, reviewStatus                                                        |
| Notification    | 通知            | type(PUBLISH_APPROVED等), title, body, read                                                            |
| SampleAudit     | 精选审核        | status(PENDING/PASSED/FAILED)                                                                          |
| PromptTestCase  | 测试用例        | tool, input, expected, category                                                                        |
| PromptEvalRun   | 评估运行        | promptId, totalCases, accuracy, stability                                                              |
| PromptLabAction | 实验操作日志    | action, fromPromptId, toPromptId                                                                       |
| RuleRecheckRun  | 规则复检记录    | ruleVersion, totalScanned, totalOffline                                                                |
| AuthEvent       | 认证事件        | type(LOGIN/REGISTER/LOGOUT/SEND_CODE), ip, userAgent                                                   |

**Redis 用途**：热度榜 sorted set / SSE 长连接进度 / 审核接口限流 / Prompt 缓存

### 性能优化

| 指标           | 目标   | 实测值             | 状态   |
| -------------- | ------ | ------------------ | ------ |
| LCP（Desktop） | ≤2.5s  | 1.08s              | 达标   |
| LCP（Mobile）  | ≤2.5s  | 3.64s（待优化）    | 需改进 |
| FID            | ≤100ms | ~20ms              | 达标   |
| CLS            | ≤0.1   | 0                  | 达标   |
| 自动保存       | ≤30s   | 1s 本地 + 30s 云端 | 达标   |

已实施的优化手段：

1. 首图 `priority` 属性（前 3 张卡片预加载）
2. Suspense 流式渲染（骨架屏先流出，TTFB 不再阻塞于 API 响应）
3. ISR 30s（`revalidate = 30`，页面可被 CDN 缓存）
4. 骨架屏视觉对齐（与 FeedList 网格布局一致，减少 CLS）
5. Cursor 分页编码包含权重快照，防止权重不一致翻页

### 可用性与工程化

- **错误处理**：NestJS 全局 PrismaKnownRequestFilter 统一处理数据库异常；LLM 调用失败降级（审核双路任一路失败不影响另一路）；SSE 流式中 error 帧不断连
- **Git 质量保障**：Husky + lint-staged + commitlint，提交前自动 lint + 类型检查
- **测试覆盖**：后端 174+ 单测 + 175+ e2e 测试、前端 90+ 单测，全绿
- **环境校验**：Joi schema 校验所有环境变量，缺失时一次性报告全部错误
- **LLM 调用安全**：审核 prompt temperature=0.0 确保确定性，LLM 输出解析失败 fallback 全 low 不误拦

---

## 其他补充材料

### 审核规则与质量评估体系

**安全审核规则库**：

6 个 YAML 规则文件（pornography/gambling/drugs/abuse/fraud/illicit_ads），每条规则包含：`rule_id`、`category`、`severity`、`description`、`prompt_hint`、`examples_positive`、`examples_negative`。敏感词库 5 类目共 140 条（pornography 30 / gambling 24 / abuse 25 / fraud 26 / illicit_ads 35）。

**6 维安全类目判定边界**：

| 类目        | 中文名   | high 判定标准                                      |
| ----------- | -------- | -------------------------------------------------- |
| pornography | 涉黄     | 露骨色情描写、性交易信息、暗语/emoji 性服务推广    |
| gambling    | 涉赌     | 赌博平台推广、玩法教学、诱导下注、暗号推广         |
| drugs       | 涉毒     | 毒品交易/购买/渠道、吸毒体验/诱导、制作/藏匿方法   |
| abuse       | 辱骂攻击 | 人身攻击、种族/性别/地域歧视、严重侮辱性词汇       |
| fraud       | 欺诈     | 虚假兼职/刷单/代发、投资骗局、贷款诈骗、传销引流   |
| illicit_ads | 黑产广告 | 刷量/刷粉/刷评、代发/代写/代办、违禁商品、私域引流 |

**Severity 与 Recommendation 映射**：

| 条件                     | Recommendation | 处置                   |
| ------------------------ | -------------- | ---------------------- |
| 任一维度 severity=high   | BLOCK          | 拦截，不可发布         |
| 任一维度 severity=medium | WARN           | 警告，用户确认后可发布 |
| 全维度 severity=low      | ALLOW          | 放行                   |

Preflight 额外规则：全 low 但 quality.overall < 60 时也返回 WARN。

**4 维质量评分体系**：

| 维度              | 说明                                 | 权重 |
| ----------------- | ------------------------------------ | ---- |
| content_value     | 内容价值（信息密度/观点深度/原创性） | 等权 |
| expression        | 表达质量（逻辑/结构/可读性）         | 等权 |
| reader_experience | 读者体验（吸引力/完成度/互动性）     | 等权 |
| viral_potential   | 传播潜力（话题性/共鸣度/分享动机）   | 等权 |

overall = 4 维均值，作为分发排序的 QualityScore 输入。

**识别—干预—反馈闭环**：

1. **识别**：5 阶段审核管道自动识别违规内容（安全）+ 低质量内容（质量评分）
2. **干预**：高危 BLOCK 拦截 / 中危 WARN 警告 / 低质量推荐工具 / 流式生成中自动中断 / 一键合规替代 SAFE_REWRITE
3. **反馈**：审核结果写入 Review 记录 → 通知作者 → 数据回流诊断 → 自动推荐改写工具 → Prompt 实验室迭代优化审核 Prompt

### 效果评估与优化报告

**PE（Prompt Engineering）调教过程**：

| 版本                 | Accuracy | Macro-F1 | 核心变化                                                |
| -------------------- | -------- | -------- | ------------------------------------------------------- |
| v1（简版 Prompt）    | 0.5370   | 0.5059   | 基础角色设定 + 简单类目定义                             |
| v2（增强版 Prompt）  | 0.9333   | 0.9310   | 详细类目边界 + 暗语词表 + few-shot + 规则库 prompt_hint |
| v3（Guard+LLM 双路） | 0.9226   | 0.9261   | 引入阿里云 Guard 并行，mergeSafety 并集策略             |

v1 → v2 提升 40 个百分点，关键手段：(1) 详细类目定义与判定边界含暗语/emoji/拼音变体等效规则 (2) few-shot 示例 (3) 规则库补强：YAML 正负样本替换为真实样本 (4) 敏感词库扩充到 140 条 (5) reviewPostPublish 拼接 buildPromptHints。

**审核准确率评估（ChineseHarm-Bench 310 条样本，Guard+LLM 双路）**：

| 指标     | 值     | PRD 目标 | 状态 |
| -------- | ------ | -------- | ---- |
| Accuracy | 0.9226 | ≥ 0.9    | 达标 |
| Macro-F1 | 0.9261 | -        | 参考 |

类目级 P/R/F1：

| 类目        | Precision | Recall | F1    | 说明                                    |
| ----------- | --------- | ------ | ----- | --------------------------------------- |
| pornography | 0.941     | 0.800  | 0.865 | emoji 暗语/极短隐晦暗示漏判             |
| gambling    | 1.000     | 0.750  | 0.857 | emoji 变体/古汉语隐写漏判               |
| drugs       | 1.000     | 0.975  | 0.987 | Guard 独立标签 + LLM 关键词覆盖充分     |
| abuse       | 0.950     | 0.950  | 0.950 | 辱骂词汇表覆盖较全                      |
| fraud       | 0.975     | 0.975  | 0.975 | 刷单/兼职/骗局模式标准化                |
| illicit_ads | 0.974     | 0.950  | 0.962 | 黑产广告引流特征明显                    |
| allow       | 0.795     | 1.000  | 0.886 | 18 条 FP，主要为赌博/色情 FN 漏为 allow |

**双路混合方案与纯方案对比**：

| 方案                 | Accuracy   | Macro-F1   | 平均延迟 | 成本           |
| -------------------- | ---------- | ---------- | -------- | -------------- |
| 纯 LLM（v2）         | 0.9333     | 0.9310     | ~1.5s    | LLM token 费用 |
| 纯 Guard             | 0.4129     | -          | ~0.2s    | API 调用费用   |
| **Guard + LLM 双路** | **0.9226** | **0.9261** | ~1.6s    | 两者之和       |

双路方案 Accuracy 略低于纯 LLM（mergeSafety 并集策略偶尔引入 FP），但核心价值在于**兜底安全**：LLM 漏判时 Guard 可能拦住，Guard 漏判时 LLM 可能拦住，保证更少的漏放。

**性能指标达成**：

| 指标           | PRD 目标 | 实测值                       | 状态                        |
| -------------- | -------- | ---------------------------- | --------------------------- |
| 30s 自动保存   | ≤30s     | 1s 本地 + 30s 云端           | 达标                        |
| 安全审核准确率 | ≥90%     | 92.26%                       | 达标                        |
| 榜单首屏 LCP   | ≤2.5s    | Desktop 1.08s / Mobile 3.64s | Desktop 达标，Mobile 待优化 |

**未来优化方向**：

1. **Prompt 调优**：增加赌博/色情 emoji 变体 few-shot，明确 Unicode 装饰字符与正常文本的区分
2. **规则库补强**：针对失败样本中的高频错误模式补充 prompt_hint（如 emoji 数字混排、古汉语隐写）
3. **阈值校准**：pornography/gambling Recall 偏低，可考虑 medium severity 也触发 BLOCK
4. **Mobile LCP 优化**：字体改用 `display: optional`、首页 LCP 文本 server component 化、推迟 ThemeProvider hydration
5. **HotnessScore 真实数据**：当前为确定性 hash 占位，需接入 PostStat 表真实阅读/互动数据
6. **多模型对比**：当前仅 DeepSeek-V4-Flash，需横向扩展到火山方舟/其他模型
7. **端到端监控**：Sentry/DataDog 错误追踪 + LLM 调用延迟 P99

### 代码压缩包

- **完整项目代码**：见附件（或 Git 仓库）
- **目录结构**：

```
bytedance-aigc/
├── apps/
│   ├── api/                    # NestJS 后端
│   │   ├── src/                # 源码（modules: auth, drafts, prompts, llm, reviews, reports, feed, assets, analytics, notifications, admin, external-trending）
│   │   ├── prisma/             # 数据库 schema + seed + migrations
│   │   └── test/               # E2E 测试
│   └── web/                    # Next.js 前端
│       └── src/
│           ├── app/            # App Router 路由
│           │   ├── (creator)/  # 创作者工作台
│           │   ├── (admin)/    # 管理后台
│           │   └── (public)/   # 公开页面（登录/注册）
│           └── components/     # 组件
├── packages/
│   ├── shared/                 # 前后端共享类型/常量/纯函数
│   └── ui/                     # UI 组件库
├── docs/                       # 文档
└── docker-compose.yml          # 本地开发数据基建
```

- **启动说明**：
  1. `cp .env.example .env` 配置环境变量
  2. `pnpm install` 安装依赖
  3. `pnpm db:up` 启动 PostgreSQL + Redis + MinIO
  4. `pnpm prisma:migrate` 运行数据库迁移
  5. `pnpm prisma:seed` 填充种子数据
  6. `pnpm dev` 启动前后端开发服务器
  7. 访问 `http://localhost:3000`

- **测试说明**：
  - `pnpm test`：运行全部单元测试
  - `pnpm e2e`：运行 Playwright E2E 测试
  - `pnpm typecheck`：TypeScript 类型检查
  - `pnpm lint`：ESLint 代码质量检查

---

## 项目自评

### 已达成

项目在 3 周内完成了 PRD 全部章节的交付，三大硬指标（30s 自动保存 / 安全审核准确率 ≥90% / LCP ≤2.5s）在 Desktop 端全部达标。双路混合审核引擎、流式段落审核中断机制、可热调排序权重等特性体现了对产品场景的深度思考。

### 不足之处

1. **Mobile 端 LCP 未达标**：重构后 Mobile LCP 从 1.8s 退化到 3.64s，主要因 next/font 加载 + ThemeProvider 客户端水合 + 组件树加深，尚未优化
2. **赌博/色情类目 Recall 偏低**：emoji 变体暗语、古汉语隐写、极短隐晦暗示等场景仍难识别，影响审核覆盖率
3. **HotnessScore 占位**：当前用确定性 hash 模拟热度数据，未接入真实阅读/互动统计
4. **无公网部署**：项目仅本地开发模式运行，未部署到云平台提供线上访问
5. **测试覆盖**：E2E 测试覆盖主要链路，但 AI 工具卡、Prompt 实验室等模块的端到端测试仍不完整

### 未来长期建设思路

1. **审核引擎持续迭代**：引入更多 few-shot 覆盖新兴暗语变体，研究 Guard API 自定义标签扩展，探索 LLM 第三方仲裁解决跨类目误判
2. **真实数据驱动排序**：接入 PostStat 表真实阅读/互动数据替换 hash 占位，实现 HotnessScore 和 TimeDecayScore 的真实计算
3. **多模型 A/B 测试**：引入 Prompt 实验室多模型对比能力，支持 DeepSeek/Qwen/GLM 等多模型横向评测
4. **自动 PE 循环**：从手动触发 eval + 人工确认上线，演进为 DSPy 风格自动优化 Prompt 流程
5. **公网部署与监控**：Vercel + Railway 或阿里云函数 + RDS 部署，接入 Sentry 错误追踪 + DataDog 性能监控
6. **Mobile 性能专项优化**：字体 display: optional、LCP 文本 server component 化、ThemeProvider hydration 延迟
7. **图片视觉审核 API**：从文本启发式推断演进到真实图像审核，覆盖素材合规的视觉维度
