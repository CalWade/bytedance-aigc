# Phase 2.2 设计 — FAST 模式生成 + 9 AI 工具卡 + Prompt 自定义

> 状态:草稿 v2(2026-06-02 修订),已吸收 verification 子代理 gap review(2 必修 + 6 CONCERN)。等用户 review。下一步交给 superpowers:writing-plans 出实施计划。

## 1. 目标

让 `/drafts/[id]` 编辑器具备 PRD §3.1.1 / §3.1.2 / §3.5.2 的核心生产力:

1. **FAST 模式全链路** — 选题 → 大纲(3-8 段,非流式)→ 用户编辑大纲 → 分段流式生成正文(SSE)。
2. **9 个 AI 工具卡** — 选中文本后,BubbleMenu 弹出 3 组工具按钮,调用统一端点同步返回候选;用户三态决策 Accept / Reject / Modify。
3. **Prompt 自定义(§3.5.2)** — 平台层只读,用户可"复制到我的"得到一份私人副本;私人 Prompt 可改可删;"当前生效"由前端 localStorage 记录,后端只做 CRUD。

不在本 milestone 范围(拆到后续):

- FINE 模式(Phase 2.3)
- 5 阶段审核链路(Phase 2.4)
- 4 维质量评分(Phase 2.5)
- DraftVersion 快照(与版本历史一起做)

## 2. 锁定决策表

| 岔路             | 选择                                                                                                                            | 理由                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 范围             | **一锅出**(一个 spec 一个 plan)                                                                                                 | FAST 主链路、9 工具、Prompt 写 API 共用 LLM 客户端 + 鉴权 + 编辑器宿主,拆开会反复改同一批文件。                                                                                  |
| LLM 客户端       | **OpenAI SDK + 自定义 baseURL(任意 OpenAI 兼容端点)**                                                                           | OpenAI SDK 是事实标准;通过 `LLM_BASE_URL` 注入(可填 OpenAI 官方 / 火山方舟 ARK / DeepSeek / 自建网关),代码不绑定厂商,符合 PRD §6.4 "OpenAI SDK 兼容"精神同时给评委一键切换能力。 |
| 流式协议         | **SSE(NestJS `@Sse()` + rxjs Observable)**                                                                                      | HTTP/1.1 单向流、原生支持断线重连、跟 OpenAI Stream 协议一一对应;WebSocket 在本场景属过度工程。                                                                                  |
| SSE 鉴权         | **fetch + ReadableStream + `Authorization: Bearer <jwt>` 手解 SSE 帧**                                                          | 浏览器原生 EventSource 不支持自定义请求头,无法带 JWT;fetch 流式读取 + 手动按 `\n\n` 分帧最干净。                                                                                 |
| FAST 节奏        | **POST /drafts/:id/outline(非流 JSON)→ 用户编辑 → GET /drafts/:id/sections/stream(SSE 分段)**                                   | 严遵 PRD §3.1.1;大纲短、要稳;分段长、要流。                                                                                                                                      |
| 9 工具端点       | **统一 `POST /drafts/:id/tools/invoke { tool: DraftToolType, input, promptId? }`,`input` 为 discriminated union(按 tool 分支)** | 9 工具的输出 shape 同构;**输入差异**用 union 收敛(REWRITE 系工具吃选区,HEADLINE/ADD_TOPIC/ADD_FACTS/IMAGE_SUGGEST 吃全文)。新增工具只需扩 enum + union 分支 + 后端 case。        |
| 工具返回模式     | **同步 POST 返回完整候选**(只有 FAST 全文生成走 SSE)                                                                            | 工具卡平均 < 200 字,等 1-2s 比断流后拼字符串体验更稳;前端实现简单,无需为每个工具加 SSE 状态机。                                                                                  |
| Prompt 自定义    | **后端 CRUD + 前端 localStorage 记"当前生效"**                                                                                  | 保持 schema 不动(已经有 `sourcePromptId` 自指链);"当前生效"是 UI 状态,没有跨设备同步价值。                                                                                       |
| 默认 Prompt 选取 | **`where { owner: PLATFORM, tool, isStarter: true }` 唯一命中,缺失则回退到该 tool 下 PLATFORM 首条**                            | schema 已有 `isStarter` 字段(prisma `@@index([owner, tool])` 已建);`isStarter` 作主键避免靠 `createdAt` 兜底的偶然性。                                                           |
| UI 入口          | **TipTap BubbleMenu,3 组分组:改写类 / 标题类 / 补充类**                                                                         | 选区即工具,符合 PRD §3.1.2 "选中即可调用";3 组减少视觉噪音;BubbleMenu 是 TipTap 一等公民扩展。                                                                                   |
| 流式 × autosave  | **流前 flush autosave → 流期间冻结 autosave → 流结束触发一次 PATCH**                                                            | Phase 2.1 `useAutosave` 监听 `onUpdate`,程序化 `insertContentAt` 仍触发 dirty;若不冻结,30s 倒计时会在流中段命中,与流末 PATCH 抢版本。                                            |

