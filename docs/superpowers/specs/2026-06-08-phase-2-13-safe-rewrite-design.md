# Phase 2.13 — 一键合规替代 设计文档

> 状态:Spec 待用户审稿 → Plan → Implementation
>
> 范围:PRD §4.2 「中危分级响应」之「一键生成合规替代」。同时接入 §4.1.3 段落审核与 §4.1.4 发布前审核两个触点。**不**包含 §4.6 素材合规一键替代、§5.5 数据回流诊断行动建议。

---

## 0. 上下文与依赖

**上游已 ship**:

- Phase 2.2 — `LlmClient.chatStream`(SSE,Observable 形态)+ `streamFetch`(前端)+ `DraftToolType` 9 工具 + `PromptsService` 平台保留 / 作者私人两层
- Phase 2.3 — `Review` 表 + `ReviewSafety` 6 维(politics / pornography / gambling / drugs / vulgarity / medical / fraud,每维 `severity: 'high'|'medium'|'low'|'none'`)+ 发布前 `ScorePanel` UI
- Phase 2.5 — 段落审核 `ReviewsActionController.section` + `SectionReviewCard.tsx`(3 个 placeholder 按钮:重新生成 / 修改建议 / 仍要保留;Phase 2.6 已把"重新生成"接通,**「修改建议」仍是 console.log placeholder**)
- Phase 2.6 — `DraftStatus.OFFLINE` + admin 复审 + `regenerateSection` 端点

**Phase 2.13 增量(本 spec)**:

- 新端点 `POST /reviews/safe-rewrite/stream`(SSE,2 候选并发)
- 新 `DraftToolType.SAFE_REWRITE`(enum 第 14 个值,对齐 9 工具 + SAFETY_REVIEW + QUALITY_REVIEW + PROMPT_REVIEW + SECTION_REVIEW)
- 新 `SafeRewriteCard.tsx`(侧边对比卡 + 2 候选)
- `SectionReviewCard` 「修改建议」按钮升级为 SafeRewriteCard 入口
- `ScorePanel` safety 行尾 `severity===medium` 时显示「一键替代」按钮
- 平台保留 Prompt 1 条:`safe-rewrite-default`(系统级,作者不可见不可复制)

**显式不做**(本 phase 范围外):

- 素材合规的「换图」(PRD §4.6,涉及图像替代,留给独立 phase)
- 候选差异度评估(2 候选自动判同时 retry,3 周内不堆)
- 候选采纳后自动重审(作者点 Accept 后,前端只回写 editor;**不**主动再调 preflight,作者自己再点「发布」时常规链路会走 §4.1.4)
- §5.5 数据回流诊断行动建议(PRD §5.5 四档诊断,留给后续 phase)

---

## 1. 决策表(brainstorming 已拍板)

