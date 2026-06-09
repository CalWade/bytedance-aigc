import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { LlmClient } from "./../src/llm/llm.client";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

const DRAFT_ID = "demodraft0000000000000001";

async function seedAllowReview(prisma: PrismaService, draftId: string): Promise<void> {
  const review = await prisma.review.create({
    data: {
      draftId,
      stage: "PREFLIGHT",
      safety: { overall: 100, dimensions: [] },
      quality: { overall: 80, dimensions: [] },
      recommendation: "ALLOW",
      modelMeta: {},
    },
  });
  await prisma.draft.update({ where: { id: draftId }, data: { lastReviewId: review.id } });
}

describe("Phase 2.15 二次编辑链路 (e2e)", () => {
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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
    // 复位 demo 草稿到首发态(清掉 publishedBody/Title/Version 与 review)
    await prisma.draft.update({
      where: { id: DRAFT_ID },
      data: {
        status: "DRAFT",
        publishedAt: null,
        publishedTitle: null,
        publishedVersion: null,
        title: "demo·快速稿示例",
        body: { type: "doc", content: [{ type: "paragraph", text: "v1 正文" }] },
        lastReviewId: null,
      },
    });
    // Prisma 不允许 update Json 字段为 NULL,只能走 raw SQL
    await prisma.$executeRaw`UPDATE "drafts" SET "publishedBody" = NULL WHERE id = ${DRAFT_ID}`;
    await prisma.review.deleteMany({ where: { draftId: DRAFT_ID } });
  });

  it("PUBLISHED 状态 → /edit 切回 DRAFT,version+1,publishedBody 仍保留", async () => {
    await seedAllowReview(prisma, DRAFT_ID);
    await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const before = await prisma.draft.findUnique({ where: { id: DRAFT_ID } });
    expect(before?.status).toBe("PUBLISHED");
    expect(before?.publishedBody).not.toBeNull();
    const versionBefore = before?.version ?? 0;

    const res = await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/edit`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ id: DRAFT_ID, status: "DRAFT" });

    const after = await prisma.draft.findUnique({ where: { id: DRAFT_ID } });
    expect(after?.status).toBe("DRAFT");
    expect(after?.version).toBe(versionBefore + 1);
    expect(after?.publishedBody).not.toBeNull(); // 老线上版仍保留
  });

  it("DRAFT 状态调 /edit → 409 EDIT_NOT_ALLOWED", async () => {
    const res = await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/edit`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    const body = res.body as { code?: string };
    expect(body.code).toBe("EDIT_NOT_ALLOWED");
  });

  it("二发完整链路:edit → 改 body → preflight → publish → publishedBody 覆盖,/post/:id 全程可见", async () => {
    // 首发
    await seedAllowReview(prisma, DRAFT_ID);
    await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const v1 = await prisma.draft.findUnique({ where: { id: DRAFT_ID } });
    expect(v1?.publishedTitle).toBe("demo·快速稿示例");
    expect(v1?.publishedBody).not.toBeNull();

    // 切回编辑
    await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/edit`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // 模拟二发期间作者改 body+title(直接 DB 注入,简化掉 PATCH /drafts/:id 流)
    await prisma.draft.update({
      where: { id: DRAFT_ID },
      data: {
        title: "v2 标题",
        body: { type: "doc", content: [{ type: "paragraph", text: "v2 正文" }] },
      },
    });

    // 二发期间 /post/:id 仍能拿到老线上版(B-path:DRAFT + publishedBody 非空)
    const postBefore = await request(app.getHttpServer()).get(`/post/${DRAFT_ID}`).expect(200);
    const oldPost = postBefore.body as { title: string; body: { content?: unknown[] } };
    expect(oldPost.title).toBe("demo·快速稿示例");
    expect(JSON.stringify(oldPost.body)).toContain("v1");

    // 重过 preflight
    await seedAllowReview(prisma, DRAFT_ID);

    // 二发
    await request(app.getHttpServer())
      .post(`/drafts/${DRAFT_ID}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const v2 = await prisma.draft.findUnique({ where: { id: DRAFT_ID } });
    expect(v2?.status).toBe("PUBLISHED");
    expect(v2?.publishedTitle).toBe("v2 标题");
    expect(v2?.publishedBody).not.toEqual(v1?.publishedBody); // 已覆盖

    // /post/:id 显新版
    const postAfter = await request(app.getHttpServer()).get(`/post/${DRAFT_ID}`).expect(200);
    const newPost = postAfter.body as { title: string; body: { content?: unknown[] } };
    expect(newPost.title).toBe("v2 标题");
    expect(JSON.stringify(newPost.body)).toContain("v2");

    // PUBLISHED 版本快照应有 2 条(首发 + 二发)
    const versions = await prisma.draftVersion.findMany({
      where: { draftId: DRAFT_ID, kind: "PUBLISHED" },
    });
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });
});
