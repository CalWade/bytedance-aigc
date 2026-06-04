import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import type { ChatStreamFrame } from "./../src/llm/llm.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";
import { readSse } from "./helpers/sse-client";

const DEMO_FAST_DRAFT_ID = "demodraft0000000000000001";
const OTHER_AUTHOR_ID = "otheruser0000000000000001";
const OTHER_DRAFT_ID = "otherdraft000000000000001";

const VALID_OUTLINE_JSON = JSON.stringify({
  sections: [
    { heading: "引子", summary: "背景介绍" },
    { heading: "现状", summary: "数据与现象", hint: "用图表" },
    { heading: "结论", summary: "总结观点" },
  ],
});

describe("FAST mode (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const llmChatMock = jest.fn();
  const llmStreamMock = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: llmChatMock, chatStream: llmStreamMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await applyAllFixtures(prisma);

    // 临时插一个非 demo user 的 draft,用于测 403
    await prisma.user.create({ data: { id: OTHER_AUTHOR_ID, handle: "other-user" } });
    await prisma.draft.create({
      data: {
        id: OTHER_DRAFT_ID,
        authorId: OTHER_AUTHOR_ID,
        mode: "FAST",
        title: "他人草稿",
        body: { type: "doc", content: [] },
        version: 1,
      },
    });

    token = await loginAsDemo(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  beforeEach(() => {
    llmChatMock.mockReset();
    llmStreamMock.mockReset();
  });

  it("POST /drafts/:id/outline -> 200 with sections 3-8", async () => {
    llmChatMock.mockResolvedValueOnce(VALID_OUTLINE_JSON);

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/outline`)
      .set("Authorization", `Bearer ${token}`)
      .send({ topic: "AI 写作工具" })
      .expect(200);

    const body = res.body as { sections: Array<{ heading: string; summary: string }> };
    expect(body.sections).toHaveLength(3);
    expect(body.sections[0].heading).toBe("引子");
  });

  it("POST /drafts/:otherId/outline -> 403 when caller is not the author", async () => {
    llmChatMock.mockResolvedValueOnce(VALID_OUTLINE_JSON);

    await request(app.getHttpServer())
      .post(`/drafts/${OTHER_DRAFT_ID}/outline`)
      .set("Authorization", `Bearer ${token}`)
      .send({ topic: "anything" })
      .expect(403);

    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("POST /drafts/:id/sections/stream -> SSE 帧序 start/token/end/done(M3 真链路鉴权)", async () => {
    llmStreamMock.mockReturnValueOnce(of<ChatStreamFrame>({ delta: "你好" }, { done: true }));

    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number; address: string };

    const { status, frames } = await readSse({
      host: addr.address,
      port: addr.port,
      path: `/drafts/${DEMO_FAST_DRAFT_ID}/sections/stream`,
      method: "POST",
      body: { sections: [{ heading: "引子", summary: "背景" }] },
      token,
      timeoutMs: 5000,
    });
    server.close();

    expect(status).toBe(200);
    const types = frames.map((f) => (f.data as { type: string }).type);
    expect(types).toEqual(["section.start", "token", "section.end", "done"]);
  });

  it("POST /drafts/:id/sections/stream -> service 主动注入 LLM 异常 → SSE error 帧(防全局 Filter 截胡)", async () => {
    llmStreamMock.mockReturnValueOnce(of<ChatStreamFrame>({ error: "upstream timeout" }));

    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number; address: string };

    const { status, frames } = await readSse({
      host: addr.address,
      port: addr.port,
      path: `/drafts/${DEMO_FAST_DRAFT_ID}/sections/stream`,
      method: "POST",
      body: { sections: [{ heading: "x", summary: "y" }] },
      token,
      timeoutMs: 5000,
    });
    server.close();

    expect(status).toBe(200);
    const last = frames[frames.length - 1];
    expect((last.data as { type: string }).type).toBe("error");
  });
});