| ID        | 决策             | 选择                                                                                                                                                                                                                             |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-2.13.1  | 覆盖范围         | §4.1.3 段落审核 + §4.1.4 发布前审核 **两处都接**(共用同一后端端点,前端两个集成点)                                                                                                                                                |
| D-2.13.2  | UI 形态          | 侧边对比卡 + 2 候选,贴齐 §3.1.2 ToolCandidateCard 设计语言;Accept / Reject / Modify 三态                                                                                                                                         |
| D-2.13.3  | 后端形态         | SSE 流式,2 候选边生边出(共用 1 个 SSE 连接,事件携带 `idx: 0` / `idx: 1` 区分两路)                                                                                                                                                |
| D-2.13.4  | Prompt 归属      | 平台保留(§4.7);新增 `DraftToolType.SAFE_REWRITE`,`PromptsService.list` 默认隐藏;`copyToPrivate` 守卫已覆盖                                                                                                                       |
| D-2.13.5  | 「中危」判定来源 | 复用现有 `ReviewSafety[*].severity` 与 `SectionReviewResponse.severity`;`severity==='medium'` && 不存在 high 时显按钮                                                                                                            |
| D-2.13.6  | 候选数量         | 固定 2 个(对齐 PRD §4.2 「产出 2 个候选给作者选」原文)                                                                                                                                                                           |
| D-2.13.7  | 高危处理         | 不显「一键替代」按钮;`severity==='high'` 走 §4.1.4 既有「拦截」语义,UI 维持 BLOCK                                                                                                                                                |
| D-2.13.8  | 低危处理         | 不显「一键替代」按钮;§4.2 表格规定低危「侧栏温和提示,不阻断」,沿用既有 SectionReviewCard / ScorePanel 文案                                                                                                                       |
| D-2.13.9  | 流式失败兜底     | 任一路 502 / parse 失败 → 该路 candidate 显「重试」按钮,另一路不受影响;若两路都失败,卡片整体显「重试」                                                                                                                           |
| D-2.13.10 | 命中类目透传     | 前端在调 `safe-rewrite/stream` 时把 `hitCategories: SensitiveCategory[]` 传后端,Prompt 用作 hint(让模型知道避哪些)                                                                                                               |
| D-2.13.11 | 段落上下文       | 段落审核入口传该段原文;发布前入口由前端取整篇 `editor.getText()` 的前 800 字符作为 sourceText(见 §3.4 取舍)                                                                                                                      |
| D-2.13.12 | 鉴权             | `UserGuard`(类级既存,挂在 `ReviewsActionController` 已生效)                                                                                                                                                                      |
| D-2.13.13 | Accept 回写      | 段落审核场景:`editor.commands.insertContentAt(violationRange, candidateText)`;发布前场景**不**直接 setContent(整篇替换风险大),改为「toast 提示 + 跳工作台 + localStorage 横幅,作者一键 Apply 插入光标位」(见 §3.4 / §4.3 / §4.4) |
| D-2.13.14 | Modify 行为      | 把候选文本写进编辑器,作者继续编辑;**不**保留 SafeRewriteCard 状态(关卡)                                                                                                                                                          |
| D-2.13.15 | sessionId        | 沿用 Phase 2.5 `StreamSessionStore` 命名规范,前端 `useState(() => "rewrite-" + ts + rnd)`                                                                                                                                        |

---

## 2. 数据模型

### 2.1 Prisma schema 变更

**`DraftToolType` enum 加 1 值**:

```prisma
enum DraftToolType {
  // 9 创作工具(Phase 2.2)
  REWRITE_FLUENT
  EXPAND
  STYLE_TRANSFER
  SUBHEADING
  TITLE_CANDIDATES
  REWRITE_OPENING
  ADD_FACTS
  ADD_TOPIC
  IMAGE_SUGGEST
  // 平台保留(Phase 2.3 + 2.5)
  SAFETY_REVIEW
  QUALITY_REVIEW
  PROMPT_REVIEW
  SECTION_REVIEW
  // ↓ 本 phase 新增
  SAFE_REWRITE       // §4.2 一键合规替代,平台保留
}
```

**migration**:`20260608XXXXXX_phase213_safe_rewrite`,仅 enum 加值。

**`Prompt` 表无 schema 变更**,只是 fixtures 加 1 条 PLATFORM starter。

### 2.2 fixtures 增量

`apps/api/prisma/fixtures/prompts.ts` 加 1 条:

```ts
{
  id: 'safe-rewrite-default',
  name: '一键合规替代(默认)',
  toolType: 'SAFE_REWRITE',
  ownerType: 'PLATFORM',
  ownerId: null,
  systemPrompt: `你是中文长图文合规改写专家。任务:在保留作者原意的前提下,
去除/弱化文本中违反平台规则的元素,使输出可发表。

约束:
1) 保留原文核心信息与作者立场,不擅自反转语义
2) 去除被命中的违规类目相关表达,改用合规替代
3) 不引入新的违规风险(若涉及举例,使用通用化表达)
4) 输出长度与原文相近(±20% 字数浮动)
5) 不输出"以下是改写"之类的元说明,直接输出改写后的正文
6) 不使用列表/标题等结构化标记,保持纯段落形态`,
  userPromptTemplate: `原文:{{sourceText}}

命中违规类目:{{hitCategories}}

请输出 1 个合规改写版本(纯文本,无前缀无后缀)。`,
  status: 'ACTIVE',
}
```

> **设计取舍**:同一 Prompt 在后端被并发调用 2 次,通过 `temperature` / `top_p` 拉差异(idx 0:temp=0.7;idx 1:temp=1.0),不再写第二条 starter。理由:(a) 减小 fixtures 重复;(b) PRD §4.7.1 仅要求"安全审核 Prompt"为平台保留,候选差异通过解码参数实现更工程化。

### 2.3 Shared 类型扩展

`packages/shared/src/review.ts`(同 Phase 2.5 落地点)追加:

```ts
export interface SafeRewriteRequest {
  sourceText: string;
  hitCategories: SensitiveCategory[];
  context: "section" | "preflight";
  sessionId?: string;
}

/** SSE 事件:chunk(增量)/ done(单路结束)/ error(单路失败) */
export interface SafeRewriteChunk {
  idx: 0 | 1;
  delta: string;
}
export interface SafeRewriteDone {
  idx: 0 | 1;
  finalText: string;
}
export interface SafeRewriteError {
  idx: 0 | 1;
  code: "LLM_TIMEOUT" | "LLM_502" | "PARSE_FAIL";
  message: string;
}
```

`SensitiveCategory` 已在 Phase 2.5 export(7 类目 const tuple),直接复用。

---

## 3. 后端

### 3.1 端点

```
POST /reviews/safe-rewrite/stream
  Content-Type: application/json
  Body: SafeRewriteRequest
  Auth: UserGuard(class-level on ReviewsActionController)
  Response: SSE
    event: chunk    data: SafeRewriteChunk
    event: done     data: SafeRewriteDone
    event: error    data: SafeRewriteError
    event: complete data: {}     // 两路都终结(done 或 error)后单发,前端用作总结束信号
```

### 3.2 Service 层 — `ReviewService.safeRewriteStream`

**位置**:`apps/api/src/reviews/review.service.ts`(同 reviewPrompt / reviewSection,沿用既有 ReviewService,不另开 SafeRewriteService 避免模块拆碎)。

**实现要点**:

1. **取 Prompt**:`promptsService.findOneOwnedOrPlatformForTool(SAFE_REWRITE, /* userSub */ null)` —— 平台保留,无 userSub 维度
2. **构造 user prompt**:`render(systemPrompt, { sourceText, hitCategories: hitCategories.join(',') })`
3. **并发 2 路 LLM**:
   ```ts
   const stream0$ = this.llm.chatStream({ messages, temperature: 0.7, top_p: 0.9 });
   const stream1$ = this.llm.chatStream({ messages, temperature: 1.0, top_p: 0.95 });
   ```
4. **合流为单 Observable**:每路 map 出 `{idx, delta}`,merge 成 `Observable<SseEvent>`;每路终结(complete / error)各自发 `done` / `error`;两路都终结时发 `complete`(用 `forkJoin` 触发器)
5. **Buffering 全文**:每路内部维护 `accumulated: string`,close 时一并发 `done.finalText = accumulated`
6. **错误**:LlmClient 已把 502 归一为 `RpcException` → 该路捕获后发 `error{code:'LLM_502'}`,不影响另一路

**伪代码**(`messages` 由步骤 1-2 的 Prompt + 模板渲染产出;`mapErr` 把 LlmClient 抛出的异常归一为 `'LLM_TIMEOUT' | 'LLM_502' | 'PARSE_FAIL'`):

```ts
safeRewriteStream(input: SafeRewriteRequest): Observable<MessageEvent> {
  return new Observable<MessageEvent>(subscriber => {
    let doneCount = 0;
    const tryComplete = () => {
      if (++doneCount === 2) {
        subscriber.next({ type: 'complete', data: {} });
        subscriber.complete();
      }
    };
    [
      { idx: 0, params: { temperature: 0.7, top_p: 0.9 } },
      { idx: 1, params: { temperature: 1.0, top_p: 0.95 } },
    ].forEach(({ idx, params }) => {
      let acc = '';
      this.llm.chatStream({ messages, ...params }).subscribe({
        next: delta => {
          acc += delta;
          subscriber.next({ type: 'chunk', data: { idx, delta } });
        },
        error: err => {
          subscriber.next({ type: 'error', data: { idx, code: mapErr(err), message: err.message } });
          tryComplete();
        },
        complete: () => {
          subscriber.next({ type: 'done', data: { idx, finalText: acc } });
          tryComplete();
        },
      });
    });
  });
}
```

### 3.3 Controller — `ReviewsActionController.safeRewrite`

挂在既存 `apps/api/src/reviews/reviews-action.controller.ts`(Phase 2.5 已建,类级 `@UseGuards(UserGuard)`):

```ts
@Sse('safe-rewrite/stream')
@HttpCode(200)
safeRewrite(@Body() dto: SafeRewriteRequestDto): Observable<MessageEvent> {
  return this.reviewService.safeRewriteStream(dto);
}
```

**DTO**:`SafeRewriteRequestDto` 用 class-validator,字段:

