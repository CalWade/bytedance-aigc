# Phase 2.2 设计 — FAST 模式生成 + 9 AI 工具卡 + Prompt 自定义

> 状态：草稿（2026-05-27），等用户 review。下一步交给 superpowers:writing-plans 出实施计划。

## 1. 目标

让 `/drafts/[id]` 编辑器具备 PRD §3.1.1 / §3.1.2 / §3.5.2 的核心生产力：

1. **FAST 模式全链路** — 选题 → 大纲（3-8 段，非流式）→ 用户编辑大纲 → 分段流式生成正文（SSE）。
2. **9 个 AI 工具卡** — 选中文本后，BubbleMenu 弹出 3 组工具按钮，调用统一端点同步返回候选；用户三态决策 Accept / Reject / Modify。
3. **Prompt 自定义（§3.5.2）** — 平台层只读，用户可"复制到我的"得到一份私人副本；私人 Prompt 可改可删；"当前生效"由前端 localStorage 记录，后端只做 CRUD。

不在本 milestone 范围（拆到后续）：

- FINE 模式（Phase 2.3）
- 5 阶段审核链路（Phase 2.4）
- 4 维质量评分（Phase 2.5）
- DraftVersion 快照（与版本历史一起做）

## 2. 锁定决策表

| 岔路          | 选择                                                                                              | 理由                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 范围          | **一锅出**（一个 spec 一个 plan）                                                                 | FAST 主链路、9 工具、Prompt 写 API 共用 LLM 客户端 + 鉴权 + 编辑器宿主，拆开会反复改同一批文件。   |
| LLM 客户端    | **火山方舟 ARK + OpenAI SDK 兼容模式**                                                            | PRD §6.4 钦定；OpenAI SDK 是事实标准，社区/调试工具最齐；`baseURL` 切换到 ARK 即可。               |
| 流式协议      | **SSE（NestJS `@Sse()` + rxjs Observable）**                                                      | HTTP/1.1 单向流、原生支持断线重连、跟 OpenAI Stream 协议一一对应；WebSocket 在本场景属过度工程。   |
| SSE 鉴权      | **fetch + ReadableStream + `Authorization: Bearer <jwt>` 手解 SSE 帧**                            | 浏览器原生 EventSource 不支持自定义请求头，无法带 JWT；fetch 流式读取 + 手动按 `\n\n` 分帧最干净。 |
| FAST 节奏     | **POST /drafts/:id/outline（非流 JSON）→ 用户编辑 → GET /drafts/:id/sections/stream（SSE 分段）** | 严遵 PRD §3.1.1；大纲短、要稳；分段长、要流。                                                      |
| 9 工具端点    | **统一 `POST /drafts/:id/tools/invoke { tool: DraftToolType, input, promptId? }`**                | 9 工具的输入/输出 shape 高度同构；DTO 用 enum 收敛；新增工具只需扩 enum + 后端 case。              |
| 工具返回模式  | **同步 POST 返回完整候选**（只有 FAST 全文生成走 SSE）                                            | 工具卡平均 < 200 字，等 1-2s 比断流后拼字符串体验更稳；前端实现简单，无需为每个工具加 SSE 状态机。 |
| Prompt 自定义 | **后端 CRUD + 前端 localStorage 记"当前生效"**                                                    | 保持 schema 不动（已经有 `sourcePromptId` 自指链）；"当前生效"是 UI 状态，没有跨设备同步价值。     |
| UI 入口       | **TipTap BubbleMenu，3 组分组：改写类 / 标题类 / 补充类**                                         | 选区即工具，符合 PRD §3.1.2 "选中即可调用"；3 组减少视觉噪音；BubbleMenu 是 TipTap 一等公民扩展。  |

## 3. 端到端流

### 3.1 FAST 主链路

```
用户在 /drafts/[id] 点「FAST 模式」按钮
  → 弹出选题输入框（topic + 可选风格 hint）
  → POST /drafts/:id/outline { topic, hint? }     [非流式]
      ← 200 { sections: [{ heading, summary, hint? }] }   3-8 项
  → 大纲面板渲染为可拖拽/编辑/增删的列表
  → 用户调整完大纲，点「开始生成正文」
  → GET /drafts/:id/sections/stream?cursor=0     [SSE]
      ← event: section.start  data: { index: 0, heading: "..." }
      ← event: token          data: { index: 0, delta: "字" }
      ← event: section.end    data: { index: 0 }
      ← event: section.start  data: { index: 1, ... }
      ← ... 直到 done
      ← event: done           data: {}
  → 前端实时把 token 拼到 TipTap 文档对应段落
  → 流结束后触发一次 PATCH /drafts/:id 落库（沿用 Phase 2.1 自动保存通道）
```

