import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { applyAllFixtures, cleanupAllFixtures } from "./../prisma/fixtures";
import { loginAsDemo } from "./helpers/auth";

interface UploadResponse {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
}

interface MineResponse {
  items: UploadResponse[];
}

describe("AssetsController (e2e)", () => {
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

  it("POST /assets/upload -> 401 without token", async () => {
    await request(app.getHttpServer())
      .post("/assets/upload")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "x.png",
        contentType: "image/png",
      })
      .expect(401);
  });

  it("POST /assets/upload -> 201 returns asset url, persists row", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, { filename: "logo.png", contentType: "image/png" })
      .expect(201);

    const body = res.body as UploadResponse;
    expect(body.id).toBeTruthy();
    expect(body.url).toMatch(/^https:\/\/mock\.local\//);
    expect(body.mime).toBe("image/png");
    expect(body.size).toBe(png.length);

    const row = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row?.key).toBe(body.key);
  });

  it("POST /assets/upload -> 400 unsupported mime", async () => {
    await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from('{"a":1}'), {
        filename: "x.json",
        contentType: "application/json",
      })
      .expect(400);
  });

  it("POST /assets/upload -> 400 oversize (> 5MB)", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);
    await request(app.getHttpServer())
      .post("/assets/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", big, { filename: "big.jpg", contentType: "image/jpeg" })
      .expect(400);
  });

  it("GET /assets/mine -> 200 lists current user's uploads desc", async () => {
    const res = await request(app.getHttpServer())
      .get("/assets/mine")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const body = res.body as MineResponse;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].url).toMatch(/^https:\/\/mock\.local\//);
  });
});