- `@IsString() @MaxLength(8000)` sourceText
- `@IsArray() @ArrayMinSize(1) @IsIn(SENSITIVE_CATEGORIES, { each: true })` hitCategories
- `@IsIn(['section', 'preflight'])` context
- `@IsOptional() @IsString()` sessionId

> **路由说明**:NestJS `@Sse` 注解默认走 GET。本端点用 POST 是因为 sourceText 长(可达 8KB),query 不便。沿用 Phase 2.2 `sections/stream` 的「`@Sse` POST 重写」处理(详见 Phase 2.2 plan 偏离点)。

### 3.4 发布前场景的 sourceText 取法

发布前审核 §4.1.4 是**全文级**安全分,作者点「一键替代」时,**前端**承担"取哪段"的责任:

- 如果 `ScorePanel` 行点击的是某个 medium 维度,前端取**整篇 plain text** 的前 800 字符作为 sourceText
- 800 字符是经验阈值(中文 ≈ 1500 字),覆盖典型头条文章前 1/3,够 LLM 拿到上下文做改写
- 改写完成 Accept 时,**不**自动 setContent —— 因为 800 字符截断后整体替换会丢失后段。改为弹 toast「已生成合规替代,请到工作台对照修改」+ 路由跳 `/drafts/[id]?safeRewrite=preview`(query 参数后端不解析,前端读后展示一次)

> **设计取舍**:这是 §4.1.4 入口在 PRD 里的天然张力 —— 「全文级审核」要给作者一个"按一下就改好"的体验,但全文一把替换风险太大。本 phase 选择「前 800 字 → 候选 → 跳工作台对照」,既兑现 §4.2 「一键」入口承诺,又把决策权留给作者。这一处用 toast + 路由跳转兑现而不是直接 setContent,是把 `D-2.13.13` 的取舍显性化。

### 3.5 模块依赖

`ReviewsModule.providers` 已含 `ReviewService` / `LlmClient`(@Global)/ `PromptsService`,**无新增 provider**。

---

## 4. 前端

### 4.1 `SafeRewriteCard.tsx`(新组件)

**位置**:`apps/web/src/app/drafts/[id]/_components/SafeRewriteCard.tsx`

**Props**:

```ts
interface SafeRewriteCardProps {
  sourceText: string;
  hitCategories: SensitiveCategory[];
  context: "section" | "preflight";
  onAccept: (candidateText: string) => void;
  onReject: () => void;
  onModify: (candidateText: string) => void;
}
```

**形态**(沿用 ToolCandidateCard 设计):

```
┌──────────────────────────────────────────────────────┐
│ 一键合规替代  · 命中:政治/低俗      [×]             │
├──────────────────────────────────────────────────────┤
│ 原文                                                  │
│ <高亮命中部分,标红>                                   │
├──────────────────────────────────────────────────────┤
│ 候选 1                  │ 候选 2                      │
│ <流式 token 逐字到达>    │ <流式 token 逐字到达>      │
│ [Accept] [Modify]        │ [Accept] [Modify]          │
└──────────────────────────────────────────────────────┘
                                            [全部拒绝]
```

**状态机**(组件内 useReducer):

```ts
type State = {
  candidates: [CandidateState, CandidateState]; // 两路
  globalDone: boolean; // complete 事件到达
};
type CandidateState =
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; code: string };
```

**SSE 处理**:复用 Phase 2.2 `streamFetch`,自定义事件 `chunk` / `done` / `error` / `complete`。

**单路 retry**:候选状态为 `error` 时显「重试」按钮,点击只重发**该路**(后端目前不支持单路重发,前端实现是把整条卡重新挂载,体验上等价 —— 这条在 plan 里展开)。

### 4.2 SectionReviewCard 接入(§4.1.3 入口)

`apps/web/src/app/drafts/[id]/_components/SectionReviewCard.tsx`:

- 当 `severity==='medium'` 时,「修改建议」按钮(原 placeholder)的 onClick 改为 `setShowSafeRewrite(true)`
- 卡片下方条件渲染 `<SafeRewriteCard sourceText={段落原文} hitCategories={命中类目} context="section" onAccept={...} onReject={...} onModify={...} />`
- `onAccept(text)`:`editor.commands.insertContentAt(sectionRange, text)`(sectionRange 来自 SectionStream 已记录的段落 from/to)
- `onModify(text)`:同 onAccept,但留作者继续改;UI 关掉 SafeRewriteCard
- 当 `severity==='high'`:维持 Phase 2.5 现有「重新生成 / 仍要保留」二选,**不显**「修改建议」(高危禁改写,作者必须重新生成)

