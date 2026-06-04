import { ForbiddenException } from "@nestjs/common";
import { firstValueFrom, lastValueFrom, Observable, of, throwError, toArray } from "rxjs";

import { LlmClient } from "../llm/llm.client";
import type { ChatStreamFrame } from "../llm/llm.client";
import { DraftsService } from "./drafts.service";
import { SectionsService, type StreamMessageEvent } from "./sections.service";
import type { SectionsStreamDto } from "./dto/sections-stream.dto";

function makeService(streamFactory: () => Observable<ChatStreamFrame>) {
  const drafts = { assertAuthor: jest.fn().mockResolvedValue({}) } as unknown as DraftsService;
  const llm = {
    chatStream: jest.fn().mockImplementation(() => streamFactory()),
  } as unknown as LlmClient;
  const svc = new SectionsService(drafts, llm);
  return { svc, drafts, llm };
}

const DTO_ONE_SECTION: SectionsStreamDto = {
  sections: [{ heading: "引子", summary: "背景介绍" }],
};

describe("SectionsService", () => {
  it("happy path:每节 emit start → token×N → end,流末 done", async () => {
    const { svc } = makeService(() =>
      of<ChatStreamFrame>({ delta: "你好" }, { delta: ",世界" }, { done: true }),
    );

    const stream = await svc.stream("d1", "u1", DTO_ONE_SECTION);
    const frames = await lastValueFrom(stream.pipe(toArray()));

    const types = frames.map((f) => f.data.type);
    expect(types).toEqual(["section.start", "token", "token", "section.end", "done"]);
    const tokens = frames
      .filter((f) => f.data.type === "token")
      .map((f) => (f.data.data as { delta: string }).delta);
    expect(tokens).toEqual(["你好", ",世界"]);
  });

  it("LLM 流中 error → 归一为 SSE error 帧而非 throw", async () => {
    const { svc } = makeService(() => of<ChatStreamFrame>({ error: "rate limited" }));

    const stream = await svc.stream("d1", "u1", DTO_ONE_SECTION);
    const frames = await lastValueFrom(stream.pipe(toArray()));
    const last = frames[frames.length - 1];
    expect(last.data.type).toBe("error");
    expect((last.data.data as { message: string }).message).toBe("rate limited");
  });

  it("LLM Observable 抛错(非 error 帧)→ 归一为 SSE error 帧", async () => {
    const { svc } = makeService(() => throwError(() => new Error("upstream down")));

    const stream = await svc.stream("d1", "u1", DTO_ONE_SECTION);
    const frames = await lastValueFrom(stream.pipe(toArray()));
    const last = frames[frames.length - 1];
    expect(last.data.type).toBe("error");
  });

  it("assertAuthor 失败 → throw,不切 SSE(让 Filter 转 4xx)", async () => {
    const drafts = {
      assertAuthor: jest.fn().mockRejectedValueOnce(new ForbiddenException("nope")),
    } as unknown as DraftsService;
    const llm = { chatStream: jest.fn() } as unknown as LlmClient;
    const svc = new SectionsService(drafts, llm);

    await expect(svc.stream("d1", "u1", DTO_ONE_SECTION)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(llm.chatStream).not.toHaveBeenCalled();
  });

  it("cursor 控制起始 index", async () => {
    const { svc } = makeService(() => of<ChatStreamFrame>({ delta: "x" }, { done: true }));

    const dto: SectionsStreamDto = {
      sections: [
        { heading: "h0", summary: "s0" },
        { heading: "h1", summary: "s1" },
      ],
      cursor: 1,
    };
    const stream = await svc.stream("d1", "u1", dto);
    const frames = await lastValueFrom(stream.pipe(toArray()));

    const starts = frames.filter((f) => f.data.type === "section.start");
    expect(starts).toHaveLength(1);
    expect((starts[0].data.data as { index: number }).index).toBe(1);
  });
});

// 帮 TypeScript 推 StreamMessageEvent 字段(防止某些断言被弱推)
type _ = StreamMessageEvent;
