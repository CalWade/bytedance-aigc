import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { Server } from "node:http";
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
const OTHER_PRIVATE_PROMPT_ID = "otherprompt00000000000001";
const NONEXISTENT_DRAFT_ID = "ghostdraft00000000000001";

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
    // 他人 PRIVATE prompt(测 promptId 越权 403)
    await prisma.prompt.create({
      data: {
        id: OTHER_PRIVATE_PROMPT_ID,
        owner: "PRIVATE",
        authorId: OTHER_AUTHOR_ID,
        tool: "REWRITE_FLUENT",
        name: "他人私有 prompt",
        systemPrompt: "你是另一个人的编辑助手",
        params: { temperature: 0.5 },
        fewShots: [],
        isStarter: false,
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
    llmStreamMock.mockReturnValueOnce(
      of(...([{ delta: "你好" }, { done: true }] as [ChatStreamFrame, ChatStreamFrame])),
    );

    const server = app.getHttpServer() as Server;
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

    const server = app.getHttpServer() as Server;
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

  // ---- Task 7: tools/invoke ----

  it("POST /drafts/:id/tools/invoke REWRITE_FLUENT -> 200 + text 候选", async () => {
    llmChatMock.mockResolvedValueOnce("更通顺的句子");

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "REWRITE_FLUENT", input: { selectedText: "原句" } })
      .expect(200);

    const body = res.body as { candidates: Array<{ kind: string; text?: string }> };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].kind).toBe("text");
    expect(body.candidates[0].text).toBe("更通顺的句子");
  });

  it("POST /drafts/:id/tools/invoke HEADLINE_NEW -> 200 + text 候选", async () => {
    llmChatMock.mockResolvedValueOnce("某公司发布新产品:核心是 X");

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "HEADLINE_NEW", input: { fullText: "正文..." } })
      .expect(200);

    const body = res.body as { candidates: Array<{ kind: string }> };
    expect(body.candidates[0].kind).toBe("text");
  });

  it("POST /drafts/:nonexistentId/tools/invoke -> 404", async () => {
    await request(app.getHttpServer())
      .post(`/drafts/${NONEXISTENT_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "REWRITE_FLUENT", input: { selectedText: "x" } })
      .expect(404);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("POST /drafts/:otherId/tools/invoke -> 403(assertAuthor 在新端点回归)", async () => {
    await request(app.getHttpServer())
      .post(`/drafts/${OTHER_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "REWRITE_FLUENT", input: { selectedText: "x" } })
      .expect(403);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("POST /drafts/:id/tools/invoke promptId 指别人 PRIVATE -> 403", async () => {
    await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        tool: "REWRITE_FLUENT",
        input: { selectedText: "x" },
        promptId: OTHER_PRIVATE_PROMPT_ID,
      })
      .expect(403);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("POST /drafts/:id/tools/invoke IMAGE_SUGGEST -> 200 + image 候选 + alt + reason", async () => {
    llmChatMock.mockResolvedValueOnce('[{"alt":"工程师专注工作","reason":"贴合远程办公主题"}]');

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/tools/invoke`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tool: "IMAGE_SUGGEST", input: { fullText: "讨论了远程办公" } })
      .expect(200);

    const body = res.body as {
      candidates: Array<{ kind: string; alt?: string; reason?: string }>;
    };
    expect(body.candidates[0].kind).toBe("image");
    expect(body.candidates[0].alt).toBe("工程师专注工作");
    expect(body.candidates[0].reason).toBe("贴合远程办公主题");
  });
});
