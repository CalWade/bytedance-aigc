# Phase 2.7:草稿版本历史 + 结构化 diff

**状态**:Spec(待 plan / 实施)
**日期**:2026-06-07
**PRD 锚点**:§3.4 版本历史
**架构锚点**:`docs/architecture.md` §2.1 `creation/versions`

## 1. 目标

把 `DraftVersion` 表从"schema 骨架空跑"提升为完整闭环:
快照触发 → 列表展示 → 双栏结构化 diff → 一键恢复 → 30 版本上限 + 已发布永久保留。

完工后,§2.1 "得力助手"模块只剩 `assets/`(图片/封面)未做。

## 2. 当前事实

- `prisma/schema.prisma` 已有 `DraftVersion(id, draftId, snapshot Json, createdAt)`,**应用层零调用**(grep src/ 无 `draftVersion.create`)。
- `Draft.version Int` 是个自增计数器,与 `DraftVersion` 表语义无关,update 时 +1。
- `drafts.service.update` 是自动保存唯一入口;`drafts.service.publish` 是发布唯一入口。两者都是新增版本的天然钩子点。
- `apps/web/src/components/draft-editor.tsx` 调 `PATCH /drafts/:id`,debounce 自动保存(实测约 1-3 秒触发,频率高)。
- 项目用 TipTap 3 + ProseMirror,无 Yjs。

## 3. 决策(已拍)

| #   | 决策          | 选项                                                                 | 理由                                                  |
| --- | ------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | 快照触发      | 混合(C):AUTO + NAMED + PUBLISHED                                     | PRD "已发布全保 + 自然导出" 暗合三类                  |
| 2   | 存储模型      | 完整 snapshot(A)                                                     | demo 项目体量,Postgres jsonb 无压力,diff 算法可事后换 |
| 3   | diff 库       | `prosemirror-recreate-transform` + `prosemirror-changeset`(组合 3+2) | 唯一开源 + 结构化 diff 路径(能区分文本/格式/结构)     |
| 4   | 时间轴位置    | 全屏模态(C),内部左列表 + 右双栏                                      | 低频高强度,不抢编辑器屏幕                             |
| 5   | diff 渲染范式 | 真双栏并排 + 改动高亮(A)                                             | PRD 字面"左右对照",短文滚动同步可控                   |
| 6   | 版本对比方式  | 当前 vs 某版本(B)                                                    | 实用主义,违 PRD"任意两版本"字面但工程量小,留 backlog  |
| 7   | AUTO 节流     | 5 分钟内同 draft 最多 1 个 AUTO                                      | 自然导出语义,避免每次 PATCH 爆库                      |
| 8   | 30 上限       | 删 AUTO 倒序排在 N 名外的;NAMED + PUBLISHED 永不删                   | 已发布全保(PRD)+ 命名是用户意愿不能丢                 |
| 9   | 恢复语义      | `Draft.body = version.snapshot` + `version + 1`,不自动建新版本       | 5 分钟节流自然 AUTO 兜底                              |
| 10  | DELETE 版本   | 不实现                                                               | 违反"历史"语义                                        |

## 4. 数据层

### 4.1 schema 改动

`apps/api/prisma/schema.prisma`:

```prisma
enum VersionKind {
  AUTO       // 自动节流快照(5 分钟节流,30 上限滚动删)
  NAMED      // 用户显式按"标记版本",有 note,永不删
  PUBLISHED  // 发布时自动建,永不删
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
  @@index([draftId, createdAt])  // 时间轴排序 + 滚动删的查询
  @@map("draft_versions")
}
```

新增字段全部带默认值,migration 不需要数据填充。

### 4.2 不动的字段

- `Draft.version Int` 保持原样(自增计数器,UI 不展示),不与 `DraftVersion` 表绑定
- `Draft.body` 保持单一来源(发布时复制到 `DraftVersion.snapshot`,不互引用)

### 4.3 wordCount 算法

后端冗余存,避免列表显示时遍历 snapshot:

```ts
function countWords(snapshot: Prisma.JsonValue): number {
  // ProseMirror JSON 扁平化:递归取所有 text 节点 .text 字段,sum length
  // 中英混合按字符数(汉字 1 字 / 英文按字节)— 时间轴节点显示用,不要求精确
}
```

## 5. API

新模块 `apps/api/src/drafts/versions/`:`versions.controller.ts` / `versions.service.ts` / `dto/`。

| Method | Path                                | Body        | Resp                            | 鉴权                 |
| ------ | ----------------------------------- | ----------- | ------------------------------- | -------------------- |
| GET    | `/drafts/:id/versions`              | —           | `{ items: VersionDto[] }`       | UserGuard + 草稿作者 |
| GET    | `/drafts/:id/versions/:vid`         | —           | `VersionDetailDto`(含 snapshot) | 同上                 |
| POST   | `/drafts/:id/versions`              | `{ note? }` | `VersionDto`                    | 同上,显式建 NAMED    |
| POST   | `/drafts/:id/versions/:vid/restore` | —           | `{ id, body }`                  | 同上                 |

```ts
type VersionDto = {
  id: string;
  kind: "AUTO" | "NAMED" | "PUBLISHED";
  note: string | null;
  wordCount: number;
  createdAt: string;
};
type VersionDetailDto = VersionDto & { snapshot: JSONContent };
```

`POST /versions` 重复 NAMED 防抖:同一 draft 最近一个版本是 NAMED 且 < 5 秒,返回原版本(防双击)。

### 5.1 自动钩子(不暴露 controller)

修改 `drafts.service`:

- `update()` 末尾调 `versionsService.snapshotAuto(draftId, body)` — 内部判 5 分钟节流
- `publish()` 在 `Draft.status = PUBLISHED` 之前调 `versionsService.snapshotPublished(draftId, body)`

`VersionsService` 暴露三方法:`snapshotAuto / snapshotNamed / snapshotPublished`,前者节流,后两者无条件建。

### 5.2 30 上限滚动逻辑

每次 `snapshotAuto` 建完后:

```sql
DELETE FROM draft_versions
WHERE draftId = ? AND kind = 'AUTO'
  AND id NOT IN (
    SELECT id FROM draft_versions
    WHERE draftId = ? AND kind = 'AUTO'
    ORDER BY createdAt DESC
    LIMIT 30
  )
```

(Prisma 实现:先 `findMany kind=AUTO order desc skip 30`,再 `deleteMany id in [...]`,2 个 query 但好读。)

NAMED + PUBLISHED 永不进入这个 query,保留无上限(demo 项目体量不会爆)。

## 6. 前端

### 6.1 新文件

- `apps/web/src/components/version-history-modal.tsx` — 全屏模态:左侧版本列表 + 右侧双栏 diff 容器
- `apps/web/src/components/version-diff.tsx` — 双栏 diff 渲染(吃 oldDoc + newDoc,内部跑 recreate + changeset)
- `apps/web/src/lib/diff.ts` — 包装 `prosemirror-recreate-transform` + `prosemirror-changeset`,导出 `computeChanges(oldDoc, newDoc)` 返回 `{ insertions: Range[], deletions: Range[] }`

### 6.2 改动

- `apps/web/src/components/draft-editor.tsx`:加"版本历史"按钮(顶栏,与"AI 工具"按钮同档位),点开模态;加"标记此版本"按钮(同档位,弹小输入框收 note)

### 6.3 模态交互

- 列表项:时间(`x 分钟前`)+ 字数 + 类型 chip(NAMED 蓝 / PUBLISHED 绿 / AUTO 灰)+ note(若有)
- 单击列表项 → 右侧加载 `GET /versions/:vid` → 跑 `computeChanges(versionDetail.snapshot, currentDraft.body)` → 双栏渲染
- 右侧顶部:版本元信息 + "恢复为草稿"按钮(确认弹窗 → POST restore → 刷新 editor)
- 模态关闭 → 编辑器状态不变(查看不修改)

### 6.4 双栏 diff 渲染

`version-diff.tsx` 内部:

1. `recreateTransform(oldDoc, newDoc)` 反推出 Transform 对象
2. `ChangeSet.create(oldDoc).addSteps(newDoc, transform.mapping.maps)` 得到 changeset
3. 左栏:渲染 oldDoc(只读 TipTap),deletions 范围加 `<span class="bg-red-100 line-through">`
4. 右栏:渲染 newDoc(只读 TipTap),insertions 范围加 `<span class="bg-green-100">`
5. 滚动同步(简单方案:左栏 onScroll 同步 scrollTop 到右栏)

## 7. e2e 测试

新文件 `apps/api/test/draft-versions.e2e-spec.ts`:

| #   | 用例                                                 | 验证                     |
| --- | ---------------------------------------------------- | ------------------------ |
| 1   | 首次 PATCH draft → AUTO 版本生成                     | `count(kind=AUTO) === 1` |
| 2   | 5 分钟内连续 PATCH × 5 → 仍只有 1 个 AUTO            | 节流生效                 |
| 3   | 5 分钟外再 PATCH → 第 2 个 AUTO                      | 节流释放                 |
| 4   | POST /versions(显式 NAMED + note)→ 列表里有 NAMED    | 正确写入                 |
| 5   | publish → PUBLISHED 版本自动产生                     | publish 钩子生效         |
| 6   | 31 个 AUTO → 第 1 个被删,第 31 个保留                | 滚动删生效               |
| 7   | 1 个 NAMED + 31 个 AUTO → NAMED 永不删               | 类型保护                 |
| 8   | POST /restore → `Draft.body` 等于该 version snapshot | 恢复正确                 |
| 9   | 跨用户访问其他人 draft 的 versions → 403             | 权限正确                 |
| 10  | GET /versions/:vid 返回完整 snapshot                 | 详情正确                 |

预计 ~10 用例,沿用现有 e2e 框架(`applyAllFixtures` / `cleanupAllFixtures`),不改 helper。

### 7.1 单测(可选)

`versions.service.spec.ts`:`countWords` 边界(空 / 中英混合 / 嵌套)、节流计算、滚动 SQL 模拟。

## 8. 取舍 / 不做的事

| 项                        | 不做的理由                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------- |
| 任意两版本对比            | PRD §3.4 字面要求,但 80% 用例是"当前 vs 旧版",留 backlog                               |
| diff 算法升级到段落语义级 | recreate-transform 是 step 级,够用,精度更高的方案需要写 prosemirror-changeset 的渲染层 |
| 版本删除                  | 违 "历史" 语义                                                                         |
| 分支 / 合并               | 线性历史足够                                                                           |
| 协同编辑(Yjs)             | 项目无 Yjs,不为版本历史引入                                                            |
| 增量 patch 存储           | YAGNI,demo 项目体量                                                                    |
| version note 富文本       | 短字符串够用                                                                           |

## 9. 风险 / 未知

- **`prosemirror-recreate-transform` 维护频率低**(2023.12 后慢):API 稳定但要测好。如果集成爆雷,降级方案 = `diff-match-patch` 纯文本 diff(损失格式精度,1 天可上)。
- **滚动同步双栏**:长文滚动可能出现"高度不齐"(因为左右内容差异),先简单 `scrollTop` 同步,出 bug 再加 IntersectionObserver。
- **PATCH 频率**:debounce 1-3 秒触发,5 分钟节流够拦截。但要确认现状 — plan task 1 先验。

## 10. 验证清单

- [ ] schema migrate 成功 + 现有 71+ e2e 不破
- [ ] versions e2e 10 用例全过
- [ ] 前端模态在 demo-author 草稿上能开 / 看 / 切版本 / 恢复
- [ ] typecheck / lint / build 全绿
- [ ] CI 5 job 全绿
- [ ] § 9 风险中的"recreate-transform 集成"实测无大坑

## 11. 完工后状态

- `docs/architecture.md` §2.1 `creation/versions` 从 ❌ → ✅
- §2.1 只剩 `assets/`(图片/封面)未做
- 推 origin/main commit + 记忆文件 `project_phase_2_6_followup_3_then_1.md` 标 Phase 2.7 ship