错误路径：

- LLM 调用失败 → SSE `event: error data: { code, message }` → 前端 toast + 保留已生成的部分。
- 用户中途点「停止」→ 前端 `AbortController.abort()` → 后端 rxjs subscription 关闭。

### 3.2 工具调用

```
用户在编辑器选中一段文本
  → BubbleMenu 弹出，分 3 组：
       改写类: REWRITE_FLUENT / EXPAND / TRANSFORM_STYLE / REWRITE_OPENING
       标题类: HEADLINE_SUB / HEADLINE_NEW
       补充类: ADD_FACTS / ADD_TOPIC / IMAGE_SUGGEST
  → 用户点某个工具
  → POST /drafts/:id/tools/invoke
       body: { tool: "REWRITE_FLUENT", input: { text: "<选中的>" }, promptId?: "<localStorage 里当前生效>" }
     ← 200 { candidates: [{ text }] }   通常 1 个，部分工具如 HEADLINE_NEW 可返回 N 个
  → 选区下方浮出候选卡，3 个按钮：
       「采用」  替换原选区文字（TipTap chain().insertContentAt）
       「修改」  把候选填进编辑框，用户改完再「采用」
       「关闭」  丢弃
```

授权：`POST /drafts/:id/tools/invoke` 走 UserGuard，service 层校验 `draft.authorId === user.sub`，沿用 `apps/api/src/drafts/drafts.service.ts:44-58` 的模式。

### 3.3 Prompt 自定义

```
打开「Prompt 设置」抽屉（编辑器右上角入口）
  → GET /prompts                        列出 PLATFORM 全部
  → GET /prompts?owner=PRIVATE         （新参数）列出我的
  → 在某条 PLATFORM 上点「复制到我的」
  → POST /prompts/:platformId/copy     ← 200 创建 PRIVATE 副本，sourcePromptId 指向原 PLATFORM
  → 抽屉切到「我的」分组，新副本可见
  → 编辑文本 → PATCH /prompts/:id { systemPrompt?, params?, fewShots?, designNote? }
  → 删除 → DELETE /prompts/:id
  → 任意一条上点「设为当前生效」→ 仅写 localStorage:
       key:   `bytedance-aigc:active-prompt:<tool>`
       value: <promptId>
  → 之后 BubbleMenu 调工具时把这个 promptId 带进 invoke 请求
```

权限：

- `POST /prompts/:platformId/copy` — UserGuard；source 必须 `owner: PLATFORM`，否则 400。
- `PATCH /prompts/:id` / `DELETE /prompts/:id` — UserGuard；必须 `owner: PRIVATE` && `authorId === user.sub`，否则 403/404；PLATFORM 一律 403（坚守 §3.5.2 "平台只读"）。

## 4. 后端改动

### 4.1 环境变量

新增到 `.env.example` 与 `.env`：

```
ARK_API_KEY=<填到本地>
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=<endpoint id, 例 ep-20260101-xxxxx>
```

`apps/api/src/config/` 已经有 ConfigModule（Phase 1.1 接入），新增 `arkConfig.ts` 读上面三项 + `class-validator` 校验非空。

### 4.2 新增模块 `apps/api/src/llm/`

- `ark.client.ts` — 单例，构造 `new OpenAI({ apiKey: ARK_API_KEY, baseURL: ARK_BASE_URL })`。两个方法：
  - `chat(messages, opts?): Promise<string>` 同步返回（工具走它）
  - `chatStream(messages, opts?): Observable<{ delta: string } | { done: true } | { error: string }>` 流式（FAST 走它）
- `llm.module.ts` — `@Global()` 导出 `ArkClient`。
- 单测：mock OpenAI SDK，覆盖正常返回 + 限流错误 + 流式中断。

### 4.3 新增端点（drafts 模块）

