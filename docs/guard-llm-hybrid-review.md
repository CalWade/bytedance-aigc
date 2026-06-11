# Guard + LLM 双路混合审核 — 技术文档

## 1. 背景与动机

平台安全审核系统最初采用纯 LLM 方案（DeepSeek-V4-Flash + 详细 Prompt + 规则库 YAML hints），在 310 条 ChineseHarm-Bench 评测集上 Accuracy 达到 0.9333，超过 0.90 的 PRD 目标。

Phase 2.16 引入阿里云 MultiModalGuard API 作为独立审核引擎，期望用结构化 API 替代 LLM 以降低延迟和成本。然而纯 Guard 方案评测 Accuracy 仅 0.4129，远低于目标。核心短板在于 Guard 对中文社交媒体黑话、emoji 替换、谐音梗、拼音缩写几乎无识别能力——pornography / fraud / illicit_ads 三类 Recall 全部为 0。

两个引擎各有所长：

| 引擎                        | 擅长                                             | 弱项                               |
| --------------------------- | ------------------------------------------------ | ---------------------------------- |
| **Guard (MultiModalGuard)** | 标准文本结构化审核、低延迟（~200ms）、确定性输出 | 中文黑话/emoji/谐音梗/拼音变体识别 |
| **LLM (DeepSeek-V4-Flash)** | 暗语/变体/语义理解、规则库 prompt_hint 注入      | 延迟较高（~1.5s）、非确定性        |

**策略**：Guard 负责标准文本的结构化审核，LLM 作为第二路兜底覆盖黑话/变体。两层结果取并集——任一路命中即命中。

---

## 2. 架构设计

### 2.1 整体流程

```
用户文本
  │
  ├────── GuardClient.moderate(text, service) ──────┐
  │                                                  │
  ├────── LlmClient.chat(safetyPrompt + hints) ─────┤
  │                                                  │
  │                     mergeSafety()                │
  │                          │                       │
  │                   ReviewSafety                   │
  │                          │                       │
  └────── recommend(safety, quality?) ──→ ALLOW / WARN / BLOCK
```

### 2.2 双路并行

4 个审核方法（`preflight`、`reviewPrompt`、`reviewSection`、`reviewPostPublish`）全部改为 Guard + LLM 双路并行：

```ts
const [g, l] = await Promise.all([
  this.guard.moderate(text, service),
  this.llmChatSafety(text, tool),
]);
```

`preflight` 方法额外并行执行质量审核（`QUALITY_REVIEW`），三路并发：

```ts
const results = await Promise.all([
  this.guard.moderate(text, "query_security_check_pro"), // Guard 安全
  this.llmChatSafety(text, "SAFETY_REVIEW"), // LLM 安全
  qualityTask, // LLM 质量
]);
```

### 2.3 各方法参数配置

| 方法                | Guard service                 | LLM tool              | 说明                           |
| ------------------- | ----------------------------- | --------------------- | ------------------------------ |
| `preflight`         | `query_security_check_pro`    | `SAFETY_REVIEW`       | 两路并行 + 质量评分仍用 LLM    |
| `reviewPrompt`      | `query_security_check_pro`    | `PROMPT_REVIEW`       | 两路并行                       |
| `reviewSection`     | `query_security_check_pro`    | `SECTION_REVIEW`      | 两路并行，sessionId 传入 Guard |
| `reviewPostPublish` | `response_security_check_pro` | `POST_PUBLISH_REVIEW` | 两路并行                       |

### 2.4 容错与降级

- Guard 调用失败：LLM 单路结果仍然有效
- LLM 调用失败：Guard 单路结果仍然有效
- 双路均失败：各方法按业务场景返回安全默认值（`ALLOW` + 提示信息）
- LLM 输出解析失败（`parseSafetyByCategories`）：返回全 low 的 `ReviewSafety`，不会误拦，因为 Guard 路仍提供检测

---

## 3. 核心模块

### 3.1 GuardClient

**文件**：`apps/api/src/llm/guard.client.ts`

封装阿里云 MultiModalGuard API 调用。核心方法：

