# Phase 2.7 实施 Plan:草稿版本历史 + 结构化 diff

**Spec**: `docs/superpowers/specs/2026-06-07-phase-2-7-version-history-design.md`
**预估**: 5-7 天 / 16 个 task / 2 个 commit(后端 + 前端)
**关键风险**: `prosemirror-recreate-transform` 集成 — Task 9 单独验证,失败降级 `diff-match-patch`

## Task 拓扑

```
1. PATCH 频率实测      ← 阻塞设计假设(5 分钟节流够不够)
2. schema migrate      ← 阻塞 3-7
3. VersionsService 骨架
4. VersionsController + DTO
5. 接入 drafts.service 钩子 (update + publish)
6. e2e 10 用例
7. 后端验证(typecheck/lint/build/test/e2e)+ commit ①

8. 装库 + 探针(recreate-transform + changeset)  ← 风险 task,失败转 diff-match-patch
9. lib/diff.ts 包装
10. version-diff.tsx 双栏渲染
11. version-history-modal.tsx 模态壳子 + 列表
12. draft-editor.tsx 加按钮
13. 端到端手测(demo-author 草稿)
14. 前端验证(typecheck/lint/build)
15. commit ② push origin/main
16. CI 远端 5 job 全绿确认
```

---

## Task 1:PATCH 频率实测

**为什么先做**: 5 分钟节流是 spec 的核心假设,如果 PATCH 实际只有几秒一次,节流是必须的;如果是 30 秒一次,节流意义减半但不影响正确性。

**怎么做**:

- 在浏览器开 demo-author 登录,进任意 draft 编辑页,DevTools Network 面板过滤 PATCH /drafts
- 连续打字 30 秒,数 PATCH 次数

**完成标准**: 在 plan 评论或心里记下"每 N 秒一次 PATCH",用于 task 5 节流策略检查。无代码改动。

---

## Task 2:Prisma schema migrate

**改动**: `apps/api/prisma/schema.prisma`

```prisma
enum VersionKind {
  AUTO
  NAMED
  PUBLISHED
}

model DraftVersion {
  id        String      @id @default(cuid())
  draftId   String
  kind      VersionKind @default(AUTO)
  snapshot  Json
  note      String?     @db.Text
  wordCount Int         @default(0)
  createdAt DateTime    @default(now())

  draft Draft @relation(fields: [draftId], references: [id], onDelete: Cascade)

  @@index([draftId])
  @@index([draftId, createdAt])
  @@map("draft_versions")
}
```

**命令**:

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api prisma migrate dev --name phase27_version_history
unset NODE_OPTIONS && pnpm prisma:generate
```

**完成标准**:

- `apps/api/prisma/migrations/<timestamp>_phase27_version_history/migration.sql` 出现
- `apps/api/test/fixtures/index.ts` 的 cleanup 顺序**不改**(原 `draftVersion.deleteMany()` 已在,字段加了不影响)
- `pnpm --filter @bytedance-aigc/api typecheck` 绿

**坑**: migrate 失败常见原因 = postgres 没起。`docker-compose up -d postgres` 起本地。

---

## Task 3:VersionsService 骨架

**新文件**: `apps/api/src/drafts/versions/versions.service.ts`

**对外方法**(详见 spec §5.1):

- `list(draftId): Promise<VersionDto[]>` — order desc by createdAt
- `findOne(draftId, versionId): Promise<VersionDetailDto>`(校验 draftId 匹配)
- `createNamed(draftId, note?: string): Promise<VersionDto>` — 5 秒防抖(已有 NAMED < 5 秒返回原)
- `restore(draftId, versionId): Promise<{ id, body }>` — `Draft.body = snapshot` + `version + 1`
- `snapshotAuto(draftId, body): Promise<void>` — 5 分钟节流后建 + 30 滚动删
- `snapshotPublished(draftId, body): Promise<void>` — 无条件建

**辅助**: `countWords(snapshot)` 私有函数,递归取 ProseMirror text 节点 sum length。

**关键约束**:

- 所有方法**不**校验作者(由 controller 层 `assertAuthor` 守门),service 只关心数据
- `snapshotAuto` 节流逻辑:`SELECT MAX(createdAt) WHERE kind=AUTO AND draftId=?`,若 < 5 分钟返回不动作
- 30 滚动删:`findMany kind=AUTO order desc skip 30` → `deleteMany id in [...]`,2 query 易读

**完成标准**: typecheck 过,但暂无 controller 测试。

---

## Task 4:VersionsController + DTO

**新文件**:

- `apps/api/src/drafts/versions/versions.controller.ts`
- `apps/api/src/drafts/versions/dto/create-version.dto.ts`(`note?: string`,带 `class-validator`)

**4 个端点**(spec §5):

```ts
@Controller('drafts/:id/versions')
@UseGuards(UserGuard)
class VersionsController {
  @Get() list(@Param('id') id, @CurrentUser() user) {
    await this.draftsService.assertAuthor(id, user.id);
    return { items: await this.versions.list(id) };
  }