| 路由                              | Guard     | 入参                               | 出参                          |
| --------------------------------- | --------- | ---------------------------------- | ----------------------------- |
| `POST /drafts/:id/outline`        | UserGuard | `{ topic: string, hint?: string }` | `{ sections: OutlineItem[] }` |
| `GET /drafts/:id/sections/stream` | UserGuard | query: `cursor?: number`           | SSE 帧（见 §3.1）             |
| `POST /drafts/:id/tools/invoke`   | UserGuard | `{ tool, input, promptId? }`       | `{ candidates: Candidate[] }` |

`OutlineItem`：`{ heading: string; summary: string; hint?: string }`。

`Candidate`：`{ text: string }`，IMAGE_SUGGEST 工具额外带 `{ alt: string; reason: string }[]`，由 DTO 类型 union 收敛。

### 4.4 新增端点（prompts 模块）

| 路由                             | Guard     | 校验                                                      | 出参       |
| -------------------------------- | --------- | --------------------------------------------------------- | ---------- |
| `GET /prompts?owner=PRIVATE`     | UserGuard | 仅返回 `authorId === user.sub` 的 PRIVATE                 | `Prompt[]` |
| `POST /prompts/:platformId/copy` | UserGuard | source 必须 PLATFORM；新建 PRIVATE，`sourcePromptId` 自指 | `Prompt`   |
| `PATCH /prompts/:id`             | UserGuard | 必须 PRIVATE && `authorId === user.sub`                   | `Prompt`   |
| `DELETE /prompts/:id`            | UserGuard | 必须 PRIVATE && `authorId === user.sub`                   | `204`      |

GET 默认 `owner=PLATFORM` 不变（向后兼容 Phase 1.4）。

### 4.5 文件改动

新增：

- `apps/api/src/llm/ark.client.ts`
- `apps/api/src/llm/llm.module.ts`
- `apps/api/src/llm/dto/chat-message.dto.ts`
- `apps/api/src/config/ark.config.ts`
- `apps/api/src/drafts/dto/outline-request.dto.ts`
- `apps/api/src/drafts/dto/tool-invoke.dto.ts`
- `apps/api/src/drafts/sections.controller.ts` 或并入 `drafts.controller.ts`（倾向并入，路由前缀已经是 `/drafts`）
- `apps/api/src/drafts/outline.service.ts` — 选题 → 大纲的 Prompt 模板 + 调用 ArkClient.chat
- `apps/api/src/drafts/sections.service.ts` — 大纲 → 分段流式生成
- `apps/api/src/drafts/tools.service.ts` — 9 工具 case 分发 + 调用 ArkClient.chat
- `apps/api/src/prompts/dto/copy-prompt.dto.ts`
- `apps/api/src/prompts/dto/update-prompt.dto.ts`
- `apps/api/test/fast-mode.e2e-spec.ts` — outline / sections SSE / tools invoke
- `apps/api/test/prompts-write.e2e-spec.ts` — copy / patch / delete + 越权 403

修改：

- `apps/api/src/drafts/drafts.controller.ts` — 挂三个新路由
- `apps/api/src/drafts/drafts.service.ts` — 抽出 `assertAuthor(id, userSub)` 辅助方法供新 service 复用
- `apps/api/src/drafts/drafts.module.ts` — 注册新 service + 引入 LlmModule
- `apps/api/src/prompts/prompts.controller.ts` — 挂三个写路由 + GET 加 owner 参数
- `apps/api/src/prompts/prompts.service.ts` — copy / update / delete + 越权检查
- `apps/api/src/app.module.ts` — 注册 LlmModule
- `apps/api/.env.example`、根 `.env.example` — 加 ARK\_\* 三项
- `package.json` 依赖：`openai`（OpenAI SDK）

### 4.6 SSE 实现要点

```ts
@Sse(":id/sections/stream")
@UseGuards(UserGuard)
streamSections(
  @Param("id") id: string,
  @CurrentUser() user: JwtPayload,
  @Query("cursor", new DefaultValuePipe(0), ParseIntPipe) cursor: number,
): Observable<MessageEvent> {
  return this.sections.stream(id, user.sub, cursor);
}
```

`sections.service.ts` 返回 `Observable<MessageEvent>`，每帧 `{ data: payload, type: "section.start" | "token" | "section.end" | "done" | "error" }`。Nest 的 `@Sse()` 自动按 `event: <type>\ndata: <json>\n\n` 编码。

