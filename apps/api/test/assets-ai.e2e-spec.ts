import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { LlmClient } from "./../src/llm/llm.client";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo, loginAs } from "./helpers/auth";

const MOCK_LLM_TAG_RESPONSE = JSON.stringify({
  scene: ["办公室", "街道"],
  subject: ["人物", "产品"],
});

describe("Assets AI (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmClient)
      .useValue({
        chat: jest.fn().mockResolvedValue(MOCK_LLM_TAG_RESPONSE),
        chatStream: jest.fn(),
      })
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
    await prisma.asset.deleteMany();
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("POST /assets/generate → 200 returns aiGenerated:true asset", async () => {
    const res = await request(app.getHttpServer())
      .post("/assets/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "一只猫在办公室里" })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(body.aiGenerated).toBe(true);
    expect(body.aiPrompt).toBe("一只猫在办公室里");
    expect(body.mime).toBe("image/png");
    expect(Array.isArray(body.sceneTags)).toBe(true);
    expect(Array.isArray(body.subjectTags)).toBe(true);
  });

  it("GET /assets/search?scene=办公室 → returns filtered results", async () => {
    // First generate an asset to have tagged data
    await request(app.getHttpServer())
      .post("/assets/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "办公室场景" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get("/assets/search?scene=办公室")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const body = res.body as { items: Record<string, unknown>[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("POST /assets/recommend → returns list", async () => {
    const res = await request(app.getHttpServer())
      .post("/assets/recommend")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "办公室里的人物照片" })
      .expect(201);

    const body = res.body as { items: Record<string, unknown>[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("跨用户隔离: 用户 B 搜索不到用户 A 的 asset", async () => {
    // Generate asset as demo-author (user A)
    await request(app.getHttpServer())
      .post("/assets/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "用户A的素材" })
      .expect(201);

    // Login as tech-author (user B)
    const tokenB = await loginAs(app, "tech-author");

    const res = await request(app.getHttpServer())
      .get("/assets/search?scene=办公室")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);

    const body = res.body as { items: Record<string, unknown>[] };
    // User B should not see User A's assets
    expect(body.items.length).toBe(0);
  });
});