## 3. 端到端流

### 3.1 FAST 主链路

```
用户在 /drafts/[id] 点「FAST 模式」按钮
  → 弹出选题输入框(topic + 可选风格 hint)
  → POST /drafts/:id/outline { topic, hint? }     [非流式]
      ← 200 { sections: [{ heading, summary, hint? }] }   3-8 项
  → 大纲面板渲染为可拖拽/编辑/增删的列表
  → 用户调整完大纲,点「开始生成正文」
  → [前端] flushAutosave() — 把当前编辑器脏内容 PATCH 落库一次,确保流前基线干净
  → [前端] pauseAutosave() — 进入 streaming 状态,onUpdate 期间跳过 dirty 标记
  // 上述两步对应 §5.3 useAutosave 暴露的真实 API:flush() + setStreaming(true)
  → GET /drafts/:id/sections/stream?cursor=0     [SSE]
      ← event: section.start  data: { index: 0, heading: "..." }
      ← event: token          data: { index: 0, delta: "字" }
      ← event: section.end    data: { index: 0 }
      ← event: section.start  data: { index: 1, ... }
      ← ... 直到 done
      ← event: done           data: {}
  → 前端实时把 token 拼到 TipTap 文档对应段落
  → 流结束后 resumeAutosave() + 触发一次 PATCH /drafts/:id 落库(沿用 Phase 2.1 自动保存通道)
```

错误路径:

- LLM 调用失败 / Prisma 查询出错 → service 内部 catch → SSE `event: error data: { code, message }` → 前端 toast + 保留已生成的部分。**重要:不要让异常透出到 NestJS 全局 `PrismaKnownRequestFilter`**(它会把流变成 500 JSON,客户端 SSE 解析器立即断流)。
- 用户中途点「停止」→ 前端 `AbortController.abort()` → 后端 rxjs subscription 关闭 → 同样 resumeAutosave。

### 3.2 工具调用

```
用户在编辑器选中一段文本
  → BubbleMenu 弹出,分 3 组:
       改写类: REWRITE_FLUENT / EXPAND / TRANSFORM_STYLE / REWRITE_OPENING
       标题类: HEADLINE_SUB / HEADLINE_NEW
       补充类: ADD_FACTS / ADD_TOPIC / IMAGE_SUGGEST
  → 用户点某个工具
  → POST /drafts/:id/tools/invoke
       body: { tool: "REWRITE_FLUENT", input: { selectedText: "<选中的>" }, promptId?: "<localStorage 里当前生效>" }
     ← 200 { candidates: [{ text }] }   通常 1 个,部分工具如 HEADLINE_NEW 可返回 N 个
  → 选区下方浮出候选卡,3 个按钮:
       「采用」  替换原选区文字(TipTap chain().insertContentAt)
       「修改」  把候选填进编辑框,用户改完再「采用」
       「关闭」  丢弃
```

授权:`POST /drafts/:id/tools/invoke` 走 UserGuard(类级已挂),service 层校验 `draft.authorId === user.sub`,沿用 `apps/api/src/drafts/drafts.service.ts:49-51` 的 `if (draft.authorId !== authorId) throw new ForbiddenException` 模式;本期把这三行抽出为 `assertAuthor(id, userSub): Promise<Draft>` 供新 service 复用。

### 3.3 Prompt 自定义

```
打开「Prompt 设置」抽屉(编辑器右上角入口)
  → GET /prompts                        列出 PLATFORM 全部
  → GET /prompts?owner=PRIVATE         (新参数)列出我的
  → 在某条 PLATFORM 上点「复制到我的」
  → POST /prompts/:platformId/copy     ← 200 创建 PRIVATE 副本,sourcePromptId 指向原 PLATFORM
  → 抽屉切到「我的」分组,新副本可见
  → 编辑文本 → PATCH /prompts/:id { systemPrompt?, params?, fewShots?, designNote? }
  → 删除 → DELETE /prompts/:id
  → 任意一条上点「设为当前生效」→ 仅写 localStorage:
       key:   `bytedance-aigc:active-prompt:<tool>`
       value: <promptId>
  → 之后 BubbleMenu 调工具时把这个 promptId 带进 invoke 请求
```