错误用专门 `error` 事件，不要 throw（throw 会让连接以 500 关闭，前端无法解析错误体）。

## 5. 前端架构（apps/web）

### 5.1 新增组件

- `apps/web/src/app/drafts/[id]/_components/FastModeDialog.tsx` — 选题输入弹窗
- `apps/web/src/app/drafts/[id]/_components/OutlinePanel.tsx` — 大纲编辑面板（拖拽 / 增删 / 改文字）
- `apps/web/src/app/drafts/[id]/_components/SectionStream.tsx` — 监听 SSE，把 token 拼到 TipTap 文档
- `apps/web/src/app/drafts/[id]/_components/AiBubbleMenu.tsx` — TipTap BubbleMenu 扩展，3 组工具按钮
- `apps/web/src/app/drafts/[id]/_components/ToolCandidateCard.tsx` — Accept / Modify / Reject 三态卡
- `apps/web/src/app/drafts/[id]/_components/PromptDrawer.tsx` — Prompt 列表 / 复制 / 编辑 / 删除 / 设为当前生效
- `apps/web/src/lib/sse.ts` — `streamFetch(url, { headers, signal })` 工具：fetch + ReadableStream + 按 `\n\n` 分帧 + `event:`/`data:` 解析

### 5.2 新增 hooks

- `apps/web/src/hooks/useStreamingGeneration.ts`
  - 输入：`draftId`, `cursor`, `onToken`, `onSectionStart`, `onSectionEnd`, `onDone`, `onError`
  - 内部：调用 `streamFetch` + `AbortController`；返回 `{ start, stop, status }`
- `apps/web/src/hooks/useActivePromptId.ts`
  - 读写 localStorage `bytedance-aigc:active-prompt:<tool>`；SSR 安全（typeof window 守卫）

### 5.3 修改文件

- `apps/web/src/app/drafts/[id]/page.tsx` — 增加 FAST 入口按钮 + Prompt 入口按钮 + 挂 BubbleMenu
- `apps/web/src/lib/auth.ts` — 已有 `apiFetch`；为 SSE 复用其 baseUrl + token 读取，但走 fetch 流式分支

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

`DraftToolType` 直接从 `@bytedance-aigc/shared` 或后端 enum 镜像（保持单一事实源，倾向放 shared 包）。

## 6. 数据流细节

### 6.1 FAST 流式拼接

- 后端按 outline.sections 顺序，对每段生成时发 `section.start` → 多个 `token` → `section.end`。
- 前端在 TipTap 文档里为每个 section 预创建一个 heading + 空 paragraph（heading 用 outline.heading 文本）。
- token 来到时通过 TipTap `chain().insertContentAt(pos, delta).run()` 追加到对应段落末尾。
- `done` 事件后触发一次 `useAutosave` 立即保存。

### 6.2 工具候选三态

- Accept：`editor.chain().focus().deleteSelection().insertContent(candidate.text).run()`
- Reject：仅关闭浮卡，编辑器状态不变。
- Modify：候选文字进 textarea，用户改完点「采用」走 Accept 路径。

### 6.3 Prompt "当前生效"

- 没 promptId 时 invoke 请求不带这个字段，后端用工具默认 PLATFORM Prompt（按 `tool` 查找 `owner=PLATFORM` 的第一条 / starter）。
- 有 promptId 时后端校验：必须 PLATFORM 或 (PRIVATE && authorId === user.sub)，否则 403。

## 7. 文件清单（变更面）

新增 ~18 文件，修改 ~8 文件。详见 §4.5 + §5.3。无需 schema 迁移。

## 8. 验收

### 8.1 单测（vitest）

- `ark.client.spec.ts` — chat / chatStream / 错误传播
- `outline.service.spec.ts` — Prompt 模板插值 + 解析 LLM 输出为 OutlineItem[] + 异常输入回退
- `tools.service.spec.ts` — 9 个 case 至少各 1 个 happy path
- `prompts.service.spec.ts` — copy / update / delete + 越权抛 403/404

### 8.2 e2e（Jest，依赖真实 PG）

`apps/api/test/fast-mode.e2e-spec.ts`：