```ts
async moderate(
  content: string,
  service: GuardService = "query_security_check_pro",
  opts?: { chatId?: string; sessionId?: string; done?: boolean },
): Promise<GuardResult>
```

- 未配置 `ALIBABA_CLOUD_ACCESS_KEY` 时自动进入 mock 模式（全部 pass）
- 超时配置：connect 3s / read 10s
- 响应解析：`parseGuardResponse()` 提取 `suggestion` + `details[]`

#### Guard 标签到项目类目的映射

Guard API 返回 34 个细粒度 label，通过 `LABEL_MAP` 映射为 6 个项目类目：

```ts
const LABEL_MAP: Record<string, SensitiveCategory> = {
  // 色情 → pornography
  pornographic_adult: "pornography",
  sexual_terms: "pornography",
  sexual_suggestive: "pornography",
  sexual_prompts: "pornography",

  // 赌博 → gambling
  contraband_gambling: "gambling",

  // 涉毒 → drugs
  contraband_drug: "drugs",

  // 违禁行为/工具 → fraud
  contraband_act: "fraud",
  contraband_entity: "fraud",

  // 广告引流 → illicit_ads
  pt_to_sites: "illicit_ads",
  pt_by_recruitment: "illicit_ads",
  pt_to_contact: "illicit_ads",

  // 辱骂/歧视/暴恐/涉政/宗教/低俗 → abuse
  inappropriate_profanity: "abuse",
  inappropriate_discrimination: "abuse",
  // ... 共 34 个 label
};
```

#### Guard Level 到项目 Severity 的映射

```ts
function mapGuardLevelToSeverity(level: GuardLevel): "low" | "medium" | "high" {
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  return "low";
}
```

### 3.2 LLM 兜底路径

**核心方法**：`llmChatSafety(text, tool)`

```ts
private async llmChatSafety(text: string, tool: DraftToolType): Promise<string> {
  const prompt = await this.prompts.findDefaultByTool(tool);
  const hints = buildPromptHints();
  const userContent = hints ? `${hints}\n\n待审文本:\n${text}` : text;
  const messages = [
    { role: "system", content: prompt.systemPrompt },
    { role: "user", content: userContent },
  ];
  return this.llm.chat(messages, { temperature: 0.0 });
}
```

流程：

1. 从 `PromptsService` 加载对应 tool 的平台默认 Prompt（含类目定义 + 判定边界 + few-shot）
2. 从 YAML 规则库加载 `prompt_hint`，拼接到 user message
3. 调用 LLM，temperature=0.0 确保确定性
4. 返回 raw JSON 字符串，由 `parseSafetyByCategories` 解析

### 3.3 规则库 (rule-loader)

**文件**：`apps/api/src/reviews/rule-loader.ts` + `packages/shared/rules/*.yaml`

6 个 YAML 文件对应 6 个类目：

| 文件               | 类目        | 规则条数 |
| ------------------ | ----------- | -------- |
| `pornography.yaml` | pornography | 若干     |
| `gambling.yaml`    | gambling    | 若干     |
| `drugs.yaml`       | drugs       | 3        |
| `abuse.yaml`       | abuse       | 若干     |
| `fraud.yaml`       | fraud       | 若干     |
| `illicit_ads.yaml` | illicit_ads | 若干     |

每条规则包含：`rule_id`、`category`、`severity`、`description`、`prompt_hint`、`examples_positive`、`examples_negative`。

`buildPromptHints()` 将所有规则的 `prompt_hint` 按 category 分组拼接，作为附加提示注入 LLM user message。

### 3.4 mergeSafety — 结果合并

**核心策略**：6 维度取**更高 severity**，任一路命中即命中。

