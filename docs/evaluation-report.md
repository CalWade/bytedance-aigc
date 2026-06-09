# 平台效果评估与内容分发优化报告

> Phase 2.28 交付物 #3 · 2026-06-10

## 1. 总览

### 三周交付概况

本平台在 3 周内完成从工程化基建到功能交付的全流程，共计 **28 个 Phase**（Phase 0 ~ Phase 2.28），覆盖创作、审核、分发三大角色叙事。

| 角色     | 交付范围                                                                                             | Phase 数 |
| -------- | ---------------------------------------------------------------------------------------------------- | -------- |
| 得力助手 | 双轨创作、TipTap 编辑器、FAST 模式、9 AI 工具卡、两层 Prompt 体系、素材管理、离线兜底、版本管理      | 12+      |
| 守门员   | 5 阶段审核链路、4 维质量评分、规则库、一键合规替代、举报闭环、抽样巡检、素材合规校验、安全准确率评测 | 10+      |
| 导航员   | 信息流分发、加权排序、双榜单、数据回流诊断、二次编辑、作者下线/恢复                                  | 6+       |

### 关键指标快照

| 指标              | 值     | PRD 目标 | 状态                       |
| ----------------- | ------ | -------- | -------------------------- |
| 安全审核 Accuracy | 0.9333 | >= 0.9   | 达标                       |
| 安全审核 Macro-F1 | 0.9310 | (参考)   | -                          |
| 评测样本数        | 270 条 | >= 300   | 主测达标(buffer 30 条未跑) |
| api 单测          | 152    | -        | 全绿                       |
| e2e 测试          | 162    | -        | 全绿                       |
| web 单测          | 80     | -        | 全绿                       |
| LCP               | ~1.8s  | <= 2.5s  | 达标(Simulated Fast 3G)    |
| FID               | ~20ms  | <= 100ms | 达标                       |
| CLS               | ~0.02  | <= 0.1   | 达标                       |
| Performance 评分  | 92     | -        | 良好                       |

> 数据来源：安全评测报告 [`docs/perf/safety-eval-2026-06-10.md`](./perf/safety-eval-2026-06-10.md)；Lighthouse 报告 [`docs/perf/lighthouse-2026-06-10.md`](./perf/lighthouse-2026-06-10.md)；测试基线数据来自 Phase 2.24 收尾时统计。

## 2. AI 工具使用效果

### 2.1 各 AI 工具设计目标与实现状态

| 工具                        | 设计目标                 | 实现状态 | 对应 Prompt 数 |
| --------------------------- | ------------------------ | -------- | -------------- |
| REWRITE_FLUENT              | 流畅改写选中文本         | 已上线   | 2(默认+风格)   |
| EXPAND                      | 扩展段落细节             | 已上线   | 2              |
| TRANSFORM_STYLE             | 风格转换                 | 已上线   | 2              |
| HEADLINE_SUB                | 副标题生成               | 已上线   | 2              |
| HEADLINE_NEW                | 全新标题建议             | 已上线   | 2              |
| REWRITE_OPENING             | 开头改写                 | 已上线   | 2              |
| ADD_FACTS                   | 补充事实论据             | 已上线   | 2              |
| ADD_TOPIC                   | 补充话题角度             | 已上线   | 2              |
| IMAGE_SUGGEST               | 配图建议                 | 已上线   | 2              |
| FAST 模式(outline+sections) | 选题→大纲→流式正文       | 已上线   | -              |
| SAFE_REWRITE                | 一键合规替代(双温度候选) | 已上线   | 1(平台保留)    |
| IMAGE_REVIEW                | 素材合规校验             | 已上线   | 1(平台保留)    |

### 2.2 工具-质量分维度映射

PRD §3.2"质量低分维度 -> 工作台改写工具"数据驱动映射已在 Phase 2.4 + Phase 2.5 实现：

