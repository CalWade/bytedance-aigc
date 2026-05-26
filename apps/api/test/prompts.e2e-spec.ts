import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";

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
  let seededIds: string[] = [];

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
    await prisma.prompt.deleteMany({ where: { owner: "PLATFORM" } });

    const fixtures: Prisma.PromptCreateManyInput[] = [
      {
        owner: "PLATFORM",
        tool: "REWRITE_FLUENT",
        name: "e2e-默认·改写更通顺",
        systemPrompt: "test rewrite",
        params: { temperature: 0.4 },
        fewShots: [],
        isStarter: true,
      },
      {
        owner: "PLATFORM",
        tool: "EXPAND",
        name: "e2e-默认·扩写",
        systemPrompt: "test expand",
        params: { temperature: 0.6 },
        fewShots: [],
        isStarter: true,
      },
    ];
    await prisma.prompt.createMany({ data: fixtures });
    const all = await prisma.prompt.findMany({ where: { owner: "PLATFORM" } });
    seededIds = all.map((p) => p.id);
  });

  afterAll(async () => {
    await prisma.prompt.deleteMany({ where: { owner: "PLATFORM" } });
    await app.close();
  });

  it("GET /prompts -> 200 returns all PLATFORM prompts", async () => {
    const res = await request(app.getHttpServer()).get("/prompts").expect(200);
    const list = res.body as PromptResponse[];

    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((p) => p.owner === "PLATFORM")).toBe(true);
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
    const targetId = seededIds[0];
    const res = await request(app.getHttpServer()).get(`/prompts/${targetId}`).expect(200);
    const found = res.body as PromptResponse;

    expect(found.id).toBe(targetId);
    expect(found.owner).toBe("PLATFORM");
  });

  it("GET /prompts/:id -> 404 when not found", async () => {
    await request(app.getHttpServer()).get("/prompts/nonexistent-prompt-zzz").expect(404);
  });
});