  @Get(':vid') findOne(...) { /* 同样先 assertAuthor */ }
  @Post() createNamed(@Body() dto: CreateVersionDto, ...) { /* assertAuthor */ }
  @Post(':vid/restore') restore(...) { /* assertAuthor */ }
}
```

**Module 改动**: `apps/api/src/drafts/drafts.module.ts` — 加入 `VersionsController` 到 `controllers`,`VersionsService` 到 `providers + exports`(task 5 要给 drafts.service 注入)。

**完成标准**: `apps/api/src` typecheck 绿,`pnpm lint` 绿。手动 curl 一个端点验证(可选)。

---

## Task 5:接入 drafts.service 钩子

**改动**: `apps/api/src/drafts/drafts.service.ts`

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly versions: VersionsService,  // 新增注入
) {}

async update(id, authorId, dto) {
  // ... 原逻辑
  const updated = await this.prisma.draft.update({ where: { id }, data });
  if (dto.body !== undefined) {
    await this.versions.snapshotAuto(id, updated.body);  // 新增
  }
  return updated;
}

async publish(id, authorId) {
  // ... 原校验
  await this.versions.snapshotPublished(id, draft.body);  // 状态机改前
  const updated = await this.prisma.draft.update({...});
  return ...;
}
```

**关键约束**:

- `snapshotAuto` 在 update 成功后才调,失败不应阻塞 update 主流程 — 用 `try { ... } catch { logger.error() }` 隔离
- `snapshotPublished` 在 `Draft.status = PUBLISHED` **之前**调,语义上"发布瞬间快照"
- 循环依赖检查:VersionsService 不能注入 DraftsService(只用 PrismaService)

**完成标准**: 现有 71+ e2e **不破**(原有发布、PATCH 流程仍工作),新 versions e2e 待 task 6 写。

---

## Task 6:e2e 10 用例

**新文件**: `apps/api/test/draft-versions.e2e-spec.ts`

按 spec §7 的 10 个用例,沿用既有 helper(`createTestApp` / `applyAllFixtures` / `loginAs`)。

**关键技巧**:

- 节流测试需要"修改 createdAt":Prisma `prisma.draftVersion.update({ where: { id }, data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) } })` 把已有 AUTO 时间往前推
- 31 个 AUTO 测试可以通过直接 `prisma.draftVersion.createMany` 注入 30 个,再触发 1 次 PATCH,断言总数仍 30
- 跨用户测试:`loginAs('demo-author')` 建 draft,`loginAs('tech-author')` 调 GET,期望 403

**完成标准**:

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api test:e2e -- draft-versions
```

全过 + 全套(原 19 套件 + 1 = 20)总数也全过。

---

## Task 7:后端验证 + commit ①

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api typecheck
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api lint
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api build
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api test
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api test:e2e
```

全绿后 commit:

```
feat(api): Phase 2.7 草稿版本历史后端 (versions module)

- DraftVersion 加 kind/note/wordCount 字段 + index(draftId, createdAt)
- VersionsService: snapshotAuto(5min 节流) / snapshotNamed / snapshotPublished
- 30 上限滚动:仅删 AUTO 倒序排在 30 名外的;NAMED + PUBLISHED 永不删
- 接入 drafts.service.update + publish 钩子(失败不阻塞主流程)
- 4 个 REST 端点:list / findOne / createNamed / restore(权限走 assertAuthor)
- 10 个 e2e 用例:节流 / 滚动 / 类型保护 / 跨用户 403 / restore 正确性
```

---