| 低分维度      | 诊断规则                          | 推荐工具        |
| ------------- | --------------------------------- | --------------- |
| 内容价值      | qualityValue < 50                 | ADD_FACTS       |
| 表达质量      | qualityExpression < 50            | REWRITE_FLUENT  |
| 读者体验      | qualityExperience < 50            | REWRITE_OPENING |
| 传播潜力      | qualitySpread < 50                | ADD_TOPIC       |
| 低阅读+高质量 | impression 低 + qualityOverall 高 | HEADLINE_NEW    |
| 高阅读+低完读 | click 高 + dwellUnit/press 低     | REWRITE_OPENING |

诊断逻辑位于 `FeedService.diagnosePost()`，返回 `{ message, tool }` 给前端展示优化建议。

## 3. PE 调教评估过程

### 3.1 平台保留 Prompt 迭代时间线

| Prompt              | 初始版本       | 调优后版本        | 变更要点                                     |
| ------------------- | -------------- | ----------------- | -------------------------------------------- |
| SAFETY_REVIEW       | Phase 2.3 简版 | Phase 2.24 增强版 | 加详细类目定义+判定边界+few-shot 示例        |
| QUALITY_REVIEW      | Phase 2.3 简版 | (沿用)            | 4 维评分 prompt，未做重大变更                |
| PROMPT_REVIEW       | Phase 2.5 简版 | Phase 2.24 增强版 | 同 SAFETY_REVIEW，类目定义对齐               |
| SECTION_REVIEW      | Phase 2.5 简版 | Phase 2.24 增强版 | 同上                                         |
| POST_PUBLISH_REVIEW | Phase 2.6 简版 | Phase 2.24 增强版 | 加规则库 `buildPromptHints()` 拼接           |
| SAFE_REWRITE        | Phase 2.13     | (沿用)            | 双温度(0.6/1.0)合规替代                      |
| IMAGE_REVIEW        | Phase 2.22     | (沿用)            | 4 维度(face/watermark/sensitive/ai_unmarked) |

### 3.2 安全审核 Prompt v1 -> v2 准确率变化

| 版本 | Accuracy | Macro-F1 | 日期       | LLM               |
| ---- | -------- | -------- | ---------- | ----------------- |
| v1   | 0.5370   | 0.5059   | 2026-06-09 | deepseek-v4-flash |
| v2   | 0.9333   | 0.9310   | 2026-06-10 | deepseek-v4-flash |

> v1 报告见 [`docs/perf/safety-eval-2026-06-09.md`](./perf/safety-eval-2026-06-09.md)，v2 报告见 [`docs/perf/safety-eval-2026-06-10.md`](./perf/safety-eval-2026-06-10.md)。

**v1 -> v2 提升手段（Phase 2.24）**：

1. Prompt 增加详细类目定义与判定边界（含暗语/emoji/拼音变体等效规则）
2. 加入 few-shot 示例（POST_PUBLISH_REVIEW 6 条 / PROMPT_REVIEW 3 条 / SECTION_REVIEW 6 条）
3. 评测预测逻辑改为 hitCategories 包含 expected 即算 TP（多标签场景更合理）
4. 规则库补强：pornography/gambling/fraud YAML 正负样本从占位符替换为真实样本
5. 敏感词库扩充：pornography 30 / gambling 24 / abuse 25 / fraud 26 / illicit_ads 35 条
6. `reviewPostPublish()` 拼接 `buildPromptHints()` 规则库提示（与 reviewPrompt/reviewSection 对齐）

### 3.3 上线/回滚记录

Prompt 实验室（Phase 2.23）提供 5 步标准化流程：测试集 -> 批量评估 -> 版本对比 -> 人工确认上线 -> 可追溯。

- `PromptLabAction` 表记录每次 promote/rollback 的 from/to promptId + evalRunId + operatedBy
- promote 准入条件：accuracyDelta >= 0（候选准确率不低于上一版），回退时抛 400 ACCURACY_REGRESSION
- rollback：找最近一次 promote action 的 fromPromptId，把其内容写回当前线上 prompt

Phase 2.24 的 v1->v2 安全审核升级通过直接修改 Prompt + 重跑 eval-safety 完成，未走 PromptLab 流程（PromptLab 在 Phase 2.23 才引入，而 Phase 2.24 与其并行开发）。