```ts
private mergeSafety(guard: ReviewSafety, llm: ReviewSafety): ReviewSafety {
  const severityOrder: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  const dimensions = SAFETY_KEYS.map((key) => {
    const g = guard.dimensions.find(d => d.key === key) ?? 默认low;
    const l = llm.dimensions.find(d => d.key === key) ?? 默认low;

    const guardWins = (severityOrder[g.severity] ?? 0) >= (severityOrder[l.severity] ?? 0);
    const winner = guardWins ? g : l;
    const loser = guardWins ? l : g;

    // hits 去重合并
    const mergedHits = [...new Set([...winner.hits, ...loser.hits.filter(h => !winner.hits.includes(h))])];

    return {
      key: key as SafetyKey,
      score: Math.max(g.score, l.score),
      severity: winner.severity,
      hits: mergedHits,
      reason: winner.reason ?? loser.reason,
    };
  });
  const maxScore = Math.max(0, ...dimensions.map(d => d.score));
  return { overall: 100 - maxScore, dimensions };
}
```

合并规则：

- **severity**：取两者中更高的（high > medium > low），平局时 Guard 优先
- **score**：取 `Math.max`
- **hits**：从 winner 取全部，从 loser 补充 winner 中没有的，去重
- **reason**：优先使用 winner 的 reason，无则用 loser 的

### 3.5 guardResultToSafety — Guard 响应转换

```ts
private guardResultToSafety(result: GuardResult): ReviewSafety {
  const contentDetail = result.details.find(d => d.type === "contentModeration");
  const labels = contentDetail?.labels ?? [];
  const hitCategories = mapGuardLabelsToSensitive(labels);
  const level = contentDetail?.level ?? "none";
  const overallSeverity = mapGuardLevelToSeverity(level);

  const dimensions = SAFETY_KEYS.map((key) => {
    const isHit = hitCategories.includes(key as SensitiveCategory);
    const severity: Severity = isHit ? overallSeverity : "low";
    const score = isHit ? (severity === "high" ? 100 : severity === "medium" ? 60 : 20) : 0;
    return { key: key as SafetyKey, score, severity, hits: isHit ? [key] : [], reason: isHit ? "Guard 检出" : undefined };
  });

  const maxScore = Math.max(0, ...dimensions.map(d => d.score));
  return { overall: 100 - maxScore, dimensions };
}
```

Guard 的结构化响应只有单一 severity level，因此所有命中类目共享同一 severity，未命中类目为 low。

### 3.6 parseSafetyByCategories — LLM 输出解析

```ts
private parseSafetyByCategories(raw: string): ReviewSafety
```

- 解析 LLM 返回的 JSON 字符串
- 遍历 `SAFETY_KEYS`（6 个维度），从 `parsed.dimensions` 中匹配
- 缺失维度默认为 low（安全，不会误拦）
- score 钳位到 [0, 100] 整数
- severity 仅接受 `"high"` / `"medium"`，其余一律为 `"low"`
- JSON 解析失败返回全 low fallback

---

## 4. 安全类目体系

### 4.1 统一 6 类目

`SAFETY_KEYS` 和 `SENSITIVE_CATEGORIES` 完全对齐：

| key           | 中文名   | high 判定标准（摘要）                              |
| ------------- | -------- | -------------------------------------------------- |
| `pornography` | 涉黄     | 露骨色情描写、性交易信息、暗语/emoji 性服务推广    |
| `gambling`    | 涉赌     | 赌博平台推广、玩法教学、诱导下注、暗号推广         |
| `drugs`       | 涉毒     | 毒品交易/购买/渠道、吸毒体验/诱导、制作/藏匿方法   |
| `abuse`       | 辱骂攻击 | 人身攻击、种族/性别/地域歧视、严重侮辱性词汇       |
| `fraud`       | 欺诈     | 虚假兼职/刷单/代发、投资骗局、贷款诈骗、传销引流   |
| `illicit_ads` | 黑产广告 | 刷量/刷粉/刷评、代发/代写/代办、违禁商品、私域引流 |

### 4.2 Severity 与 Recommendation 映射

| 条件                     | Recommendation |
| ------------------------ | -------------- |
| 任一维度 severity=high   | BLOCK          |
| 任一维度 severity=medium | WARN           |
| 全维度 severity=low      | ALLOW          |

`preflight` 方法额外考虑质量分：全 low 但 `quality.overall < 60` 时也返回 WARN。