### 4.3 ScorePanel 接入(§4.1.4 入口)

`apps/web/src/app/drafts/[id]/_components/ScorePanel.tsx`:

- 现有 6 维 safety 行渲染时,如果 `dim.severity === 'medium'` 且整体 `safety` 中**不存在** `'high'`,行尾显「一键替代」chip
- 点击 chip 触发模态展开 `<SafeRewriteCard context="preflight" sourceText={editor.getText().slice(0,800)} hitCategories={[dim.category]} ... />`(`editor.getText()` 是 TipTap 内置 plain-text 导出)
- `onAccept` / `onModify`:走 §3.4 描述的「toast + 跳工作台」path,**不**直接 setContent
- 状态写入 `localStorage["safeRewrite:preview:" + draftId]` 让工作台路由命中后展示一次

### 4.4 工作台 preview 展示

`apps/web/src/app/drafts/[id]/page.tsx`:

- 路由参数 `?safeRewrite=preview` 时,从 localStorage 取候选文本,在编辑器顶上挂一条横幅「已生成合规候选,长按「Apply」插入光标位 / 「Discard」放弃」
- 展示一次后清 localStorage,避免下次进入页面再弹

---

## 5. 与既有功能的对接

### 5.1 与 Phase 2.5 段落审核

Phase 2.5 `SectionReviewCard` 有 3 个 placeholder 按钮:**重新生成**(Phase 2.6 接通)/ **修改建议**(本 phase 接通)/ **仍要保留**(Phase 2.5 已接通,仅前端关闭)。本 phase 收掉「修改建议」最后一个 placeholder。

### 5.2 与 Phase 2.3 发布前审核

Phase 2.3 `ScorePanel` 已经按维度展示 severity,本 phase 在 medium 行追加 chip。`PreflightDialog` 的 `[立即发布][先优化再发]` 二选不动 —— 一键替代是行级别的 micro-action,与 dialog 主按钮正交。

### 5.3 与 Phase 2.2 9 工具

`SAFE_REWRITE` 进入 `DraftToolType` enum,但**不**出现在 `PromptsService.list` 默认返回值(同 SAFETY_REVIEW / QUALITY_REVIEW / PROMPT_REVIEW / SECTION_REVIEW 一起被过滤),作者「Prompt 管理」面板看不到。`copyToPrivate` 守卫已覆盖(平台保留 Prompt 一律不可复制)。

### 5.4 鉴权与频控

`UserGuard` 已经在 `ReviewsActionController` 类级生效,沿用。频控:**本 phase 不实现** —— 与 Phase 2.5 `reviewPrompt` 一致,LLM 调用本身有上游计费保护。如未来观察到滥用再加。

---

## 6. 测试

### 6.1 单元测试

**`review.service.spec.ts`** 加 4 个 case:

- safeRewriteStream:两路并发,各发 chunk → done → complete
- safeRewriteStream:idx 0 抛 502 → 该路 error 事件,idx 1 不受影响,complete 仍发
- safeRewriteStream:Prompt 不存在(SAFE_REWRITE PLATFORM starter 缺失)→ 抛 InternalServerError,SSE 不开
- safeRewriteStream:hitCategories 拼到 user prompt(模板渲染)正确

### 6.2 e2e

**新建 `apps/api/test/safe-rewrite.e2e-spec.ts`,5 用例**:

- POST /reviews/safe-rewrite/stream 200 + SSE 收到 ≥ 1 个 chunk + 2 个 done + 1 个 complete(LLM mock 注入两路输出)
- POST /reviews/safe-rewrite/stream 401(无 token)
- POST /reviews/safe-rewrite/stream 400(hitCategories 空数组)
- POST /reviews/safe-rewrite/stream 400(context 非 section/preflight)
- POST /reviews/safe-rewrite/stream sourceText.length > 8000 → 400

> **mock 策略**:沿用 Phase 2.2 / 2.5 的 `mockLlmStream` test 工具,在 e2e setup 里用 `overrideProvider(LlmClient)` 注入两路可控输出。

### 6.3 前端 vitest

**`SafeRewriteCard.test.tsx`**(3 用例):

- 渲染 sourceText + 命中类目高亮
- 收到 SSE chunk 事件后,候选文本逐字累积
- Accept 触发 onAccept 回调并传入正确 text

### 6.4 不在本 phase

