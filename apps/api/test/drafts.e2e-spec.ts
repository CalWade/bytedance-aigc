import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures, DEMO_AUTHOR_ID } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

interface DraftResponse {
  id: string;
  authorId: string;
  title: string;
  mode: string;
  version: number;
}

describe("DraftsController (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

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

    token = await loginAsDemo(app);
  });

  afterAll(async () => {
    await cleanupAllFixtures(prisma);
    await app.close();
  });

  it("POST /drafts -> 201 returns created draft with cuid (authorId from token)", async () => {
    const res = await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Hello Draft",
        body: { type: "doc", content: [] },
      })
      .expect(201);

    const body = res.body as DraftResponse;
    expect(body).toMatchObject({
      authorId: DEMO_AUTHOR_ID,
      title: "Hello Draft",
      mode: "FAST",
      version: 1,
    });
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(10);
  });

  it("GET /drafts -> 200 returns array including demo + created drafts", async () => {
    const res = await request(app.getHttpServer())
      .get("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = res.body as DraftResponse[];

    expect(Array.isArray(list)).toBe(true);
    // 2 demo drafts(FAST + FINE)+ 至少 1 篇上一用例 POST 出来的
    expect(list.length).toBeGreaterThanOrEqual(3);
  });

  it("GET /drafts/:id -> 200 returns one draft", async () => {
    const created = await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Findable",
        body: {},
      })
      .expect(201);
    const createdBody = created.body as DraftResponse;

    const res = await request(app.getHttpServer())
      .get(`/drafts/${createdBody.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const found = res.body as DraftResponse;

    expect(found.id).toBe(createdBody.id);
    expect(found.title).toBe("Findable");
  });

  it("POST /drafts -> 400 when title missing", async () => {
    await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: {} })
      .expect(400);
  });

  it("POST /drafts -> 400 when body contains forbidden authorId field", async () => {
    await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({ authorId: "spoofed", title: "x", body: {} })
      .expect(400);
  });

  it("GET /drafts/:id -> 404 when not found", async () => {
    await request(app.getHttpServer())
      .get("/drafts/nonexistent-id-zzz")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("PATCH /drafts/:id -> 200 author updates and version increments", async () => {
    const created = await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Original", body: { type: "doc", content: [] } })
      .expect(201);
    const draft = created.body as DraftResponse;

    const res = await request(app.getHttpServer())
      .patch(`/drafts/${draft.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated" })
      .expect(200);
    const updated = res.body as DraftResponse;

    expect(updated.id).toBe(draft.id);
    expect(updated.title).toBe("Updated");
    expect(updated.version).toBe(draft.version + 1);
  });

  it("PATCH /drafts/:id -> 403 when caller is not author", async () => {
    const created = await request(app.getHttpServer())
      .post("/drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Mine", body: {} })
      .expect(201);
    const draft = created.body as DraftResponse;

    const otherHandle = `e2e-other-${Date.now()}`;
    const otherUser = await prisma.user.create({ data: { handle: otherHandle } });
    try {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ handle: otherHandle })
        .expect(200);
      const otherToken = (loginRes.body as { accessToken: string }).accessToken;

      await request(app.getHttpServer())
        .patch(`/drafts/${draft.id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ title: "Hacked" })
        .expect(403);
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  it("PATCH /drafts/:id -> 404 when draft id does not exist", async () => {
    await request(app.getHttpServer())
      .patch("/drafts/nonexistent-id-zzz")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x" })
      .expect(404);
  });
});