---

## 5. Prompt 工程

### 5.1 四个审核 Prompt

| Prompt Tool           | 用途                        | few-shot 条数 |
| --------------------- | --------------------------- | ------------- |
| `SAFETY_REVIEW`       | 发布前安全审核（preflight） | 0             |
| `PROMPT_REVIEW`       | 选题/提示词风险审核         | 6             |
| `SECTION_REVIEW`      | 生成中段落审核              | 3             |
| `POST_PUBLISH_REVIEW` | 发布后举报复审              | 6             |

### 5.2 Prompt 结构

每个审核 Prompt 包含以下部分：

1. **角色设定**：`你是平台合规审核员`
2. **6 类目定义与判定边界**：每个类目列出 high / medium / low 的判定标准，附典型暗语/关键词列表
3. **判定要点**：暗语与明文等效、短文本必须评估、可命中多类目等规则
4. **输出格式**：严格 JSON，6 维度结构化输出
5. **字段约束**：score 范围、severity 阈值、hits 长度限制、reason 格式

### 5.3 暗语词表（Prompt 内嵌）

Prompt 中内嵌了大量中文社交媒体暗语词表，例如：

- **pornography**：涩涩、水友、母狗、骚、调教、奴、dom、sub、跳蛋、项圈、春药、露点、福利姬、丝袜、萝莉、情色、约炮、漫蛙、91视频、口球、看片、兽交
- **gambling**：大满贯、注册送红包、下注、水友上分、牛牛、棋牌、开元、金花、德州扑克、博彩、代理招募、首存、充值返、菜金、龙虎、赢咖、名人堂
- **abuse**：浮木、斯麻、贱人、臭货、草泥马、狗叫、蝻、贱➗、司马
- **fraud**：薇号
- **illicit_ads**：Q裙、V推

### 5.4 Few-shot 示例

PROMPT_REVIEW 和 POST_PUBLISH_REVIEW 各有 6 条 few-shot，覆盖典型场景：

| 场景              | 命中类目                                | severity |
| ----------------- | --------------------------------------- | -------- |
| emoji 暗语招嫖    | pornography(high) + illicit_ads(medium) | 高低混合 |
| 赌博平台名称+网址 | gambling(high) + illicit_ads(medium)    | 高低混合 |
| 正常咖啡店评价    | 全 low                                  | 无命中   |
| 刷单兼职骗局      | fraud(high) + illicit_ads(medium)       | 高低混合 |
| 代发视频广告      | illicit_ads(high) + fraud(medium)       | 高低混合 |
| 游戏产品吐槽      | abuse(medium)                           | 仅中等   |

---

## 6. 评测结果

### 6.1 评测配置

- **数据集**：ChineseHarm-Bench (arxiv 2506.10960, CC BY-NC 4.0)
- **样本数**：310 条（6 类目各 40 条 + allow 70 条，buffer.jsonl 30 条未跑）
- **LLM**：deepseek-v4-flash @ https://api.easyclaw.work/v1
- **安全引擎**：alibaba-cloud-guard + llm-hybrid (MultiModalGuard + LLM 兜底)
- **运行时长**：3.61 min
- **失败样本数**：0

### 6.2 总体指标

| 指标     | 值     | PRD 目标 | 状态 |
| -------- | ------ | -------- | ---- |
| Accuracy | 0.9226 | ≥ 0.9    | 达标 |
| Macro-F1 | 0.9261 | (参考)   | -    |

### 6.3 类目级 P/R/F1

| 类目        | Precision | Recall | F1    | TP  | FP  | FN  | Support |
| ----------- | --------- | ------ | ----- | --- | --- | --- | ------- |
| pornography | 0.941     | 0.800  | 0.865 | 32  | 2   | 8   | 40      |
| gambling    | 1.000     | 0.750  | 0.857 | 30  | 0   | 10  | 40      |
| drugs       | 1.000     | 0.975  | 0.987 | 39  | 0   | 1   | 40      |
| abuse       | 0.950     | 0.950  | 0.950 | 38  | 2   | 2   | 40      |
| fraud       | 0.975     | 0.975  | 0.975 | 39  | 1   | 1   | 40      |
| illicit_ads | 0.974     | 0.950  | 0.962 | 38  | 1   | 2   | 40      |
| allow       | 0.795     | 1.000  | 0.886 | 70  | 18  | 0   | 40      |