- Playwright e2e 跨页面(Phase 2.12 已铺路,后续 phase 视情况追加 1-2 用例,本 phase 不做)
- 准确率离线评估(走 §4.4.3 PE 尾巴,本 phase 不动)

---

## 7. Plan 落地清单(供下阶段 writing-plans)

| Task | 一句话                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| T1   | Prisma schema:`DraftToolType` 加 `SAFE_REWRITE`,migration `phase213_safe_rewrite`                                     |
| T2   | `packages/shared/src/review.ts` 加 `SafeRewriteRequest` / `SafeRewriteChunk` / `SafeRewriteDone` / `SafeRewriteError` |
| T3   | `apps/api/prisma/fixtures/prompts.ts` 加 `safe-rewrite-default` PLATFORM starter                                      |
| T4   | `ReviewService.safeRewriteStream` + 4 单测                                                                            |
| T5   | `ReviewsActionController` 加 `safe-rewrite/stream` 端点 + DTO + 5 e2e                                                 |
| T6   | `SafeRewriteCard.tsx` 新组件 + 3 vitest                                                                               |
| T7   | `SectionReviewCard` 接入「修改建议 → SafeRewriteCard」(§4.1.3)                                                        |
| T8   | `ScorePanel` medium 行追加「一键替代」chip,弹 modal 装 SafeRewriteCard(§4.1.4)                                        |
| T9   | 工作台 `?safeRewrite=preview` 横幅 + localStorage 接力                                                                |
| T10  | README 加 Phase 2.13 小节 + 全仓静态五连(lint / typecheck / test / build / format:check)+ e2e 全绿                    |
| T11  | `git mv` spec / plan 到 `docs/superpowers/{specs,plans}/shipped/`                                                     |

---

## 8. 风险与取舍

| 风险                              | 应对                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2 路 LLM 并发烧 token 翻倍        | 接受 —— PRD §4.2 原文「产出 2 个候选」,这是产品决策不是技术取舍;temperature 拉差异比写两条 Prompt 省 |
| SSE 事件 idx 区分 → 前端 race     | 后端单 Observable 串发,前端按 idx 索引数组累加,无 race;两路 done 后才发 complete                     |
| 发布前 800 字截断丢失后段上下文   | §3.4 已用「toast + 跳工作台对照」path 缓解;不做整篇 setContent                                       |
| 平台保留 Prompt 漂移              | 走 §4.7.3 Prompt 实验室(留给后续 phase),当前版本作为 v1 baseline                                     |
| medium 类目分布偏向单维易显锁屏感 | UI 上「一键替代」chip 仅在该维度行尾,不全局占位;高危/低危都不显 chip                                 |
| 候选差异度低(temperature 不够拉)  | T6 调试时若发现两路输出近似,改 idx 1 提温度到 1.2 / top_p 0.98;不写差异度评估                        |

---

## 9. 与 PRD 评分维度的对应

| PRD §                  | 本 phase 对应                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| §1.3 人机协同          | Accept / Reject / Modify 三态严格遵循;AI 不直接覆盖原文,只生成候选 |
| §3.1.2 侧边对比卡      | SafeRewriteCard 沿用 ToolCandidateCard 设计语言,2 候选并排         |
| §4.1.3 段落审核        | SectionReviewCard 「修改建议」按钮接通                             |
| §4.1.4 发布前审核      | ScorePanel medium 行尾追加「一键替代」chip                         |
| §4.2 分级响应          | **本 phase 主要兑现项**:中危「一键生成合规替代」                   |
| §4.7.1 平台保留 Prompt | `SAFE_REWRITE` 加入保留 Prompt 清单,作者不可见不可改               |

---

## 10. 评估完成的标志

- [ ] `pnpm lint` / `typecheck` / `test` / `build` / `format:check` 全绿
- [ ] `pnpm --filter @bytedance-aigc/api test:e2e` 115+5 = 120 用例全绿(Phase 2.12 末态 115 + 本 phase 5)
- [ ] `apps/web` vitest 41+3 = 44 用例全绿(Phase 2.12 末态 41 + 本 phase 3)
- [ ] 段落审核 medium 命中场景手测:点「修改建议」→ SafeRewriteCard 流式 → Accept 回写编辑器
- [ ] 发布前审核 medium 命中场景手测:`ScorePanel` 行尾「一键替代」→ modal → Accept → 跳工作台横幅 → Apply 插入
- [ ] spec / plan `git mv` 到 `shipped/`