权限:

- `POST /prompts/:platformId/copy` — UserGuard;source 必须 `owner: PLATFORM`,否则 400。
- `PATCH /prompts/:id` / `DELETE /prompts/:id` — UserGuard;必须 `owner: PRIVATE` && `authorId === user.sub`,否则 403/404;PLATFORM 一律 403(坚守 §3.5.2 "平台只读")。

## 4. 后端改动

### 4.1 环境变量

新增到 `.env.example` 与 `.env`(命名通用,不绑定厂商):

```
LLM_BASE_URL=https://api.openai.com/v1            # 任何 OpenAI 兼容端点
LLM_API_KEY=<填到本地>
LLM_MODEL=<模型/endpoint 标识>                    # 如 gpt-4o-mini / ep-20260101-xxxxx / deepseek-chat
```

参考填法(README 示例):

- OpenAI 官方:`LLM_BASE_URL=https://api.openai.com/v1`,`LLM_MODEL=gpt-4o-mini`
- 火山方舟 ARK:`LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`,`LLM_MODEL=ep-20260101-xxxxx`
- DeepSeek:`LLM_BASE_URL=https://api.deepseek.com/v1`,`LLM_MODEL=deepseek-chat`
- 自建/中转网关:任意暴露 OpenAI `/chat/completions` 协议的 URL

ConfigModule 已在 `apps/api/src/app.module.ts:17` 通过 `ConfigModule.forRoot({ isGlobal: true })` 全局注册(Phase 1.4 由 AuthModule 引入并提升到 isGlobal,**非 Phase 1.1**)。**`apps/api/src/config/` 目录目前不存在**,本期新建该目录 + 新增 `llm.config.ts`,内部用 `class-validator` 校验三项非空,启动时缺失直接拒绝,沿用 Phase 1.4 `JWT_SECRET` 用 `ConfigService.getOrThrow` 的硬约束风格。

### 4.2 新增模块 `apps/api/src/llm/`

- `llm.client.ts` — 单例,构造 `new OpenAI({ apiKey: LLM_API_KEY, baseURL: LLM_BASE_URL })`(`openai` SDK)。两个方法:
  - `chat(messages, opts?): Promise<string>` 同步返回(工具走它)
  - `chatStream(messages, opts?): Observable<{ delta: string } | { done: true } | { error: string }>` 流式(FAST 走它)
  - **不依赖任何厂商专属字段**;若某些 OpenAI 兼容厂商不支持 stream 的某种 finish_reason,在 client 内部归一化为 `{ done: true }`。
- `llm.module.ts` — `@Global()` 导出 `LlmClient`。
- 单测:mock OpenAI SDK,覆盖正常返回 + 限流错误 + 流式中断 + baseURL 自定义注入。

### 4.3 新增端点(drafts 模块)

| 路由                              | Guard               | 入参                                               | 出参                          |
| --------------------------------- | ------------------- | -------------------------------------------------- | ----------------------------- |
| `POST /drafts/:id/outline`        | 类级 UserGuard 已挂 | `{ topic: string, hint?: string }`                 | `{ sections: OutlineItem[] }` |
| `GET /drafts/:id/sections/stream` | 类级 UserGuard 已挂 | query: `cursor?: number`                           | SSE 帧(见 §3.1)               |
| `POST /drafts/:id/tools/invoke`   | 类级 UserGuard 已挂 | `{ tool, input, promptId? }`(`input` 见下方 union) | `{ candidates: Candidate[] }` |

`OutlineItem`:`{ heading: string; summary: string; hint?: string }`。

`Candidate`:`{ text: string }`,IMAGE_SUGGEST 工具额外带 `{ alt: string; reason: string }[]`,由 DTO 类型 union 收敛。

`ToolInvokeInput` discriminated union(按 tool 分支,plan 阶段把它落到 shared 包):