## Task 8:装库 + 探针 (风险点)

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web add prosemirror-changeset @manuscripts/prosemirror-recreate-steps
```

**注意**: `prosemirror-recreate-transform` 在 npm 上有几个 fork,选 `@manuscripts/prosemirror-recreate-steps`(maintained by Manuscripts editor)或 `@technik-sde/prosemirror-recreate-transform`(sueddeutsche 旧版的 fork)。先装一个试,跑探针:

**探针**: 写个临时 `apps/web/test/diff-probe.ts`(或直接在浏览器 console),输入两个简单 ProseMirror JSON,跑 `recreateTransform(old, new)` + `ChangeSet.create(old).addSteps(...)`,console.log 输出。

**判定**:

- ✅ 输出有 `inserted` / `deleted` 数组 → 继续 task 9
- ❌ 报错 / 输出空 / 类型不兼容 → **降级**:卸 recreate,装 `diff-match-patch`(Apache-2.0 工业级),task 9-10 改用 `editor.state.doc.textBetween` 抽文本 → diff-match-patch → 渲染。损失格式精度,但 1 天可交付。

**完成标准**: 拿到一个工作示例 + 类型签名,丢弃探针文件。

---

## Task 9:lib/diff.ts 包装

**新文件**: `apps/web/src/lib/diff.ts`

```ts
export type DiffRange = { from: number; to: number };
export type DiffResult = {
  insertions: DiffRange[];  // 在 newDoc 坐标系
  deletions: DiffRange[];   // 在 oldDoc 坐标系
};

export function computeChanges(
  oldDoc: JSONContent,
  newDoc: JSONContent,
  schema: Schema
): DiffResult { ... }
```

**实现** (假设 task 8 选了 recreate + changeset):

```ts
const oldNode = Node.fromJSON(schema, oldDoc);
const newNode = Node.fromJSON(schema, newDoc);
const tr = recreateTransform(oldNode, newNode);
const cs = ChangeSet.create(oldNode).addSteps(newNode, tr.mapping.maps);
const insertions = cs.changes.map((c) => ({ from: c.fromB, to: c.toB }));
const deletions = cs.changes.map((c) => ({ from: c.fromA, to: c.toA })).filter(/* 真删 */);
```

**降级版本** (task 8 走 diff-match-patch 路线):

- 抽文本 → diff-match-patch → 返回 [`-1` deletion, `0` equal, `1` insertion] 元组数组,让 diff 组件直接消费

**完成标准**: typecheck 绿 + 一个手写单测样例 (`apps/web/src/lib/diff.test.ts`,可选,Vitest 跑),验证简单 case。

---

## Task 10:version-diff.tsx 双栏渲染

**新文件**: `apps/web/src/components/version-diff.tsx`

```tsx
export function VersionDiff({ oldDoc, newDoc }: { oldDoc; newDoc }) {
  const ranges = computeChanges(oldDoc, newDoc, schema);

  // 简单方案:左右各渲染一个只读 TipTap,Decoration 加 class
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // 滚动同步:左 onScroll → 右 scrollTop
  const onLeftScroll = (e) => {
    if (rightRef.current) rightRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <div ref={leftRef} onScroll={onLeftScroll} className="overflow-y-auto">
        <ReadOnlyEditor
          doc={oldDoc}
          highlightRanges={ranges.deletions}
          highlightClass="bg-red-100 line-through"
        />
      </div>
      <div ref={rightRef} className="overflow-y-auto">
        <ReadOnlyEditor
          doc={newDoc}
          highlightRanges={ranges.insertions}
          highlightClass="bg-green-100"
        />
      </div>
    </div>
  );
}
```

**ReadOnlyEditor 实现要点**:

- 用 TipTap 的 `useEditor({ editable: false, ... })`
- Highlight 通过 ProseMirror Decoration:`Decoration.inline(from, to, { class: highlightClass })`,套一个简单 Plugin

**降级版本** (diff-match-patch):

- 不用 TipTap,直接渲染纯文本 + `<span>` 高亮(损失格式但简单)

**完成标准**: 浏览器手测打开模态能看到双栏 diff,改动有红绿。

---

## Task 11:version-history-modal.tsx 模态壳子

**新文件**: `apps/web/src/components/version-history-modal.tsx`

UI 结构:

```
┌─────────────────────────────────────────────┐
│ 版本历史                                  X │
├──────────┬──────────────────────────────────┤
│ 列表     │ 选中版本元信息                    │
│ ─ v1     │ [恢复为草稿]                     │
│ ─ v2 ★   │ ────────────────                  │
│ ─ v3 📤  │ <VersionDiff old={selected} new={current} /> │
│ ...      │                                  │
└──────────┴──────────────────────────────────┘
```

**列表项**: time + word count + kind chip(NAMED 蓝 / PUBLISHED 绿 / AUTO 灰)+ note

**关键交互**:

- 单击列表项 → fetch `/drafts/:id/versions/:vid` → setState selected → diff 区渲染
- "恢复为草稿"按钮 → confirm → POST `/restore` → onClose + 调用父级 `onRestored(newBody)` 回调更新 editor

**完成标准**: 自己手测能开 / 切版本 / 看 diff / 恢复。

---

## Task 12:draft-editor.tsx 加按钮

**改动**: `apps/web/src/components/draft-editor.tsx`

加 2 个按钮:

1. **"版本历史"** → 打开模态
2. **"标记此版本"** → 弹小输入框收 note → POST `/drafts/:id/versions { note }` → toast 成功

按钮风格抄已有的次要按钮(`text-xs rounded border border-zinc-300 ...`)。位置:顶栏(标题旁),与"AI 工具"档位齐。

**关键约束**: 模态打开时 editor **不卸载**,`onRestored(newBody)` 回调直接 `editor.commands.setContent(newBody)` 更新 TipTap state。

**完成标准**: 浏览器手测整个闭环跑通(按钮 → 模态 → 切版本 → diff → 恢复 → editor 更新)。

---

## Task 13:端到端手测

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api start:dev &
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web dev
```

