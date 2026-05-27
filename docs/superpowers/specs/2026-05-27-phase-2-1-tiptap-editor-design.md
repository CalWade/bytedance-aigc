# Phase 2.1 设计 — TipTap 编辑器与防抖自动保存

> 状态：已确认（2026-05-27）。下一步交给 superpowers:writing-plans 出实施计划。

## 1. 目标

让用户能从 `/drafts/mine` 点进一篇草稿、进入富文本编辑器、敲字 1.5 秒后自动落库；刷新页面文字仍在。

不在本 milestone 范围（拆到后续）：FAST/FINE 生成、SSE 流式、9 个 AI 工具卡（拆到 2.2/2.3）、版本快照（拆到 2.4 一起做 DraftVersion）。

## 2. 三个核心决策

| 岔路              | 选择                                                           | 理由                                                                                                       |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 编辑器选型        | **TipTap**                                                     | 文档模型即 ProseMirror JSON 树，可直接落 `drafts.body Json`；BubbleMenu/工具栏生态成熟；中文社区文档充分。 |
| FAST 路径生成传输 | SSE 流式（**不在本 milestone 实现**，本 milestone 仅锁定路线） | 跟 ChatGPT 体验一致，README「5 秒内出首字」承诺需要流式。                                                  |
| 自动保存          | **防抖 1.5s + 只写 `drafts` 表**（不写 `DraftVersion`）        | 单用户编辑场景下表胀可控；DraftVersion 留给「版本历史」专门做去重/压缩。                                   |

## 3. 端到端流

```
登录 → /drafts/mine → 「新建草稿」按钮
  → 后端 POST /drafts 创建空 body 的草稿
  → 跳到 /drafts/[id]
  → 编辑器加载 body 的 ProseMirror JSON
  → 敲字 / 改标题
  → 1.5s 不再动 → 状态条「保存中…」
  → PATCH /drafts/:id 200 → 「已保存 · 刚刚」
  → 刷新页面 → 内容仍在 + version 递增可见
```

## 4. 后端改动

### 4.1 新端点

```
PATCH /drafts/:id
  guard:  UserGuard（Phase 1.5 已落）
  body:   { title?: string; body?: Json }
  授权:   draft.authorId === user.sub，否则 403 Forbidden
  返回:   200 + 完整 Draft（含 ++version）
```

### 4.2 文件改动

新增：

- `apps/api/src/drafts/dto/update-draft.dto.ts` — 手写 optional 字段；不引入 `@nestjs/mapped-types`（多余依赖）。

修改：

- `apps/api/src/drafts/drafts.controller.ts` — 加 `@Patch(":id")`，注入 `@CurrentUser()`。
- `apps/api/src/drafts/drafts.service.ts` — 加 `update(id, authorId, dto)`：先 `findUnique`，对比 authorId 不等抛 `ForbiddenException`，再 `update({ data: { ...dto, version: { increment: 1 } } })`。
- `apps/api/test/drafts.e2e-spec.ts` — 加 3 个用例：①作者更新成功 + version 递增；②非作者 PATCH 得 403；③不存在的 id PATCH 得 404。

### 4.3 有意不做

- **不**做并发版本检查（If-Match / 乐观锁）。单用户编辑场景的 YAGNI。预留升级路径：将来加 `If-Match` 头，service 用 `prisma.draft.update({ where: { id, version: expectedVersion } })` 实现 CAS。
- **不**写 DraftVersion 快照。留给 Milestone 2.4。

## 5. 前端架构

### 5.1 路由

`apps/web/src/app/drafts/[id]/page.tsx`

- Server Component（`async function`），`params: Promise<{ id: string }>` 必须 `await`（Next 16.2.6 破坏性变化，已查 `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` 确认）。
- 不在 Server 端取 draft —— 后端 API 在 `localhost:3000`，需要 Bearer token；token 在 localStorage（浏览器侧），Server Component 拿不到。
- 实际形态：page.tsx 只 await params 后把 `id` 当 prop 传给 `<DraftEditor id={id} />` 这个 client component。

### 5.2 组件

**`apps/web/src/components/draft-editor.tsx`**（`"use client"`）— 容器

- 状态机（discriminated union）：
  ```ts
  type State =
    | { kind: "loading" }
    | { kind: "ready"; draft: DraftDetail }
    | { kind: "not-found" }
    | { kind: "forbidden" }
    | { kind: "error"; message: string };
  ```
- mount 时 `apiFetch("/drafts/${id}")`：
  - 401 → `clearToken()` + `router.replace("/login")`
  - 403 → `forbidden`
  - 404 → `not-found`
  - 200 → `ready`
- 渲染：标题 input + `<TiptapBody>` + `<SaveStatus>`。
- 调 `useAutosave({ title, body })`，回调里组装 PATCH body 后调 `apiFetch`。

**`apps/web/src/components/tiptap-body.tsx`**（`"use client"`）— 纯编辑器