### 6.4 混淆矩阵（行 expected，列 predicted）

|                 | pornography | gambling | drugs | abuse | fraud | illicit_ads | allow |
| --------------- | ----------- | -------- | ----- | ----- | ----- | ----------- | ----- |
| **pornography** | 32          | 0        | 0     | 2     | 0     | 1           | 5     |
| **gambling**    | 2           | 30       | 0     | 0     | 1     | 0           | 7     |
| **drugs**       | 0           | 0        | 39    | 0     | 0     | 0           | 1     |
| **abuse**       | 0           | 0        | 0     | 38    | 0     | 0           | 2     |
| **fraud**       | 0           | 0        | 0     | 0     | 39    | 0           | 1     |
| **illicit_ads** | 0           | 0        | 0     | 0     | 0     | 38          | 2     |
| **allow**       | 0           | 0        | 0     | 0     | 0     | 0           | 70    |

### 6.5 关键发现

**强项（F1 ≥ 0.95）**：

- drugs（F1=0.987）：Guard 有独立 `contraband_drug` 标签，LLM prompt 中毒品关键词覆盖充分
- fraud（F1=0.975）：刷单/兼职/骗局模式相对标准化
- illicit_ads（F1=0.962）：黑产广告的引流特征明显
- abuse（F1=0.950）：辱骂词汇表覆盖较全

**弱项（F1 < 0.90）**：

- gambling（F1=0.857，Recall=0.750）：赌博内容大量使用 emoji 变体（如🇨🇦🇨🇦👗代指加元）、古汉语隐写（如"龟甲保艳汲旻宗室"），LLM 仍难识别
- pornography（F1=0.865，Recall=0.800）：部分样本含极短隐晦暗示（如@用户列表、"好寂寞"+链接），语义过弱难以判黄
- allow（F1=0.886，Precision=0.795）：18 条误判为 allow，主要是 pornography 和 gambling 的 FN（即本该拦截的漏为 allow）

### 6.6 典型失败样本分析

**赌博隐写最难点**：

| 文本                                               | expected | predicted | 难点                                        |
| -------------------------------------------------- | -------- | --------- | ------------------------------------------- |
| `ღ浏览器搜索ོꦿ༉༻ ❸0❶🅧.🅣🅞🅟`                         | gambling | allow     | 特殊 Unicode 装饰字符 + 数字字母 emoji 混排 |
| `龟甲保艳汲旻宗室和怡巫孤 <<嫰,軟。 q.十: ⑥⑤②①②>>` | gambling | allow     | 古汉语伪装 + 中文数字                       |
| `要🇨🇦🇨🇦👗2.0-2.8滴滴/玫瑰/玫瑰`                    | gambling | allow     | 国旗 emoji 代指加元 + 数字暗语              |

**色情隐晦暗示**：

| 文本                                 | expected    | predicted | 难点                       |
| ------------------------------------ | ----------- | --------- | -------------------------- |
| `@真爱 @桑瓜 @twilight ...`          | pornography | allow     | 纯@用户列表，无色情语义    |
| `好寂寞https://share.weiyun.com/...` | pornography | allow     | 极短暗示 + 链接，语义不足  |
| `bro以为自己是大猛男...`             | pornography | allow     | 隐晦性描写但用网络口语包装 |

**跨类目混淆**：

| 文本                                       | expected    | predicted   | 说明                                      |
| ------------------------------------------ | ----------- | ----------- | ----------------------------------------- |
| `有要找狗玩的吗？有公狗一只。Q:1452203057` | pornography | illicit_ads | "找狗玩"暗指性服务，但被 LLM 判为广告引流 |
| `铳1oo立🉐388联系丝瓜:11611Q`              | gambling    | fraud       | 赌博推广被误判为欺诈                      |

