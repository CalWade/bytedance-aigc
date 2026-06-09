import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DraftToolType, Prisma } from "@prisma/client";
import pLimit from "p-limit";

import { LlmClient } from "../../llm/llm.client";
import { PrismaService } from "../../prisma/prisma.service";
import { PromptsService } from "../../prompts/prompts.service";

@Injectable()
export class PromptLabService {
  private readonly logger = new Logger(PromptLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prompts: PromptsService,
    private readonly llm: LlmClient,
  ) {}

  /** 增加单条测试用例 */
  async addTestCase(tool: DraftToolType, input: string, expected: string, category?: string) {
    return this.prisma.promptTestCase.create({
      data: { tool, input, expected, category },
    });
  }

  /** 列测试用例 */
  async listTestCases(tool?: DraftToolType, limit = 50, offset = 0) {
    return this.prisma.promptTestCase.findMany({
      where: tool ? { tool } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  /** 批量评估:拉该 tool 的所有测试用例,用候选 prompt 逐条调 LLM,计算 accuracy */
  async runEval(tool: DraftToolType, candidatePromptId: string) {
    const [candidate, testCases] = await Promise.all([
      this.prisma.prompt.findUnique({ where: { id: candidatePromptId } }),
      this.prisma.promptTestCase.findMany({ where: { tool } }),
    ]);

    if (!candidate) {
      throw new NotFoundException(`Prompt ${candidatePromptId} not found`);
    }
    if (testCases.length === 0) {
      throw new BadRequestException(`No test cases for tool ${tool}`);
    }

    const evalRun = await this.prisma.promptEvalRun.create({
      data: {
        tool,
        promptId: candidatePromptId,
        totalCases: testCases.length,
        status: "RUNNING",
      },
    });

    try {
      const limit = pLimit(2);
      let matchCount = 0;

      const tasks = testCases.map((tc) =>
        limit(async () => {
          const messages = [
            { role: "system" as const, content: candidate.systemPrompt },
            { role: "user" as const, content: tc.input },
          ];

          let raw = "";
          try {
            raw = await this.llm.chat(messages, { temperature: 0.0 });
          } catch {
            this.logger.warn(`runEval: LLM call failed for testCase ${tc.id}`);
            return false;
          }

          const predicted = this.extractSeverity(raw);
          return predicted === tc.expected;
        }),
      );

      const results = await Promise.all(tasks);
      matchCount = results.filter(Boolean).length;

      const accuracy = matchCount / testCases.length;

      await this.prisma.promptEvalRun.update({
        where: { id: evalRun.id },
        data: {
          accuracy,
          stability: 0, // 本期简化:只跑 1 次,stability=0
          totalCases: testCases.length,
          status: "DONE",
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `runEval: tool=${tool} promptId=${candidatePromptId} accuracy=${accuracy}(${matchCount}/${testCases.length})`,
      );

      return this.prisma.promptEvalRun.findUnique({ where: { id: evalRun.id } });
    } catch (err) {
      await this.prisma.promptEvalRun.update({
        where: { id: evalRun.id },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      throw err;
    }
  }

  /** 列评估运行历史 */
  async listEvalRuns(tool?: DraftToolType, limit = 20) {
    return this.prisma.promptEvalRun.findMany({
      where: tool ? { tool } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { prompt: { select: { id: true, name: true, tool: true } } },
    });
  }

  /** 版本对比:拉该 evalRun,对比当前线上 prompt 与上一版指标 */
  async compareWithCurrent(evalRunId: string) {
    const evalRun = await this.prisma.promptEvalRun.findUnique({
      where: { id: evalRunId },
    });
    if (!evalRun) {
      throw new NotFoundException(`EvalRun ${evalRunId} not found`);
    }

    // 当前线上 prompt:PLATFORM + isStarter=true
    const current = await this.prisma.prompt.findFirst({
      where: { owner: "PLATFORM", tool: evalRun.tool, isStarter: true },
    });

    // 上一版:该 tool 最近一个 DONE 状态 evalRun(不含当前)
    const previous = await this.prisma.promptEvalRun.findFirst({
      where: {
        tool: evalRun.tool,
        status: "DONE",
        id: { not: evalRunId },
      },
      orderBy: { startedAt: "desc" },
    });

    const previousAccuracy = previous?.accuracy ?? 0;
    const accuracyDelta = evalRun.accuracy - previousAccuracy;

    return {
      candidate: {
        id: evalRun.id,
        promptId: evalRun.promptId,
        accuracy: evalRun.accuracy,
        totalCases: evalRun.totalCases,
      },
      current: current ? { id: current.id, name: current.name } : null,
      previous: previous
        ? { id: previous.id, promptId: previous.promptId, accuracy: previous.accuracy }
        : null,
      accuracyDelta,
      canPromote: accuracyDelta >= 0,
    };
  }

  /** 一键上线:检查 canPromote,把候选 prompt 内容写入当前线上 prompt */
  async promoteToLive(evalRunId: string, operatedBy: string, note?: string) {
    const comparison = await this.compareWithCurrent(evalRunId);
    if (!comparison.canPromote) {
      throw new BadRequestException({
        code: "ACCURACY_REGRESSION",
        message: `准确率回退(Δ=${comparison.accuracyDelta.toFixed(4)}),不允许上线`,
      });
    }

    const evalRun = await this.prisma.promptEvalRun.findUnique({
      where: { id: evalRunId },
    });
    if (!evalRun) {
      throw new NotFoundException(`EvalRun ${evalRunId} not found`);
    }

    const candidate = await this.prisma.prompt.findUnique({
      where: { id: evalRun.promptId },
    });
    if (!candidate) {
      throw new NotFoundException(`Candidate prompt ${evalRun.promptId} not found`);
    }

    // 当前线上 prompt
    const current = await this.prisma.prompt.findFirst({
      where: { owner: "PLATFORM", tool: evalRun.tool, isStarter: true },
    });
    if (!current) {
      throw new NotFoundException(`No live prompt for tool ${evalRun.tool}`);
    }

    // 把候选 prompt 内容写入当前线上 prompt
    await this.prisma.prompt.update({
      where: { id: current.id },
      data: {
        systemPrompt: candidate.systemPrompt,
        params: candidate.params as Prisma.InputJsonValue,
        fewShots: candidate.fewShots as unknown as Prisma.InputJsonValue,
        designNote: candidate.designNote,
      },
    });

    // 记录 action
    const action = await this.prisma.promptLabAction.create({
      data: {
        tool: evalRun.tool,
        action: "promote",
        fromPromptId: current.id,
        toPromptId: candidate.id,
        evalRunId: evalRun.id,
        note,
        operatedBy,
      },
    });

    this.logger.log(
      `promoteToLive: tool=${evalRun.tool} from=${current.id} to=${candidate.id} by=${operatedBy}`,
    );

    return action;
  }

  /** 一键回滚:找最近一次 promote action,把 fromPrompt 内容写回当前线上 prompt */
  async rollback(tool: DraftToolType, operatedBy: string, note?: string) {
    // 找最近一次 promote action
    const lastPromote = await this.prisma.promptLabAction.findFirst({
      where: { tool, action: "promote" },
      orderBy: { createdAt: "desc" },
    });

    if (!lastPromote || !lastPromote.fromPromptId) {
      throw new BadRequestException({
        code: "NO_PROMOTE_HISTORY",
        message: `没有 ${tool} 的上线历史,无法回滚`,
      });
    }

    // 当前线上 prompt
    const current = await this.prisma.prompt.findFirst({
      where: { owner: "PLATFORM", tool, isStarter: true },
    });
    if (!current) {
      throw new NotFoundException(`No live prompt for tool ${tool}`);
    }

    // fromPrompt:上线前的版本(回滚目标)
    const fromPrompt = await this.prisma.prompt.findUnique({
      where: { id: lastPromote.fromPromptId },
    });
    if (!fromPrompt) {
      throw new NotFoundException(`Rollback target prompt ${lastPromote.fromPromptId} not found`);
    }

    // 把 fromPrompt 内容写回当前线上 prompt
    await this.prisma.prompt.update({
      where: { id: current.id },
      data: {
        systemPrompt: fromPrompt.systemPrompt,
        params: fromPrompt.params as Prisma.InputJsonValue,
        fewShots: fromPrompt.fewShots as unknown as Prisma.InputJsonValue,
        designNote: fromPrompt.designNote,
      },
    });

    // 记录 action
    const action = await this.prisma.promptLabAction.create({
      data: {
        tool,
        action: "rollback",
        fromPromptId: current.id,
        toPromptId: fromPrompt.id,
        note,
        operatedBy,
      },
    });

    this.logger.log(
      `rollback: tool=${tool} from=${current.id} to=${fromPrompt.id} by=${operatedBy}`,
    );

    return action;
  }

  /** 从 LLM 原始输出中提取 severity 级别(low/medium/high) */
  private extractSeverity(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as { dimensions?: { severity?: string }[] };
      if (Array.isArray(parsed.dimensions)) {
        const severities = parsed.dimensions
          .map((d) => d.severity)
          .filter((s): s is string => typeof s === "string");
        if (severities.some((s) => s === "high")) return "high";
        if (severities.some((s) => s === "medium")) return "medium";
        return "low";
      }
    } catch {
      // 非 JSON,尝试文本匹配
    }
    if (/high/i.test(raw)) return "high";
    if (/medium/i.test(raw)) return "medium";
    return "low";
  }
}
