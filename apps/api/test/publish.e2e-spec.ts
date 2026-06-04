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

async function seedReview(
  prisma: PrismaService,
  draftId: string,
  recommendation: "ALLOW" | "WARN" | "BLOCK",
  ageMs = 0,
): Promise<string> {
  const review = await prisma.review.create({
    data: {
      draftId,
      stage: "PREFLIGHT",
      safety: { overall: 100, dimensions: [] },
      quality: { overall: 80, dimensions: [] },
      recommendation,
      modelMeta: {},
      createdAt: new Date(Date.now() - ageMs),
    },
  });
  await prisma.draft.update({ where: { id: draftId }, data: { lastReviewId: review.id } });
  return review.id;
}

async function clearLastReview(prisma: PrismaService, draftId: string): Promise<void> {
  await prisma.draft.update({ where: { id: draftId }, data: { lastReviewId: null } });
  await prisma.review.deleteMany({ where: { draftId } });
}

describe("Phase 2.3 publish 状态机 (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: jest.fn(), chatStream: jest.fn() })
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
    token = await loginAsDemo(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await clearLastReview(prisma, DEMO_FAST_DRAFT_ID);
    // 也把可能被前一用例改成 PUBLISHED 的状态恢复回 DRAFT
    await prisma.draft.update({
      where: { id: DEMO_FAST_DRAFT_ID },
      data: { status: "DRAFT", publishedAt: null },
    });
  });

  it("无 preflight → 409 PREFLIGHT_REQUIRED", async () => {
    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect((res.body as { code?: string }).code).toBe("PREFLIGHT_REQUIRED");
  });

  it("preflight BLOCK → 409 PREFLIGHT_BLOCKED", async () => {
    await seedReview(prisma, DEMO_FAST_DRAFT_ID, "BLOCK");
    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect((res.body as { code?: string }).code).toBe("PREFLIGHT_BLOCKED");
  });

  it("preflight 25h 前 → 409 PREFLIGHT_EXPIRED", async () => {
    await seedReview(prisma, DEMO_FAST_DRAFT_ID, "ALLOW", 25 * 3600 * 1000);
    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect((res.body as { code?: string }).code).toBe("PREFLIGHT_EXPIRED");
  });

  it("ALLOW preflight + 24h 内 → 200 PUBLISHED", async () => {
    await seedReview(prisma, DEMO_FAST_DRAFT_ID, "ALLOW");
    const res = await request(app.getHttpServer())
      .post(`/drafts/${DEMO_FAST_DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const body = res.body as { id: string; publishedAt: string };
    expect(body.id).toBe(DEMO_FAST_DRAFT_ID);
    expect(body.publishedAt).toBeTruthy();

    const updated = await prisma.draft.findUnique({ where: { id: DEMO_FAST_DRAFT_ID } });
    expect(updated?.status).toBe("PUBLISHED");
    expect(updated?.publishedAt).toBeTruthy();
  });
});