测试清单(以 demo-author):

- [ ] 进 draft 编辑页,打字 30 秒 → DB 里有 1 个 AUTO 版本(节流生效)
- [ ] 点"标记此版本",填 note "初稿" → 列表里出现 NAMED(蓝)
- [ ] 模拟 5 分钟外再编辑 → 第 2 个 AUTO 出现
- [ ] 发布 draft → PUBLISHED(绿)出现
- [ ] 选某 NAMED → 双栏 diff 渲染(短文应清晰)
- [ ] 点"恢复为草稿" → editor 内容变 + 关闭模态
- [ ] 关闭模态后再编辑 → 触发新 AUTO(确认 update 钩子未坏)

---

## Task 14:前端验证

```bash
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web typecheck
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web lint
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web build
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web test  # 若有
```

全绿后进 task 15。

---

## Task 15:commit ② push

```
feat(web): Phase 2.7 版本历史前端模态 + 双栏结构化 diff

- VersionHistoryModal:左侧时间轴列表(NAMED 蓝 / PUBLISHED 绿 / AUTO 灰)+ 右侧双栏 diff + 恢复按钮
- VersionDiff:基于 prosemirror-recreate-transform + prosemirror-changeset 的结构化 diff,左红删除 / 右绿新增,scrollTop 同步
- DraftEditor 加 "版本历史" + "标记此版本" 按钮(顶栏次要档位)
- 恢复回调通过 setContent 直接更新 editor state,不卸载组件
```

(若 task 8 走降级:文案改 "基于 diff-match-patch 的纯文本 diff,损失格式精度,留 backlog 升级")

```bash
unset NODE_OPTIONS && git push origin main
```

---

## Task 16:CI 远端 5 job 全绿确认

```bash
unset NODE_OPTIONS && gh run list --branch main --limit 1
unset NODE_OPTIONS && gh run view <run-id> --json status,conclusion,jobs
```

5 job(lint/typecheck/test/build/e2e)conclusion 都是 success。e2e job 现在跑 20 套件 / ~104 用例(原 94 + 新 10),时长可能从 44s 涨到 ~50s。

---

## 关键约束(全 task 通用)

1. **`unset NODE_OPTIONS && ` 前缀**: 所有 pnpm/git 命令前都要加,因为环境里有 `--no-http2` 污染。Husky pre-commit hook 也踩,commit 时同样加。
2. **不动 fixtures handle**: `demo-author` / `admin` / `tech-author` / `life-author`,不要"为了好看"改 user fixtures。
3. **不动既有 e2e helper**: `applyAllFixtures` / `cleanupAllFixtures` / `loginAs` 沿用,新 spec 用同套。
4. **schema 改动用 migrate dev,不用 migrate deploy**: 后者只在 CI 用。
5. **小红书风格**: 大部分 draft body 是短文(< 10KB),设计取舍以这个体量为基础。
6. **不引入 Yjs**: 即使为了用 Tiptap Snapshot Compare 也不引入。

---

## 验证清单(全完成时勾)

- [ ] schema migration 生成 + apply 成功 + 既有 e2e 不破
- [ ] VersionsService 6 方法 + Controller 4 端点
- [ ] e2e 10 用例全过
- [ ] 后端 commit ① + 静态校验 5 项绿
- [ ] recreate-transform + changeset 集成成功(或降级 diff-match-patch)
- [ ] 模态 + 双栏 diff + 恢复闭环跑通
- [ ] 前端 commit ② push origin/main
- [ ] CI 5 job 全绿
- [ ] 独立 verification agent PASS
- [ ] 记忆文件 `project_phase_2_6_followup_3_then_1.md` 标 Phase 2.7 ship,提示进入 §2.1 `assets/` 或继续按架构推进 §2.2

完工后,§2.1 `creation/versions` ❌ → ✅。