1. POST /drafts/:id/outline 200 + sections 长度 3-8（mock ArkClient）
2. GET /drafts/:id/sections/stream — 收齐 section.start _ N + token _ M + done
3. POST /drafts/:id/tools/invoke `tool=REWRITE_FLUENT` → 200 + candidates.length >= 1
4. POST /drafts/:id/tools/invoke `tool=HEADLINE_NEW` → 200 + candidates.length >= 1
5. POST /drafts/:id/outline 用别人的 draftId → 403
6. POST /drafts/:id/tools/invoke 不存在的 draftId → 404
7. POST /drafts/:id/tools/invoke `promptId=<别人的 PRIVATE>` → 403

`apps/api/test/prompts-write.e2e-spec.ts`：

1. POST /prompts/:platformId/copy 200 + 返回 PRIVATE + sourcePromptId === platformId
2. PATCH /prompts/:id（自己的 PRIVATE）200
3. PATCH /prompts/:id（PLATFORM）403
4. PATCH /prompts/:id（别人的 PRIVATE）403
5. DELETE /prompts/:id（自己的 PRIVATE）204
6. DELETE /prompts/:id（PLATFORM）403
7. GET /prompts?owner=PRIVATE 只返回自己的

### 8.3 静态五连

`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check` 全绿。

### 8.4 手测脚本（用户跑）

1. 登录 → 新建草稿 → 点「FAST 模式」→ 输入选题「秋天的咖啡馆」→ 看到 5 段大纲
2. 改一下大纲第 2 段的 heading → 点「开始生成正文」→ 看到逐段流式出字
3. 选中一段 → BubbleMenu 弹出 → 点「改写 → 通顺改写」→ 候选浮卡出现 → 点「采用」→ 选区被替换
4. 打开 Prompt 抽屉 → 复制一条 PLATFORM → 改 systemPrompt → 设为当前生效 → 再点工具，请求带上 promptId
5. 刷新页面 → 内容仍在 + version 递增

## 9. 风险与回滚

| 风险                                     | 缓解                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| ARK 速率限制 / 鉴权失败                  | service 层捕获，转 SSE `error` 事件 + REST 500 标准化错误体                                   |
| SSE 在 dev 模式下被 Next.js / Nginx 缓冲 | 后端 response header 显式设 `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` |
| 流式中前端崩溃留下半截文档               | `done` 事件触发 PATCH 保存；中途不写库，崩溃即视为放弃                                        |
| BubbleMenu 选区与流式光标冲突            | 流式期间禁用 BubbleMenu（editor.options.editable = false 直到 done）                          |
| OpenAI SDK 与 ARK 兼容差异               | client 层做一层薄 adapter，碰到不兼容时局部 if/else 不渗到上层                                |

回滚：

- 单 commit 落本期，回滚直接 `git revert`。
- 没有 schema 迁移，DB 状态零影响。
- 已写库的 PRIVATE Prompt 副本会保留（不破坏一致性，符合"删除靠用户"的语义）。

## 10. 提交计划

预计 1 个 commit：

```
feat(content): FAST 模式生成 + 9 AI 工具卡 + Prompt 自定义(Phase 2.2)

后端
- llm: ArkClient(OpenAI SDK 兼容方舟) + LlmModule(@Global)
- drafts: POST /:id/outline, GET /:id/sections/stream(SSE), POST /:id/tools/invoke
- prompts: POST /:id/copy, PATCH /:id, DELETE /:id, GET ?owner=PRIVATE
- e2e: fast-mode 7 用例 + prompts-write 7 用例

前端
- FastModeDialog/OutlinePanel/SectionStream + useStreamingGeneration(fetch+ReadableStream+JWT)
- AiBubbleMenu(3 组工具) + ToolCandidateCard(Accept/Modify/Reject)
- PromptDrawer + useActivePromptId(localStorage 当前生效)

环境
- ARK_API_KEY / ARK_BASE_URL / ARK_MODEL 三项加入 .env.example
```

提交前 `git diff --stat` 复核改动面。

## 11. 阶段路线后续

- Phase 2.3：FINE 模式（人主导编辑器 + AI 工具栏更密集）
- Phase 2.4：5 阶段审核链路 + DraftVersion 快照
- Phase 2.5：4 维质量评分 + 加权榜单