```ts
type ToolInvokeInput =
  | {
      tool: "REWRITE_FLUENT" | "EXPAND" | "TRANSFORM_STYLE" | "REWRITE_OPENING";
      input: { selectedText: string };
    }
  | { tool: "HEADLINE_SUB"; input: { selectedText: string } } // 给段落起小标题,吃选区
  | { tool: "HEADLINE_NEW"; input: { fullText: string } } // 给整篇起新标题,吃全文
  | { tool: "ADD_TOPIC"; input: { fullText: string } } // 推荐话题词,吃全文
  | { tool: "ADD_FACTS"; input: { selectedText: string; fullText: string } } // 选区作锚,全文作上下文
  | { tool: "IMAGE_SUGGEST"; input: { fullText: string } }; // 配图建议,吃全文
```

DTO 用 `class-validator` + `class-transformer` 的 `@Type` + 鉴别器或在 service 入口手动 narrow,plan 阶段二选一拍板。

### 4.4 新增端点(prompts 模块)

> **现状提醒**:`apps/api/src/prompts/prompts.controller.ts` **整个 controller 已标 `@Public()`**(prompts.controller.ts:8),Phase 1.4 把"列出 PLATFORM Prompt 库 / 单查"作为匿名可读端点。本期新增的 4 个端点都需要鉴权,**不能继承类级 `@Public()`**。

**鉴权方案**(避免 `@Public` × `@UseGuards` 元数据优先级争论):

新建 `PromptsPrivateController`(同一路由前缀 `prompts`,Nest 允许多 controller 共享前缀)+ 类级 `@UseGuards(UserGuard)` + **不挂 `@Public()`**,把 4 个新端点全挂这上面。原 `PromptsController` 保持 `@Public()` 不动,Phase 1.4 现有的 5 个 e2e 用例向后兼容零影响。

| 路由                             | Controller               | Guard          | 校验                                                    | 出参       |
| -------------------------------- | ------------------------ | -------------- | ------------------------------------------------------- | ---------- |
| `GET /prompts?owner=PRIVATE`     | PromptsPrivateController | 类级 UserGuard | 仅返回 `authorId === user.sub` 的 PRIVATE               | `Prompt[]` |
| `POST /prompts/:platformId/copy` | PromptsPrivateController | 类级 UserGuard | source 必须 PLATFORM;新建 PRIVATE,`sourcePromptId` 自指 | `Prompt`   |
| `PATCH /prompts/:id`             | PromptsPrivateController | 类级 UserGuard | 必须 PRIVATE && `authorId === user.sub`                 | `Prompt`   |
| `DELETE /prompts/:id`            | PromptsPrivateController | 类级 UserGuard | 必须 PRIVATE && `authorId === user.sub`                 | `204`      |

> **关键**:`GET /prompts?owner=PRIVATE` 与 `GET /prompts`(原 PromptsController 上的公开列表,默认 `owner=PLATFORM`)是**两个不同的 controller 方法**,共用 URL 但 NestJS 路由匹配按 query 走不到这一层——按需要把私有 GET 路径改为 `GET /prompts/private` 或用 `@Get()` + Nest 的"先注册先匹配"靠路由表顺序兜底。**plan 阶段拍板**:倾向 `GET /prompts/private` 显式拆开,避免 query 路由分支引发的"两个 GET / 同 URL"歧义。

GET 默认 `owner=PLATFORM` 不变(向后兼容 Phase 1.4),走原 PromptsController。

### 4.5 文件改动

新增:

- `apps/api/src/config/llm.config.ts` — **新建 `config/` 目录** + 校验 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三项非空
- `apps/api/src/llm/llm.client.ts`
- `apps/api/src/llm/llm.module.ts`
- `apps/api/src/llm/dto/chat-message.dto.ts`
- `apps/api/src/drafts/dto/outline-request.dto.ts`
- `apps/api/src/drafts/dto/tool-invoke.dto.ts`(承载 §4.3 的 ToolInvokeInput discriminated union)
- 新方法挂在现有 `apps/api/src/drafts/drafts.controller.ts`(类级已挂 `@UseGuards(UserGuard)`,**新方法不再重复挂方法级 Guard**)
- `apps/api/src/drafts/outline.service.ts` — 选题 → 大纲的 Prompt 模板 + 调用 LlmClient.chat
- `apps/api/src/drafts/sections.service.ts` — 大纲 → 分段流式生成
- `apps/api/src/drafts/tools.service.ts` — 9 工具 case 分发 + 调用 LlmClient.chat
- `apps/api/src/prompts/prompts-private.controller.ts` — **新建**,类级 `@UseGuards(UserGuard)`,挂 `GET /prompts/private`(等价 v1 设想的 `?owner=PRIVATE`)+ POST copy + PATCH + DELETE 共 4 个路由
- `apps/api/src/prompts/dto/copy-prompt.dto.ts`
- `apps/api/src/prompts/dto/update-prompt.dto.ts`
- `apps/api/test/fast-mode.e2e-spec.ts` — outline / sections SSE / tools invoke
- `apps/api/test/prompts-write.e2e-spec.ts` — copy / patch / delete + 越权 403

