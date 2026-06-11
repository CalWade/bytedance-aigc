import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import { GuardClient } from "./../src/llm/guard.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsAdmin, loginAsDemo } from "./helpers/auth";

interface UploadResponse {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
  reviewStatus: string;
  aiGenerated?: boolean;
  aiPrompt?: string;
}

interface CheckResponse {
  recommendation: string;
  dimensions: Array<{ key: string; score: number; severity: string; reason: string }>;
  reason: string;
}

const ALLOW_JSON = JSON.stringify({
  dimensions: [
    { key: "face", score: 0, severity: "low", reason: "无命中" },
    { key: "watermark", score: 0, severity: "low", reason: "无命中" },
    { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
    { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
  ],
});

const BLOCK_WATERMARK_JSON = JSON.stringify({
  dimensions: [
    { key: "face", score: 0, severity: "low", reason: "无命中" },
    { key: "watermark", score: 80, severity: "high", reason: "文件名含水印" },
    { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
    { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
  ],
});

const WARN_FACE_JSON = JSON.stringify({
  dimensions: [
    { key: "face", score: 50, severity: "medium", reason: "疑似人像" },
    { key: "watermark", score: 0, severity: "low", reason: "无命中" },
    { key: "sensitive", score: 0, severity: "low", reason: "无命中" },
    { key: "ai_unmarked", score: 0, severity: "low", reason: "无命中" },
  ],
});

describe("Phase 2.22 — asset review (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let demoToken: string;
  let adminToken: string;
  const llmChatMock = jest.fn();
  const guardModerateMock = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chat: llmChatMock, chatStream: jest.fn() })
      .overrideProvider(GuardClient)
      .useValue({ moderate: guardModerateMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    prisma = app.get(PrismaService);
    await app.init();

    await applyAllFixtures(prisma);
    demoToken = await loginAsDemo(app);
    adminToken = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  beforeEach(() => {
    llmChatMock.mockReset();
    guardModerateMock.mockReset().mockResolvedValue({ suggestion: "pass", details: [] });
  });

  it("upload 正常图片 → 201 + reviewStatus=PASSED", async () => {
    llmChatMock.mockResolvedValue(ALLOW_JSON);
    const res = await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${demoToken}`)
      .attach("file", Buffer.from("fake-png"), "photo.png")
      .expect(201);

    const body = res.body as UploadResponse;
    expect(body.reviewStatus).toBe("PASSED");
  });

  it("upload BLOCK → 400 不入库", async () => {
    llmChatMock.mockResolvedValue(BLOCK_WATERMARK_JSON);
    const before = await prisma.asset.count();

    await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${demoToken}`)
      .attach("file", Buffer.from("fake-png"), "watermark_photo.png")
      .expect(400);

    const after = await prisma.asset.count();
    expect(after).toBe(before);
  });

  it("upload WARN → 201 入库 + reviewStatus=WARNED", async () => {
    llmChatMock.mockResolvedValue(WARN_FACE_JSON);
    const res = await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${demoToken}`)
      .attach("file", Buffer.from("fake-png"), "portrait.png")
      .expect(201);

    const body = res.body as UploadResponse;
    expect(body.reviewStatus).toBe("WARNED");
  });

  it("check-for-insert 正常 → {recommendation: ALLOW}", async () => {
    llmChatMock.mockResolvedValue(ALLOW_JSON);
    const uploadRes = await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${demoToken}`)
      .attach("file", Buffer.from("fake-png"), "photo.png")
      .expect(201);

    const uploadBody = uploadRes.body as UploadResponse;

    llmChatMock.mockResolvedValue(ALLOW_JSON);
    const checkRes = await request(app.getHttpServer())
      .post(`/assets/${uploadBody.id}/check-for-insert`)
      .set("Authorization", `Bearer ${demoToken}`)
      .expect(201);

    const checkBody = checkRes.body as CheckResponse;
    expect(checkBody.recommendation).toBe("ALLOW");
  });

  it("check-for-insert 跨用户 → 403", async () => {
    llmChatMock.mockResolvedValue(ALLOW_JSON);
    const uploadRes = await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${demoToken}`)
      .attach("file", Buffer.from("fake-png"), "photo.png")
      .expect(201);

    const uploadBody = uploadRes.body as UploadResponse;

    await request(app.getHttpServer())
      .post(`/assets/${uploadBody.id}/check-for-insert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
  });

  it("generateAi → reviewStatus=PASSED(aiDeclared 自动 true)", async () => {
    llmChatMock.mockResolvedValue(ALLOW_JSON);
    const res = await request(app.getHttpServer())
      .post("/assets/generate")
      .set("Authorization", `Bearer ${demoToken}`)
      .send({ prompt: "a cat in office" })
      .expect(201);

    const body = res.body as UploadResponse;
    expect(body.aiGenerated).toBe(true);
    expect(body.reviewStatus).toBe("PASSED");
  });
});
