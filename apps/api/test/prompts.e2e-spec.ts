import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures, PROMPT_STARTERS } from "./../prisma/fixtures";

interface PromptResponse {
  id: string;
  owner: string;
  tool: string;
  name: string;
  isStarter: boolean;
}

describe("PromptsController (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("GET /prompts -> 200 returns all PLATFORM prompts", async () => {
    const res = await request(app.getHttpServer()).get("/prompts").expect(200);
    const list = res.body as PromptResponse[];

    expect(Array.isArray(list)).toBe(true);
    // Phase 2.3 起 SAFETY_REVIEW / QUALITY_REVIEW 是平台保留 Prompt,默认从 list 隐藏
    // Phase 2.13 起 SAFE_REWRITE 同为平台保留 Prompt,默认从 list 隐藏
    const visible = PROMPT_STARTERS.filter(
      (p) => p.tool !== "SAFETY_REVIEW" && p.tool !== "QUALITY_REVIEW" && p.tool !== "SAFE_REWRITE",
    );
    expect(list.length).toBe(visible.length);
    expect(list.every((p) => p.owner === "PLATFORM")).toBe(true);
    expect(list.every((p) => p.isStarter === true)).toBe(true);
    expect(
      list.every(
        (p) =>
          p.tool !== "SAFETY_REVIEW" && p.tool !== "QUALITY_REVIEW" && p.tool !== "SAFE_REWRITE",
      ),
    ).toBe(true);
  });

  it("GET /prompts?tool=REWRITE_FLUENT -> 200 returns filtered list", async () => {
    const res = await request(app.getHttpServer())
      .get("/prompts")
      .query({ tool: "REWRITE_FLUENT" })
      .expect(200);
    const list = res.body as PromptResponse[];

    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((p) => p.tool === "REWRITE_FLUENT")).toBe(true);
  });

  it("GET /prompts?tool=INVALID -> 400 (DTO enum check)", async () => {
    await request(app.getHttpServer()).get("/prompts").query({ tool: "INVALID" }).expect(400);
  });

  it("GET /prompts/:id -> 200 returns one prompt", async () => {
    const all = await prisma.prompt.findMany({ where: { owner: "PLATFORM" } });
    const targetId = all[0].id;

    const res = await request(app.getHttpServer()).get(`/prompts/${targetId}`).expect(200);
    const found = res.body as PromptResponse;

    expect(found.id).toBe(targetId);
    expect(found.owner).toBe("PLATFORM");
  });

  it("GET /prompts/:id -> 404 when not found", async () => {
    await request(app.getHttpServer()).get("/prompts/nonexistent-prompt-zzz").expect(404);
  });
});