修改:

- `apps/api/src/drafts/drafts.controller.ts` — 挂三个新路由(类级 UserGuard 复用)
- `apps/api/src/drafts/drafts.service.ts` — 把 49-51 行的作者校验抽出为 `assertAuthor(id, userSub): Promise<Draft>`,供新 service 复用
- `apps/api/src/drafts/drafts.module.ts` — 注册新 service + 引入 LlmModule
- `apps/api/src/prompts/prompts.controller.ts` — **保持 `@Public()` 不动**(向后兼容 Phase 1.4),不在本 controller 上加任何写路由;新写路由全部落到 `PromptsPrivateController`
- `apps/api/src/prompts/prompts.module.ts` — 注册新 `PromptsPrivateController`
- `apps/api/src/prompts/prompts.service.ts` — copy / update / delete + 越权检查 + **默认 Prompt 选取改为 `where { owner: PLATFORM, tool, isStarter: true }`** + 兜底回退首条
- `apps/api/src/app.module.ts` — 注册 LlmModule
- `apps/api/.env.example`、根 `.env.example` — 加 `LLM_*` 三项 + 多厂商示例注释
- `package.json` 依赖:`openai`(OpenAI SDK)
- `README.md` — "本地开发 → LLM 接入"小节,列三种典型 baseURL 填法

### 4.6 SSE 实现要点

```ts
@Sse(":id/sections/stream")
streamSections(
  @Param("id") id: string,
  @CurrentUser() user: JwtPayload,
  @Query("cursor", new DefaultValuePipe(0), ParseIntPipe) cursor: number,
): Observable<MessageEvent> {
  return this.sections.stream(id, user.sub, cursor);
}
```

> **注意:DraftsController 类级已挂 `@UseGuards(UserGuard)`(drafts.controller.ts:22),此方法不再重复挂方法级 Guard**——这是 v1 草稿的内部矛盾,本版修正。

`sections.service.ts` 返回 `Observable<MessageEvent>`,每帧 `{ data: payload, type: "section.start" | "token" | "section.end" | "done" | "error" }`。Nest 的 `@Sse()` 自动按 `event: <type>\ndata: <json>\n\n` 编码(text/event-stream),与前端 fetch+ReadableStream 按 `\n\n` 分帧 + `event:`/`data:` 解析约定一致。

错误路径:**service 内部必须 try/catch 所有可能抛错的代码**(包括 prisma 查询、LLM 调用、JSON parse),把异常转成 `error` MessageEvent 通过 Observable 推出,不要让异常 bubble 到 `@Sse()` 装饰器外——否则会被全局 `PrismaKnownRequestFilter`(app.module.ts:29)或 NestJS 默认 ExceptionFilter 拦截转 500 JSON,客户端 SSE 解析器立即断流且无法读到错误体。

> **未现场验证**:NestJS `@Sse()` 与全局 `APP_FILTER` 的精确交互(Observable 内部 `throwError` 是否被 Filter 接管)。本设计稿通过"service 内吃掉所有异常"的方式从源头规避;plan 阶段实现时若 e2e 测试发现仍被 Filter 拦,补一层方法级 `@UseFilters()` 旁路。

## 5. 前端架构(apps/web)

### 5.1 新增组件

> **全部组件统一标 `"use client"`**:用到 hooks / fetch streaming / AbortController / TipTap editor instance / localStorage,Next.js 16 App Router 默认 RSC,不标会编译报错。

