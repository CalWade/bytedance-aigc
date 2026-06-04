import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prompt } from "@prisma/client";
import type { Candidate, DraftToolType } from "@bytedance-aigc/shared";

import { LlmClient } from "../llm/llm.client";
import type { ChatMessage } from "../llm/dto/chat-message.dto";
import { PromptsService } from "../prompts/prompts.service";
import { DraftsService } from "./drafts.service";
import type { ToolInvokeDto } from "./dto/tool-invoke.dto";

const SELECTED_MIN = 1;
const SELECTED_MAX = 2000;
const FULL_MIN = 1;
const FULL_MAX = 50000;

interface NarrowedInput {
  selectedText?: string;
  fullText?: string;
}

/**
 * 9 种 AI 工具卡的统一入口。Plan Task 7 + spec §3.2。
 *
 * 错误层次:
 *   - DTO 外壳校验失败 → BadRequest(class-validator)
 *   - 内层 input 字段校验失败(本 service 入口 narrow) → BadRequest
 *   - draft 不存在 → 404,作者校验失败 → 403(DraftsService.assertAuthor)
 *   - prompt 不存在 → 404,prompt 越权 / 工具不匹配 → 403(PromptsService)
 *   - LLM 上游失败 → 502(默认 ExceptionFilter,Plan D6)
 */
@Injectable()
export class ToolsService {
  constructor(
    private readonly drafts: DraftsService,
    private readonly llm: LlmClient,
    private readonly prompts: PromptsService,
  ) {}

  async invoke(
    draftId: string,
    userSub: string,
    dto: ToolInvokeDto,
  ): Promise<{ candidates: Candidate[] }> {
    const narrowed = narrowInput(dto.tool, dto.input);
    await this.drafts.assertAuthor(draftId, userSub);

    const prompt = dto.promptId
      ? await this.prompts.findOneOwnedOrPlatformForTool(dto.promptId, userSub, dto.tool)
      : await this.prompts.findDefaultByTool(dto.tool);

    const messages = buildMessages(dto.tool, prompt, narrowed);
    const temperature = readTemperature(prompt);
    const raw = await this.llm.chat(messages, { temperature });

    return { candidates: toCandidates(dto.tool, raw) };
  }
}

/* ---------- narrow ---------- */

function narrowInput(tool: DraftToolType, input: Record<string, unknown>): NarrowedInput {
  switch (tool) {
    case "REWRITE_FLUENT":
    case "EXPAND":
    case "TRANSFORM_STYLE":
    case "REWRITE_OPENING":
    case "HEADLINE_SUB":
      return { selectedText: assertSelected(input) };
    case "HEADLINE_NEW":
    case "ADD_TOPIC":
    case "IMAGE_SUGGEST":
      return { fullText: assertFull(input) };
    case "ADD_FACTS":
      return {
        selectedText: assertSelected(input),
        fullText: assertFull(input),
      };
    default: {
      // exhaustive guard
      const _never: never = tool;
      throw new BadRequestException(`Unsupported tool: ${String(_never)}`);
    }
  }
}

function assertSelected(input: Record<string, unknown>): string {
  const v = input.selectedText;
  if (typeof v !== "string" || v.length < SELECTED_MIN || v.length > SELECTED_MAX) {
    throw new BadRequestException(
      `selectedText must be string of length ${SELECTED_MIN}-${SELECTED_MAX}`,
    );
  }
  return v;
}

function assertFull(input: Record<string, unknown>): string {
  const v = input.fullText;
  if (typeof v !== "string" || v.length < FULL_MIN || v.length > FULL_MAX) {
    throw new BadRequestException(`fullText must be string of length ${FULL_MIN}-${FULL_MAX}`);
  }
  return v;
}

/* ---------- prompt → messages ---------- */

function buildMessages(tool: DraftToolType, prompt: Prompt, input: NarrowedInput): ChatMessage[] {
  let userContent: string;
  if (tool === "ADD_FACTS") {
    userContent = `[选中段落]\n${input.selectedText ?? ""}\n\n[全文上下文]\n${input.fullText ?? ""}`;
  } else if (input.selectedText !== undefined) {
    userContent = input.selectedText;
  } else {
    userContent = input.fullText ?? "";
  }

  const system =
    tool === "IMAGE_SUGGEST"
      ? `${prompt.systemPrompt}\n\n严格用 JSON 输出,形如 [{"alt":"...","reason":"..."}],不要 markdown 包裹,不要解释。`
      : prompt.systemPrompt;

  return [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
}

function readTemperature(prompt: Prompt): number | undefined {
  const params = prompt.params as unknown;
  if (typeof params === "object" && params !== null) {
    const t = (params as Record<string, unknown>).temperature;
    if (typeof t === "number") return t;
  }
  return undefined;
}

/* ---------- raw → candidates ---------- */

function toCandidates(tool: DraftToolType, raw: string): Candidate[] {
  if (tool === "IMAGE_SUGGEST") {
    return parseImageCandidates(raw);
  }
  return [{ kind: "text", text: raw.trim() }];
}

function parseImageCandidates(raw: string): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 容错:LLM 偶发输出 `1. xxx\n2. xxx` 自然语言,降级把每行当 alt
    return raw
      .split("\n")
      .map((l) => l.replace(/^\s*\d+[\.\)、]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 4)
      .map((alt): Candidate => ({ kind: "image", alt, reason: "LLM 自然语言降级解析" }));
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException("IMAGE_SUGGEST LLM 输出不是数组");
  }
  return parsed
    .filter(
      (it): it is { alt: string; reason: string } =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as { alt?: unknown }).alt === "string" &&
        typeof (it as { reason?: unknown }).reason === "string",
    )
    .map((it): Candidate => ({ kind: "image", alt: it.alt, reason: it.reason }));
}
