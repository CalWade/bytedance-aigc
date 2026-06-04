/* eslint-disable @typescript-eslint/unbound-method */
import { BadGatewayException, ForbiddenException } from "@nestjs/common";

import { LlmClient } from "../llm/llm.client";
import { DraftsService } from "./drafts.service";
import { OutlineService } from "./outline.service";

function makeOutlineService() {
  const drafts = { assertAuthor: jest.fn().mockResolvedValue({}) } as unknown as DraftsService;
  const llm = { chat: jest.fn() } as unknown as LlmClient;
  const svc = new OutlineService(drafts, llm);
  return { svc, drafts, llm };
}

describe("OutlineService", () => {
  it("happy path:LLM 返合法 JSON 解析为 OutlineItem[]", async () => {
    const { svc, llm, drafts } = makeOutlineService();
    (llm.chat as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          { heading: "引子", summary: "背景介绍" },
          { heading: "现状", summary: "数据与现象", hint: "用图表" },
          { heading: "结论", summary: "总结观点" },
        ],
      }),
    );

    const out = await svc.generate("draft-1", "user-1", { topic: "AI 编辑器" });

    expect(out.sections).toHaveLength(3);
    expect(out.sections[0]).toEqual({ heading: "引子", summary: "背景介绍", hint: undefined });
    expect(out.sections[1].hint).toBe("用图表");
    expect(drafts.assertAuthor).toHaveBeenCalledWith("draft-1", "user-1");
  });

  it("LLM 返非法 JSON → BadGatewayException", async () => {
    const { svc, llm } = makeOutlineService();
    (llm.chat as jest.Mock).mockResolvedValueOnce("this is not json");

    await expect(svc.generate("d", "u", { topic: "x" })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it("LLM 返 sections 长度 < 3 → BadGatewayException", async () => {
    const { svc, llm } = makeOutlineService();
    (llm.chat as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ sections: [{ heading: "h1", summary: "s1" }] }),
    );

    await expect(svc.generate("d", "u", { topic: "x" })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it("LLM 返 sections 长度 > 8 → BadGatewayException", async () => {
    const { svc, llm } = makeOutlineService();
    (llm.chat as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        sections: Array.from({ length: 9 }, (_, i) => ({
          heading: `h${i}`,
          summary: `s${i}`,
        })),
      }),
    );

    await expect(svc.generate("d", "u", { topic: "x" })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it("assertAuthor 失败(403)抛 Forbidden,不调用 LLM", async () => {
    const { svc, drafts, llm } = makeOutlineService();
    (drafts.assertAuthor as jest.Mock).mockRejectedValueOnce(new ForbiddenException("not author"));

    await expect(svc.generate("d", "u", { topic: "x" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