- `useEditor({ extensions: [StarterKit], content: initial, immediatelyRender: false })`。
- `immediatelyRender: false` 是 TipTap 官方推荐的 SSR/Next.js 配方，避免 hydration mismatch。
- `onUpdate: ({ editor }) => onChange(editor.getJSON())`。
- 工具栏：H1 / H2 / Bold / Italic / BulletList / OrderedList 6 个按钮，调 `editor.chain().focus().toggle*().run()` fluent API。

### 5.3 自定义 hook

`apps/web/src/lib/use-autosave.ts`

- 签名：`useAutosave<T>(value: T, save: (v: T) => Promise<void>, delayMs = 1500)`。
- 实现：`useEffect` 监听 value 变化 → `setTimeout(() => save(value), delay)`，cleanup 清 timer。
- 返回：`{ status: "idle" | "dirty" | "saving" | "saved" | "error", lastSavedAt: number | null }`。
- 同时监听 `title` 与 `body`，合并为 `{ title, body }` 一个对象做 debounce → 一次 PATCH 发两个字段。

**为什么不用 swr / react-query：** 项目目前未引；为单个 PATCH 的去抖加 8KB+ 依赖不合算。等 FAST 生成那步再权衡。

### 5.4 SaveStatus 显示

| `status`                | 文字                             |
| ----------------------- | -------------------------------- |
| `idle` + 没存过         | （空）                           |
| `dirty`                 | 「未保存的更改」                 |
| `saving`                | 「保存中…」                      |
| `saved` + `lastSavedAt` | 「已保存 · {relativeTime}」      |
| `error`                 | 「保存失败，点这里重试」（红字） |

`relativeTime` 规则：< 60s 「刚刚」；< 1h 「N 分钟前」；其它绝对时分。每 30s `setInterval` 重渲让相对时间走起来。

### 5.5 「新建草稿」按钮

加到 `apps/web/src/app/drafts/mine/page.tsx` 顶栏右侧（与「退出登录」并列）。点击：

1. `apiFetch("/drafts", { method: "POST", body: JSON.stringify({ title: "未命名草稿", body: { type: "doc", content: [] } }) })`
2. 200 → `router.push("/drafts/" + id)`
3. 401 → 跳登录；其它失败 → toast 风格内联错误。

## 6. 数据流

```
用户敲字
  ↓ TipTap onUpdate
DraftEditor.setBody(json)  ← React state
  ↓ value 变化（{title, body}）
useAutosave: status = "dirty"
  ↓ 1.5s 不再变（连改只触发一次）
status = "saving"
  ↓ apiFetch PATCH /drafts/:id { title, body }
status = "saved" + lastSavedAt = Date.now()
```

错误：网络失败 / 5xx → status = "error"，红字提示，点击触发立即重试（不做指数回退，不做离线队列）。

## 7. 文件清单

**新增**

| 路径                                          | 用途                |
| --------------------------------------------- | ------------------- |
| `apps/api/src/drafts/dto/update-draft.dto.ts` | PATCH 入参校验      |
| `apps/web/src/app/drafts/[id]/page.tsx`       | 路由壳              |
| `apps/web/src/components/draft-editor.tsx`    | 编辑器容器 + 状态机 |
| `apps/web/src/components/tiptap-body.tsx`     | TipTap 富文本本体   |
| `apps/web/src/lib/use-autosave.ts`            | 防抖 hook           |
| `apps/web/src/lib/use-autosave.test.ts`       | hook 4 用例         |

**修改**

| 路径                                       | 改动                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| `apps/api/src/drafts/drafts.controller.ts` | `@Patch(":id")`                                       |
| `apps/api/src/drafts/drafts.service.ts`    | `update()` + 授权                                     |
| `apps/api/test/drafts.e2e-spec.ts`         | 加 3 用例（5→8）                                      |
| `apps/web/src/app/drafts/mine/page.tsx`    | 「新建草稿」按钮                                      |
| `apps/web/package.json`                    | 加 `@tiptap/react` `@tiptap/pm` `@tiptap/starter-kit` |
| `pnpm-lock.yaml`                           | 锁文件                                                |
| `README.md`                                | 新增「内容生产 / 编辑器」小节                         |

## 8. 验收

1. **e2e 8/8 PASS**（5 原有 + 3 新增）。
2. **单测：useAutosave 4 用例 PASS**：①value 变化 → dirty；②停 1.5s 调一次 save；③1.5s 内连改只调一次；④save 失败 → status=error。
3. **静态五连绿屏**：`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`。
4. **手测脚本**：登录 → 新建草稿 → 敲字 → 等 1.5s 看「已保存」→ 刷新 → 内容仍在 + version 递增。

## 9. 风险与回滚

- **TipTap SSR hydration mismatch** → `immediatelyRender: false` 兜底（已查 TipTap docs 确认是官方 Next 配方）。
- **Next 16 `params` Promise 漏 await** → TS 编译期会拦下；运行时也会爆。
- **回滚**：1 个 commit，必要时 `git revert`。后端的 PATCH 端点是纯加法，不动既有 5 个用例。

## 10. 提交

预计 1 个 commit：

```
feat(content): TipTap 编辑器与防抖自动保存(Phase 2.1)
```

**不调 verification 子代理**（用户偏好已记录）。