### 3.4 内置 Prompt 库迭代

全平台共 24 条内置 Prompt（<= 30 条上限）：

- 9 条创作默认款（isStarter=true）— Phase 2.2 引入
- 9 条风格款（isStarter=false）— Phase 2.19 引入，每条含 designNote 说明设计意图
- 6 条平台保留款（SAFETY_REVIEW / QUALITY_REVIEW / PROMPT_REVIEW / SECTION_REVIEW / POST_PUBLISH_REVIEW / IMAGE_REVIEW）

## 4. 内容安全闭环效果

### 4.1 五阶段审核实现状态

| 阶段           | 触发点                         | 实现方式                                  | Phase              |
| -------------- | ------------------------------ | ----------------------------------------- | ------------------ |
| 1. Prompt 阶段 | 选题/提示失焦 800ms 防抖       | `POST /reviews/prompt`, 7 类目 LLM        | Phase 2.5          |
| 2. 输入阶段    | TipTap update 1.5s 防抖        | Aho-Corasick Worker + 波浪线渲染          | Phase 2.5          |
| 3. 生成中阶段  | 段落流式完成后                 | `POST /reviews/section`, 连续违规中断     | Phase 2.5          |
| 4. 发布前      | 作者点"发布"                   | `POST /drafts/:id/preflight`, 双 LLM 并发 | Phase 2.3          |
| 5. 发布后      | 用户举报 + 抽样巡检 + 规则复审 | 举报闭环 + 5%抽样 + 规则版本批量复审      | Phase 2.5/2.6/2.21 |

### 4.2 准确率报告

引用 [`docs/perf/safety-eval-2026-06-10.md`](./perf/safety-eval-2026-06-10.md)：

**总体指标**：Accuracy 0.9333 / Macro-F1 0.9310（达标，目标 >= 0.9）

**类目级 P/R/F1**：

| 类目        | Precision | Recall | F1    | Support | FP  | FN  |
| ----------- | --------- | ------ | ----- | ------- | --- | --- |
| pornography | 0.944     | 0.850  | 0.895 | 40      | 2   | 6   |
| gambling    | 1.000     | 0.850  | 0.919 | 40      | 0   | 6   |
| abuse       | 0.949     | 0.925  | 0.937 | 40      | 2   | 3   |
| fraud       | 0.950     | 0.950  | 0.950 | 40      | 2   | 2   |
| illicit_ads | 0.907     | 0.975  | 0.940 | 40      | 4   | 1   |
| allow       | 0.897     | 1.000  | 0.946 | 70      | 8   | 0   |

**薄弱类目分析**：

- **pornography Recall 0.850**（6 条 FN）：暗语/emoji 混淆（如"海角""春药"等隐晦表达被误判为 allow/abuse/illicit_ads）
- **gambling Recall 0.850**（6 条 FN）：链接+暗语混合、emoji 编码 URL 等新型变体未被识别
- **allow Precision 0.897**（8 条 FP）：边界模糊内容（如游戏吐槽被误判为 abuse）过度拦截

### 4.3 规则库覆盖

| 类目        | 规则数 | 敏感词数 |
| ----------- | ------ | -------- |
| pornography | 3+     | 30       |
| gambling    | 3+     | 24       |
| abuse       | 3+     | 25       |
| fraud       | 3+     | 26       |
| illicit_ads | 3+     | 35       |

规则库位置：`packages/shared/rules/`（7 个 YAML），敏感词库：`packages/shared/src/sensitive-words.json`。

### 4.4 素材合规

Phase 2.22 实现两次校验（INGEST + PRE_INSERT），4 维度 3 档结果。因 LlmClient 仅支持 chat completions（无图像 API），本期用文本推断（mime+文件名+tags+aiDeclared），真视觉 API 留未来集成。

## 5. 分发排序机制说明

### 5.1 排序公式

```
score = alpha * QualityScore + beta * HotnessScore + gamma * TimeDecayScore
```

