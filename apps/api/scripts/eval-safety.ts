/**
 * Phase 2.16 — 安全审核准确率评估脚本
 *
 * 用法:pnpm --filter @bytedance-aigc/api eval:safety
 * 产物:docs/perf/safety-eval-YYYY-MM-DD.md
 * Exit code:Accuracy ≥ 0.90 → 0,否则 1
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import pLimit from "p-limit";

import { SENSITIVE_CATEGORIES, type SensitiveCategory } from "@bytedance-aigc/shared";
import { AppModule } from "../src/app.module";
import { ReviewService } from "../src/reviews/review.service";

import { aggregate, ALL_LABELS, type Label, type SampleResult } from "./eval-safety-aggregator";

interface FixtureRow {
  text: string;
  expected_recommendation: "ALLOW" | "WARN" | "BLOCK";
  expected_categories: SensitiveCategory[];
  source: string;
}

const CONCURRENCY = 5;
const RETRY_DELAYS_MS = [1000, 4000];
const ACCURACY_TARGET = 0.9;

async function main(): Promise<void> {
  const fixturesDir = join(__dirname, "..", "test", "fixtures", "safety-eval");
  const reportsDir = join(__dirname, "..", "..", "..", "docs", "perf");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const reviews = app.get(ReviewService);

  const samples: { row: FixtureRow; expected: Label }[] = [];
  for (const cat of SENSITIVE_CATEGORIES) {
    const rows = readJsonl<FixtureRow>(join(fixturesDir, `${cat}.jsonl`));
    rows.forEach((row) => samples.push({ row, expected: cat }));
  }
  const allowRows = readJsonl<FixtureRow>(join(fixturesDir, "allow.jsonl"));
  allowRows.forEach((row) => samples.push({ row, expected: "allow" }));

  console.log(
    `总样本:${samples.length} 条,并发 ${CONCURRENCY},预计耗时 ${Math.ceil((samples.length / CONCURRENCY) * 3)} s+`,
  );

  const t0 = Date.now();
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const results: SampleResult[] = await Promise.all(
    samples.map(({ row, expected }) =>
      limit(async () => {
        const r = await runWithRetry(() => reviews.reviewPostPublish(row.text));
        done++;
        if (done % 20 === 0) console.log(`  进度 ${done}/${samples.length}`);
        if (r.kind === "error") return { expected, predicted: undefined, error: r.message };
        const predicted: Label = r.value.hitCategories.includes(expected as SensitiveCategory)
          ? expected
          : (r.value.hitCategories[0] ?? "allow");
        return { expected, predicted };
      }),
    ),
  );
  const elapsedMs = Date.now() - t0;
  console.log(`  完成,耗时 ${(elapsedMs / 1000).toFixed(1)}s`);

  const agg = aggregate(results);

  const date = new Date().toISOString().slice(0, 10);
  const md = renderReport({
    date,
    samples,
    elapsedMs,
    agg,
    rawResults: results,
    llmModel: process.env.LLM_MODEL ?? "(unknown)",
    llmBaseUrl: process.env.LLM_BASE_URL ?? "(unknown)",
  });
  const out = join(reportsDir, `safety-eval-${date}.md`);
  writeFileSync(out, md, "utf8");
  console.log(`报告写入: ${out}`);

  console.log("\n=== 总体 ===");
  console.log(`Accuracy: ${agg.accuracy.toFixed(4)} (目标 ≥ ${ACCURACY_TARGET})`);
  console.log(`Macro-F1: ${agg.macroF1.toFixed(4)}`);
  console.log(`错误样本: ${agg.errors.length}`);

  await app.close();
  process.exit(agg.accuracy >= ACCURACY_TARGET ? 0 : 1);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
): Promise<{ kind: "ok"; value: T } | { kind: "error"; message: string }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const value = await fn();
      return { kind: "ok", value };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  return {
    kind: "error",
    message: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

interface RenderInput {
  date: string;
  samples: { row: FixtureRow; expected: Label }[];
  elapsedMs: number;
  agg: ReturnType<typeof aggregate>;
  rawResults: SampleResult[];
  llmModel: string;
  llmBaseUrl: string;
}

function renderReport(i: RenderInput): string {
  const { date, samples, elapsedMs, agg, rawResults, llmModel, llmBaseUrl } = i;
  const minutes = (elapsedMs / 60000).toFixed(2);
  const lines: string[] = [];
  lines.push(`# 安全审核评测报告 — ${date}`);
  lines.push("");
  lines.push("## 元数据");
  lines.push(`- 数据来源:ChineseHarm-Bench (arxiv 2506.10960, CC BY-NC 4.0)`);
  lines.push(`- 主测样本数:${samples.length}(buffer.jsonl 30 条未跑)`);
  lines.push(`- LLM:${llmModel} @ ${llmBaseUrl}`);
  lines.push(`- 运行时长:${minutes} min`);
  lines.push(`- 失败样本数:${agg.errors.length}(详见末尾)`);
  lines.push("");
  lines.push("## 总体指标");
  const status = agg.accuracy >= ACCURACY_TARGET ? "✅ 达标" : "⚠️ 不达标";
  lines.push(`| 指标 | 值 | PRD 目标 | 状态 |`);
  lines.push(`|------|-----|---------|------|`);
  lines.push(`| Accuracy | ${agg.accuracy.toFixed(4)} | ≥ ${ACCURACY_TARGET} | ${status} |`);
  lines.push(`| Macro-F1 | ${agg.macroF1.toFixed(4)} | (参考) | - |`);
  lines.push("");
  lines.push("## 类目级 P/R/F1");
  lines.push(`| 类目 | Precision | Recall | F1 | TP | FP | FN | Support |`);
  lines.push(`|------|-----------|--------|----|----|----|----|---------|`);
  for (const label of ALL_LABELS) {
    const c = agg.perCategory[label];
    lines.push(
      `| ${label} | ${c.precision.toFixed(3)} | ${c.recall.toFixed(3)} | ${c.f1.toFixed(3)} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.support} |`,
    );
  }
  lines.push("");
  lines.push("## 混淆矩阵(行 expected,列 predicted)");
  lines.push(`| | ${ALL_LABELS.join(" | ")} |`);
  lines.push(`|---|${ALL_LABELS.map(() => "---").join("|")}|`);
  for (const e of ALL_LABELS) {
    const row = ALL_LABELS.map((p) => agg.confusionMatrix[e][p]).join(" | ");
    lines.push(`| **${e}** | ${row} |`);
  }
  lines.push("");
  lines.push("## 失败样本(全部列出)");
  const wrongs: string[] = [];
  rawResults.forEach((r, idx) => {
    if (r.error || !r.predicted) return;
    if (r.expected !== r.predicted) {
      const text =
        samples[idx].row.text.slice(0, 80) + (samples[idx].row.text.length > 80 ? "…" : "");
      wrongs.push(
        `- expected=${r.expected} predicted=${r.predicted} text="${text}" source=${samples[idx].row.source}`,
      );
    }
  });
  if (wrongs.length === 0) lines.push("- (无失败样本)");
  else lines.push(...wrongs);
  lines.push("");
  lines.push("## 运行时错误(LLM 调用 / 解析失败)");
  if (agg.errors.length === 0) lines.push("- (无)");
  else
    agg.errors.forEach((e, idx) =>
      lines.push(`- #${idx + 1} expected=${e.expected} error=${e.error}`),
    );
  lines.push("");
  lines.push("## 结论");
  if (agg.accuracy >= ACCURACY_TARGET) {
    lines.push(`✅ 达标:Accuracy ${agg.accuracy.toFixed(4)} ≥ ${ACCURACY_TARGET}`);
  } else {
    lines.push(`⚠️ 不达标:Accuracy ${agg.accuracy.toFixed(4)} < ${ACCURACY_TARGET}`);
    lines.push("");
    lines.push("**后续优化方向**:");
    lines.push("- Prompt 调优:增加 few-shot 示例,明确各类目边界");
    lines.push("- 规则库补强:针对失败样本中的高频错误模式补 prompt_hint");
    lines.push("- 切换 LLM:测试不同 LLM_MODEL 的命中率");
    lines.push("- 阈值校准:medium severity 改 BLOCK / WARN 边界");
  }
  return lines.join("\n");
}

void main();