- `apps/web/src/app/drafts/[id]/_components/FastModeDialog.tsx` `"use client"` — 选题输入弹窗
- `apps/web/src/app/drafts/[id]/_components/OutlinePanel.tsx` `"use client"` — 大纲编辑面板(拖拽 / 增删 / 改文字)
- `apps/web/src/app/drafts/[id]/_components/SectionStream.tsx` `"use client"` — 监听 SSE,把 token 拼到 TipTap 文档
- `apps/web/src/app/drafts/[id]/_components/AiBubbleMenu.tsx` `"use client"` — TipTap BubbleMenu 扩展,3 组工具按钮
- `apps/web/src/app/drafts/[id]/_components/ToolCandidateCard.tsx` `"use client"` — Accept / Modify / Reject 三态卡
- `apps/web/src/app/drafts/[id]/_components/PromptDrawer.tsx` `"use client"` — Prompt 列表 / 复制 / 编辑 / 删除 / 设为当前生效
- `apps/web/src/lib/sse.ts` — `streamFetch(url, { headers, signal })` 工具:fetch + ReadableStream + 按 `\n\n` 分帧 + `event:`/`data:` 解析(纯函数,无 "use client" 也行,但被 client 组件 import)

### 5.2 新增 hooks

- `apps/web/src/hooks/useStreamingGeneration.ts` `"use client"`
  - 输入:`draftId`, `cursor`, `onToken`, `onSectionStart`, `onSectionEnd`, `onDone`, `onError`
  - 内部:调用 `streamFetch` + `AbortController`;返回 `{ start, stop, status }`
- `apps/web/src/hooks/useActivePromptId.ts` `"use client"`
  - 读写 localStorage `bytedance-aigc:active-prompt:<tool>`;SSR 安全(typeof window 守卫)

### 5.3 修改文件

- `apps/web/src/app/drafts/[id]/page.tsx` — **保持 server component**(只做布局 + 取 draft id 透传),把 FAST 入口按钮 / Prompt 入口 / BubbleMenu 这些交互层全部下沉到 `_components/` 里的 client 子组件。Phase 2.1 已有的 `DraftEditor` 容器若是 client,继续作为子树根。
- `apps/web/src/lib/auth.ts` — 已有 `apiFetch`;为 SSE 复用其 baseUrl + token 读取,但走 fetch 流式分支
- `apps/web/src/hooks/useAutosave.ts`(Phase 2.1 产物) — **新增 pause / resume API**:暴露 `setStreaming(boolean)`,streaming=true 时 onUpdate 回调跳过 dirty 标记;streaming 切 false 时不自动触发 PATCH(由调用方在流末显式 `flush()`)。

### 5.4 BubbleMenu 分组

```ts
const TOOL_GROUPS = [
  {
    label: "改写",
    tools: ["REWRITE_FLUENT", "EXPAND", "TRANSFORM_STYLE", "REWRITE_OPENING"],
  },
  {
    label: "标题",
    tools: ["HEADLINE_SUB", "HEADLINE_NEW"],
  },
  {
    label: "补充",
    tools: ["ADD_FACTS", "ADD_TOPIC", "IMAGE_SUGGEST"],
  },
] as const;
```

`DraftToolType` 直接从 `@bytedance-aigc/shared` 或后端 enum 镜像(保持单一事实源,倾向放 shared 包)。

## 6. 数据流细节

### 6.1 FAST 流式拼接

- 后端按 outline.sections 顺序,对每段生成时发 `section.start` → 多个 `token` → `section.end`。
- 前端在 TipTap 文档里为每个 section 预创建一个 heading + 空 paragraph(heading 用 outline.heading 文本)。
- token 来到时通过 TipTap `chain().insertContentAt(pos, delta).run()` 追加到对应段落末尾。
- **流前**:`useAutosave` flush(立即把任何 dirty 内容 PATCH 落库,获得稳定 base);随后 `setStreaming(true)` 进入冻结。
- **流期间**:`editor.options.editable = false` 阻止用户键盘输入(程序化 `insertContentAt` 不受影响);`onUpdate` 仍会被 token 注入触发,但 `useAutosave` 因 streaming=true 跳过 dirty 标记,不启动 30s 倒计时。
- **流末**:`done` 事件触发 `setStreaming(false)` + 显式 `flush()`,落一次 PATCH;`editable = true` 恢复编辑。
- **中断**(用户停止 / 错误):同样 `setStreaming(false)` + `flush()` 保存已生成的部分。

### 6.2 工具候选三态

- Accept:`editor.chain().focus().deleteSelection().insertContent(candidate.text).run()`
- Reject:仅关闭浮卡,编辑器状态不变。
- Modify:候选文字进 textarea,用户改完点「采用」走 Accept 路径。

### 6.3 Prompt "当前生效"