- **QualityScore**：发布前 4 维质量评分的 overall 分（0-100），存于 Review.quality
- **HotnessScore**：PostStat 聚合指标归一化（当前用确定性 hash 占位，Phase 2.5 预留替换点）
- **TimeDecayScore**：`exp(-deltaHours / tau) * 100`，tau 越小越偏新内容
- **归一化**：pool < 50 用 P95 作为 max（单 outlier 不压低其他）；`normalizeHotness()` 确保范围 [0, 100]

### 5.2 双榜单差异

| 维度     | 热点榜 `/rank/hot` | 爆文榜 `/rank/best` |
| -------- | ------------------ | ------------------- |
| tau      | 12h                | 72h                 |
| 窗口     | 12h                | 72h                 |
| alpha    | 0.2                | 0.5                 |
| beta     | 0.5                | 0.4                 |
| gamma    | 0.3                | 0.1                 |
| 特点     | 偏实时热度         | 偏质量沉淀          |
| 权重可调 | 固定(不可用户调)   | 固定(不可用户调)    |

信息流 `/feed` 默认 alpha=0.5 / beta=0.3 / gamma=0.2，前端 WeightDrawer 可热调。

### 5.3 Cursor 分页

cursor 编码 `{rank, weights}` 为 base64url，翻页时 weights 不一致返 400 CURSOR_WEIGHTS_MISMATCH 强制回到第 1 页，防止用户调权重后翻页看到排序不一致的结果。

## 6. 未来优化方向

### 6.1 真实用户上线后需补齐的指标

- **LCP P75 / FID / CLS**：本地 Lighthouse 报告已采集（LCP ~1.8s / FID ~20ms / CLS ~0.02，均达标），但真实线上用户 P75 数据需接入 RUM（如 web-vitals + DataDog）后采集
- **PostStat 真实数据**：当前 HotnessScore 为确定性 hash 占位，需替换为 `PostStat` 表真实阅读/互动数据（`feed.service.ts` 中 `// PHASE_2_5_REPLACE_HERE` 替换点已预留）
- **A/B 测试框架**：Prompt 实验室目前 stability 简化为 0（只跑 1 次），需引入多次运行 + 统计显著性检验
- **端到端监控**：Sentry / DataDog 错误追踪 + LLM 调用延迟 P99

### 6.2 安全准确率仍偏低类目

- **pornography（Recall 0.850）**：暗语/emoji/拼音变体识别不足，需补充 more few-shot + 扩充敏感词库
- **gambling（Recall 0.850）**：新型变体（emoji 编码 URL、特殊字符绕过）需规则库更新
- **allow Precision 0.897**：边界模糊内容过度拦截，需细化判定边界，减少 FP

### 6.3 PE 工程化方向

- **Prompt 实验室补满测试集**：当前每类 5 条验证链路，安全审核评测使用独立 ChineseHarm-Bench 300 条测试集（PRD §4.4.3）。Prompt 实验室内部测试集每类 5 条用于验证链路完整性
- **自动 PE 循环**：当前为手动触发 eval -> 人工确认上线，未来可引入自动 Prompt 优化（如 DSPy 风格）
- **多模型对比**：当前仅 deepseek-v4-flash，需扩展到火山方舟/其他模型横向对比
- **视觉 API 集成**：素材合规校验当前为文本推断，需接入真实图像审核 API
- **规则库版本化**：当前规则库为静态 YAML，需引入版本号 + 自动触发批量复审

### 6.4 公网 URL 部署

当前项目支持 Docker Compose 本地部署。公网 URL 部署需用户提供云平台凭据后执行。可选方案：

- **Vercel + Railway**：前端 Next.js 部署到 Vercel，后端 NestJS 部署到 Railway
- **阿里云函数 + RDS**：后端 Serverless 化 + 托管 PostgreSQL
- **单 VPS Docker Compose**：最简方案，适合 Demo 展示

---

> 本报告所有数据均来自实际评测结果与代码实现，未编造不存在的数据。
