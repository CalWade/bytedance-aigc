import { NotFoundException } from "@nestjs/common";
import { firstValueFrom, Observable, of } from "rxjs";
import { toArray } from "rxjs/operators";

import { LlmClient, ChatStreamFrame } from "../llm/llm.client";
import { PromptsService } from "../prompts/prompts.service";
import { SafeRewriteService } from "./safe-rewrite.service";

type Frame =
  | { event: "start"; idx: 0 | 1 }
  | { event: "token"; idx: 0 | 1; delta: string }
  | { event: "end"; idx: 0 | 1 }
  | { event: "done" }
  | { event: "error"; idx?: 0 | 1; message: string };

function makePrompt() {
  return {
    systemPrompt: "你是合规改写助手",
    params: {},
    fewShots: [],
  };
}

function streamOf(...frames: ChatStreamFrame[]): Observable<ChatStreamFrame> {
  return of(...frames);
}

function makeService(streams: Observable<ChatStreamFrame>[]) {
  const prompts = {
    findDefaultByTool: jest.fn().mockResolvedValue(makePrompt()),
  } as unknown as PromptsService;
  const chatStream = jest.fn();
  for (const s of streams) {
    chatStream.mockReturnValueOnce(s);
  }
  const llm = { chatStream } as unknown as LlmClient;
  return { service: new SafeRewriteService(llm, prompts), prompts, llm, chatStream };
}

const INPUT = {
  draftId: "d1",
  text: "原文内容",
  hitCategories: ["politics" as const],
  message: "命中政治敏感",
};

describe("SafeRewriteService.stream", () => {
  it("两路并发产出 token,首发 start×2,各路 end,最后 done", async () => {
    const { service } = makeService([
      streamOf({ delta: "甲A" }, { delta: "甲B" }, { done: true }),
      streamOf({ delta: "乙A" }, { delta: "乙B" }, { done: true }),
    ]);

    const frames = (await firstValueFrom(service.stream(INPUT).pipe(toArray()))) as Frame[];

    // 首两帧必须是 start 0/1 (顺序无所谓,但都要有)
    expect(
      frames
        .slice(0, 2)
        .map((f) => f.event)
        .sort(),
    ).toEqual(["start", "start"]);
    const startIdxs = frames
      .slice(0, 2)
      .map((f) => (f as { event: "start"; idx: 0 | 1 }).idx)
      .sort();
    expect(startIdxs).toEqual([0, 1]);

    // 末帧必须是 done
    expect(frames[frames.length - 1]).toEqual({ event: "done" });

    // 必须有 end×2
    const ends = frames.filter((f) => f.event === "end");
    expect(ends.map((f) => (f as { event: "end"; idx: 0 | 1 }).idx).sort()).toEqual([0, 1]);

    // token 帧两路都有
    const tokens0 = frames.filter((f) => f.event === "token" && f.idx === 0);
    const tokens1 = frames.filter((f) => f.event === "token" && f.idx === 1);
    expect(tokens0).toHaveLength(2);
    expect(tokens1).toHaveLength(2);
  });

  it("两路 temperature 不同(0.6 / 1.0)", async () => {
    const { service, chatStream } = makeService([
      streamOf({ done: true }),
      streamOf({ done: true }),
    ]);

    await firstValueFrom(service.stream(INPUT).pipe(toArray()));

    expect(chatStream).toHaveBeenCalledTimes(2);
    const temps = chatStream.mock.calls.map((c) => c[1]?.temperature).sort();
    expect(temps).toEqual([0.6, 1.0]);
  });

  it("一路 error 不影响另一路,最终仍发 done", async () => {
    const { service } = makeService([
      streamOf({ error: "boom" }),
      streamOf({ delta: "乙A" }, { done: true }),
    ]);

    const frames = (await firstValueFrom(service.stream(INPUT).pipe(toArray()))) as Frame[];

    // 必须有 idx=0 的 error 帧
    const err = frames.find((f) => f.event === "error" && f.idx === 0);
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain("boom");

    // 另一路 token + end 都要有
    expect(frames.some((f) => f.event === "token" && f.idx === 1)).toBe(true);
    expect(frames.some((f) => f.event === "end" && f.idx === 1)).toBe(true);

    // 末帧仍是 done
    expect(frames[frames.length - 1]).toEqual({ event: "done" });
  });

  it("Prompt fixture 缺失 → error 帧 + done", async () => {
    const prompts = {
      findDefaultByTool: jest
        .fn()
        .mockRejectedValueOnce(new NotFoundException("SAFE_REWRITE prompt not configured")),
    } as unknown as PromptsService;
    const llm = { chatStream: jest.fn() } as unknown as LlmClient;
    const service = new SafeRewriteService(llm, prompts);

    const frames = (await firstValueFrom(service.stream(INPUT).pipe(toArray()))) as Frame[];

    expect(frames[0].event).toBe("error");
    expect(frames[frames.length - 1]).toEqual({ event: "done" });
    expect(llm.chatStream).not.toHaveBeenCalled();
  });
});