- 没 promptId 时后端用工具默认 PLATFORM Prompt:`prismaService.prompt.findFirst({ where: { owner: "PLATFORM", tool, isStarter: true } })`,缺失则 `findFirst({ where: { owner: "PLATFORM", tool }, orderBy: { createdAt: "asc" } })` 兜底。
- 有 promptId 时后端校验:必须 PLATFORM 或 (PRIVATE && authorId === user.sub),否则 403。

## 7. 文件清单(变更面)

新增 ~19 文件(含 `config/llm.config.ts`),修改 ~9 文件(多了 `useAutosave.ts` 的 pause/resume 改造)。详见 §4.5 + §5.3。**无需 schema 迁移**:Draft / Prompt / DraftVersion 全部字段(包括 `Prompt.tool`、`Prompt.isStarter`、`Prompt.sourcePromptId`、`Prompt.owner` enum、`@@index([owner, tool])`)在 Phase 1.x 已落地。

## 8. 验收

### 8.1 单测(vitest)

- `llm.client.spec.ts` — chat / chatStream / 错误传播 / baseURL 自定义注入(mock OpenAI SDK,验证 `new OpenAI({ baseURL })` 透传)
- `outline.service.spec.ts` — Prompt 模板插值 + 解析 LLM 输出为 OutlineItem[] + 异常输入回退
- `tools.service.spec.ts` — 9 个 case 至少各 1 个 happy path + 输入 union narrow
- `prompts.service.spec.ts` — copy / update / delete + 越权抛 403/404 + `isStarter` 默认款选取(命中 + 兜底两条)

### 8.2 e2e(Jest,依赖真实 PG)

`apps/api/test/fast-mode.e2e-spec.ts`:

1. POST /drafts/:id/outline 200 + sections 长度 3-8(mock LlmClient)
2. GET /drafts/:id/sections/stream — 收齐 section.start _ N + token _ M + done
3. POST /drafts/:id/tools/invoke `tool=REWRITE_FLUENT, input.selectedText` → 200 + candidates.length >= 1
4. POST /drafts/:id/tools/invoke `tool=HEADLINE_NEW, input.fullText` → 200 + candidates.length >= 1
5. POST /drafts/:id/outline 用别人的 draftId → 403
6. POST /drafts/:id/tools/invoke 不存在的 draftId → 404
7. POST /drafts/:id/tools/invoke `promptId=<别人的 PRIVATE>` → 403
8. GET /drafts/:id/sections/stream 中间 service 主动抛 prisma 错 → SSE 帧有 `event: error` 而非 HTTP 500(防全局 Filter 截胡的回归测试)

`apps/api/test/prompts-write.e2e-spec.ts`:

1. POST /prompts/:platformId/copy 200 + 返回 PRIVATE + sourcePromptId === platformId
2. PATCH /prompts/:id(自己的 PRIVATE)200
3. PATCH /prompts/:id(PLATFORM)403
4. PATCH /prompts/:id(别人的 PRIVATE)403
5. DELETE /prompts/:id(自己的 PRIVATE)204
6. DELETE /prompts/:id(PLATFORM)403
7. GET /prompts?owner=PRIVATE 只返回自己的
8. tools/invoke 不传 promptId → 后端解析到 `isStarter: true` 默认款(可通过 service spy 或返回头观测)

### 8.3 静态五连

`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check` 全绿。

### 8.4 手测脚本(用户跑)

1. 把 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 填到 `.env`(任选一家 OpenAI 兼容厂商)
2. 登录 → 新建草稿 → 点「FAST 模式」→ 输入选题「秋天的咖啡馆」→ 看到 5 段大纲
3. 改一下大纲第 2 段的 heading → 点「开始生成正文」→ 看到逐段流式出字 + 流期间无中段 PATCH(devtools Network 面板观察)
4. 选中一段 → BubbleMenu 弹出 → 点「改写 → 通顺改写」→ 候选浮卡出现 → 点「采用」→ 选区被替换
5. 打开 Prompt 抽屉 → 复制一条 PLATFORM → 改 systemPrompt → 设为当前生效 → 再点工具,请求带上 promptId
6. 刷新页面 → 内容仍在 + version 递增
7. 切换 `LLM_BASE_URL` 到另一家厂商 + 改 model → 重启 api → 重跑流程仍通(验证不绑定厂商)

## 9. 风险与回滚

