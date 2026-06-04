import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

const DEMO_FAST_DRAFT_ID = "demodraft0000000000000001";
const OTHER_AUTHOR_ID = "otheruser0000000000000002";
const OTHER_DRAFT_ID = "otherdraft000000000000002";

const ALL_LOW_SAFETY = JSON.stringify({
  dimensions: [
    { key: "pornography", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "gambling", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "drugs", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "politics", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "vulgarity", score: 0, severity: "low", hits: [], reason: "无" },
    { key: "false_advertising", score: 0, severity: "low", hits: [], reason: "无" },
  ],
});
const HIGH_QUALITY = JSON.stringify({
  dimensions: [
    { key: "content_value", score: 90, reason: "好" },
    { key: "expression", score: 88, reason: "好" },
    { key: "reader_experience", score: 85, reason: "好" },
    { key: "viral_potential", score: 82, reason: "好" },
  ],
});

describe("Phase 2.3 preflight & reviews (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  const llmChatMock = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: llmChatMock, chatStream: jest.fn() })
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

    await prisma.user.create({ data: { id: OTHER_AUTHOR_ID, handle: "preflight-other" } });
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
  });

  it("POST /drafts/:id/preflight 200 → 含 review + recommendation ALLOW", async () => {
    llmChatMock.mockResolvedValueOnce(ALL_LOW_SAFETY).mockResolvedValueOnce(HIGH_QUALITY);

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/preflight`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      review: { id: string; stage: string };
      recommendation: string;
    };
    expect(body.review.id).toEqual(expect.any(String));
    expect(body.review.stage).toBe("PREFLIGHT");
    expect(["ALLOW", "WARN", "BLOCK"]).toContain(body.recommendation);
    expect(body.recommendation).toBe("ALLOW");

    // 写入 Draft.lastReviewId
    const updated = await prisma.draft.findUnique({ where: { id: DEMO_FAST_DRAFT_ID } });
    expect(updated?.lastReviewId).toBe(body.review.id);
  });

  it("POST /drafts/:id/preflight 401(无 token)", async () => {
    await request(app.getHttpServer()).post(`/drafts/${DEMO_FAST_DRAFT_ID}/preflight`).expect(401);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("POST /drafts/:otherId/preflight 403(别人草稿)", async () => {
    await request(app.getHttpServer())
      .post(`/drafts/${OTHER_DRAFT_ID}/preflight`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("GET /drafts/:id/reviews?limit=5 返最近 N 条", async () => {
    llmChatMock.mockResolvedValueOnce(ALL_LOW_SAFETY).mockResolvedValueOnce(HIGH_QUALITY);
    await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/preflight`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/drafts/${DEMO_FAST_DRAFT_ID}/reviews?limit=5`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = res.body as Array<{ id: string; stage: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].stage).toBe("PREFLIGHT");
  });
});