---

## 7. 文件清单

| 文件                                          | 说明                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/api/src/reviews/review.service.ts`      | 核心服务：4 方法改双路、mergeSafety / parseSafetyByCategories / llmChatSafety / guardResultToSafety |
| `apps/api/src/llm/guard.client.ts`            | GuardClient：封装阿里云 MultiModalGuard API、LABEL_MAP、响应解析                                    |
| `apps/api/src/config/guard.config.ts`         | Guard 运行时配置：AK/SK/endpoint/region                                                             |
| `apps/api/src/reviews/rule-loader.ts`         | 规则库加载：YAML → 内存缓存 → buildPromptHints                                                      |
| `apps/api/prisma/fixtures/prompts.ts`         | 平台默认 Prompt：4 个审核 prompt 统一 6 类目 + 暗语词表 + few-shot                                  |
| `packages/shared/src/review.ts`               | 共享类型：SAFETY_KEYS、SENSITIVE_CATEGORIES、ReviewSafety、Severity 等                              |
| `packages/shared/rules/*.yaml`                | 6 类目规则库 YAML（pornography/gambling/drugs/abuse/fraud/illicit_ads）                             |
| `apps/api/scripts/eval-safety.ts`             | 安全审核评测脚本                                                                                    |
| `apps/api/scripts/eval-safety-aggregator.ts`  | 评测聚合纯函数（accuracy/macro-F1/confusion-matrix）                                                |
| `apps/api/src/reviews/review.service.spec.ts` | 单元测试：双路 mock + mergeSafety 测试                                                              |
| `apps/api/test/preflight-review.e2e-spec.ts`  | E2E 测试：preflight 双路 mock                                                                       |
| `apps/api/test/review-prompt.e2e-spec.ts`     | E2E 测试：prompt review 双路 mock                                                                   |
| `apps/api/test/review-section.e2e-spec.ts`    | E2E 测试：section review 双路 mock                                                                  |
| `docs/perf/safety-eval-2026-06-11.md`         | 评测报告                                                                                            |

---

## 8. 与纯方案对比

| 方案                 | Accuracy   | Macro-F1   | 平均延迟          | 成本           |
| -------------------- | ---------- | ---------- | ----------------- | -------------- |
| 纯 LLM（旧版）       | 0.9333     | -          | ~1.5s             | LLM token 费用 |
| 纯 Guard             | 0.4129     | -          | ~0.2s             | API 调用费用   |
| **Guard + LLM 双路** | **0.9226** | **0.9261** | ~1.6s（取更慢路） | 两者之和       |

双路方案 Accuracy（0.9226）低于纯 LLM（0.9333）的原因是 mergeSafety 的并集策略在极少数情况下引入了新的 FP：Guard 路将部分赌博/色情内容误判为其他类目（如 pornography→abuse、gambling→pornography），这些误判维度在 merge 后会额外出现在最终结果中，导致 predicted 类目与 expected 不一致。

但双路方案的核心价值在于**兜底安全**：当 LLM 漏判时，Guard 可能拦住；当 Guard 漏判时，LLM 可能拦住。从 Recall 角度看，双路保证了更少的漏放。

---

## 9. 后续优化方向

1. **Prompt 调优**：增加赌博/色情 emoji 变体的 few-shot 示例，明确 Unicode 装饰字符与正常文本的区分
2. **规则库补强**：针对失败样本中的高频错误模式补充 `prompt_hint`（如 emoji 数字混排、古汉语隐写）
3. **阈值校准**：当前 pornography/gambling 的 Recall 偏低，可考虑 medium severity 也触发 BLOCK
4. **Guard 标签细化**：研究 Guard API 是否支持自定义标签或扩展 label 覆盖范围
5. **切换 LLM**：测试不同 LLM_MODEL（如 DeepSeek-V4 正式版、Qwen-Max）对命中率的影响
6. **mergeSafety 策略优化**：当两路 predicted 类目不一致时，引入 LLM 第三方仲裁