| 风险                                                  | 缓解                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| LLM 端速率限制 / 鉴权失败                             | service 层 try/catch,转 SSE `error` 事件 + REST 500 标准化错误体                                               |
| SSE 异常被全局 PrismaKnownRequestFilter 转 500 中断流 | service 内部全 catch,只通过 Observable 推 `error` MessageEvent(§4.6 已写);e2e #8 覆盖回归                      |
| SSE 在 dev 模式下被 Next.js / Nginx 缓冲              | 后端 response header 显式设 `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`                  |
| 流式中前端崩溃留下半截文档                            | `done` 事件触发 PATCH 保存;中途不写库,崩溃即视为放弃                                                           |
| 流式 × autosave 抢版本                                | §6.1 三段控制:流前 flush + 流期间 streaming=true 跳 dirty + 流末 flush(§5.3 useAutosave pause/resume API 改造) |
| BubbleMenu 选区与流式光标冲突                         | 流式期间 `editor.options.editable = false`(只阻用户输入,不阻程序化注入)                                        |
| OpenAI SDK 与不同 OpenAI 兼容厂商行为差异             | client 层做一层薄 adapter:归一 finish_reason / 流帧格式 / 错误码;碰到不兼容时局部 if/else 不渗到上层           |

回滚:

- 单 commit 落本期,回滚直接 `git revert`。
- 没有 schema 迁移,DB 状态零影响。
- 已写库的 PRIVATE Prompt 副本会保留(不破坏一致性,符合"删除靠用户"的语义)。

## 10. 提交计划

预计 1 个 commit:

```
feat(content): FAST 模式生成 + 9 AI 工具卡 + Prompt 自定义(Phase 2.2)

后端
- llm: LlmClient(OpenAI SDK + 自定义 baseURL,支持任意 OpenAI 兼容厂商) + LlmModule(@Global)
- config: 新建 apps/api/src/config/ 目录 + llm.config.ts(LLM_BASE_URL/API_KEY/MODEL 三项校验)
- drafts: POST /:id/outline, GET /:id/sections/stream(SSE), POST /:id/tools/invoke(input discriminated union)
- drafts.service: assertAuthor 抽取(原 49-51 行)
- prompts: **新建 PromptsPrivateController**(类级 UserGuard);GET /prompts/private、POST /:id/copy、PATCH /:id、DELETE /:id;原 PromptsController 保持 @Public 不动;默认款用 isStarter 选取
- e2e: fast-mode 8 用例 + prompts-write 8 用例

前端
- FastModeDialog/OutlinePanel/SectionStream + useStreamingGeneration(fetch+ReadableStream+JWT)
- AiBubbleMenu(3 组工具) + ToolCandidateCard(Accept/Modify/Reject)
- PromptDrawer + useActivePromptId(localStorage 当前生效)
- useAutosave 加 pause/resume,与流式协调

环境
- LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三项加入 .env.example + README 多厂商示例
```

提交前 `git diff --stat` 复核改动面。

## 11. 阶段路线后续

- Phase 2.3:FINE 模式(人主导编辑器 + AI 工具栏更密集)
- Phase 2.4:5 阶段审核链路 + DraftVersion 快照
- Phase 2.5:4 维质量评分 + 加权榜单

## 修订历史

- v1(2026-05-27,commit 1b780c5):初稿。
- v2(2026-06-02):吸收 verification gap review;LLM 客户端解绑火山方舟改 OpenAI 兼容自定义端点;修正 §3.2 行号引用 49-51、§4.6 移除冗余方法级 Guard、§4.1 ConfigModule 实际由 Phase 1.4 引入且 `apps/api/src/config/` 需新建;补:SSE 错误绕全局 Filter / PLATFORM 默认款用 isStarter / 9 工具 input discriminated union / 流式 × autosave 三段控制 / 前端组件统一 `"use client"`。
- v2.1(2026-06-02):吸收 v2 二轮 verification(D3 FAIL):**§4.4 / §4.5 / §10 改为新建 `PromptsPrivateController`**(类级 UserGuard,路由 `GET /prompts/private`),原 `PromptsController` 保持 `@Public()` 不动以保 Phase 1.4 e2e 向后兼容,避免 `@Public` × `@UseGuards` 元数据优先级歧义;§3.1 流程图加注 `flushAutosave()` / `pauseAutosave()` 对应 §5.3 真实 API `flush()` / `setStreaming(true)`(D2 命名一致性)。
