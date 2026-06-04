import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prompt } from "@prisma/client";

import { LlmClient } from "../llm/llm.client";
import { PromptsService } from "../prompts/prompts.service";
import { DraftsService } from "./drafts.service";
import { ToolsService } from "./tools.service";
import type { ToolInvokeDto } from "./dto/tool-invoke.dto";

function fakePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "p1",
    owner: "PLATFORM",
    authorId: null,
    tool: "REWRITE_FLUENT",
    name: "默认",
    systemPrompt: "你是编辑",
    params: { temperature: 0.4 },
    fewShots: [],
    designNote: null,
    isStarter: true,
    sourcePromptId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts?: {
  chatResolved?: string;
  defaultPrompt?: Prompt;
  ownedPrompt?: Prompt | (() => never);
}) {
  const drafts = { assertAuthor: jest.fn().mockResolvedValue({}) } as unknown as DraftsService;
  const llm = {
    chat: jest.fn().mockResolvedValue(opts?.chatResolved ?? "改写后的句子"),
  } as unknown as LlmClient;
  const prompts = {
    findDefaultByTool: jest.fn().mockResolvedValue(opts?.defaultPrompt ?? fakePrompt()),
    findOneOwnedOrPlatformForTool: jest.fn().mockImplementation(() => {
      const v = opts?.ownedPrompt;
      if (typeof v === "function") return Promise.reject((v as () => never)());
      return Promise.resolve(v ?? fakePrompt());
    }),
  } as unknown as PromptsService;
  const svc = new ToolsService(drafts, llm, prompts);
  return { svc, drafts, llm, prompts };
}

describe("ToolsService", () => {
  it.each([
    ["REWRITE_FLUENT", { selectedText: "原句" }],
    ["EXPAND", { selectedText: "原句" }],
    ["TRANSFORM_STYLE", { selectedText: "原句" }],
    ["REWRITE_OPENING", { selectedText: "原句" }],
    ["HEADLINE_SUB", { selectedText: "原句" }],
    ["HEADLINE_NEW", { fullText: "全文..." }],
    ["ADD_TOPIC", { fullText: "全文..." }],
    ["ADD_FACTS", { selectedText: "段落", fullText: "全文..." }],
  ])("%s 文本工具 happy → text 候选", async (tool, input) => {
    const { svc } = makeService({ chatResolved: "结果" });
    const dto: ToolInvokeDto = { tool: tool as ToolInvokeDto["tool"], input };
    const res = await svc.invoke("d1", "u1", dto);
    expect(res.candidates).toEqual([{ kind: "text", text: "结果" }]);
  });

  it("REWRITE_FLUENT 缺 selectedText → BadRequest", async () => {
    const { svc } = makeService();
    const dto: ToolInvokeDto = {
      tool: "REWRITE_FLUENT",
      input: { fullText: "wrong field" },
    };
    await expect(svc.invoke("d1", "u1", dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ADD_FACTS 只给 selectedText 缺 fullText → BadRequest", async () => {
    const { svc } = makeService();
    const dto: ToolInvokeDto = {
      tool: "ADD_FACTS",
      input: { selectedText: "段落" },
    };
    await expect(svc.invoke("d1", "u1", dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("promptId 指别人 PRIVATE → 透传 PromptsService 的 403", async () => {
    const { svc } = makeService({
      ownedPrompt: () => {
        throw new ForbiddenException("nope");
      },
    });
    const dto: ToolInvokeDto = {
      tool: "REWRITE_FLUENT",
      input: { selectedText: "x" },
      promptId: "other-prompt",
    };
    await expect(svc.invoke("d1", "u1", dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("无 promptId → 走 findDefaultByTool;有 promptId → 走 findOneOwnedOrPlatformForTool", async () => {
    const { svc, prompts } = makeService();
    await svc.invoke("d1", "u1", { tool: "EXPAND", input: { selectedText: "a" } });
    expect(prompts.findDefaultByTool).toHaveBeenCalledWith("EXPAND");

    (prompts.findDefaultByTool as jest.Mock).mockClear();
    await svc.invoke("d1", "u1", {
      tool: "EXPAND",
      input: { selectedText: "a" },
      promptId: "px",
    });
    expect(prompts.findDefaultByTool).not.toHaveBeenCalled();
    expect(prompts.findOneOwnedOrPlatformForTool).toHaveBeenCalledWith("px", "u1", "EXPAND");
  });

  it("IMAGE_SUGGEST happy(LLM 返合法 JSON 数组)→ image 候选", async () => {
    const { svc } = makeService({
      chatResolved: '[{"alt":"工程师专注工作","reason":"贴合远程办公话题"}]',
      defaultPrompt: fakePrompt({ tool: "IMAGE_SUGGEST" }),
    });
    const res = await svc.invoke("d1", "u1", {
      tool: "IMAGE_SUGGEST",
      input: { fullText: "讨论了远程办公的工具选型..." },
    });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toEqual({
      kind: "image",
      alt: "工程师专注工作",
      reason: "贴合远程办公话题",
    });
  });

  it("IMAGE_SUGGEST 自然语言降级(非 JSON)→ 拆行兜底", async () => {
    const { svc } = makeService({
      chatResolved: "1. 现代开放式办公区,工程师戴耳机\n2. 玻璃会议室便利贴特写",
      defaultPrompt: fakePrompt({ tool: "IMAGE_SUGGEST" }),
    });
    const res = await svc.invoke("d1", "u1", {
      tool: "IMAGE_SUGGEST",
      input: { fullText: "x" },
    });
    expect(res.candidates).toHaveLength(2);
    expect(res.candidates[0].kind).toBe("image");
    expect((res.candidates[0] as { alt: string }).alt).toMatch(/^现代开放式办公区/);
  });
});
