# Phase 2.9 实施 plan

参考 spec `docs/superpowers/specs/2026-06-07-phase-2-9-assets-upload-design.md`。

## Step 1:Prisma schema + migration

- 加 `Asset` model(见 spec)+ User.assets 反向关系
- `unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api prisma migrate dev --name phase29_assets`

## Step 2:依赖

```
pnpm --filter @bytedance-aigc/api add @aws-sdk/client-s3 multer
pnpm --filter @bytedance-aigc/api add -D @types/multer
pnpm --filter @bytedance-aigc/web add @tiptap/extension-image
```

## Step 3:env + config

- `.env.example` 加 S3\_\* 变量 + `STORAGE_DRIVER=s3|mock` 默认 `s3`
- `apps/api/src/config/storage.config.ts` — getOrThrow 读所有 S3\_\*

## Step 4:storage 抽象

- `apps/api/src/assets/storage/storage.service.ts` — interface
- `apps/api/src/assets/storage/s3-storage.service.ts` — 实现
- `apps/api/src/assets/storage/mock-storage.service.ts` — CI/test 用,返 `data:image/jpeg;base64,...` 或 `https://mock.local/{key}`
- `assets.module.ts` 用 useFactory 按 STORAGE_DRIVER 选实现

## Step 5:AssetsService + Controller

- `assets.service.ts`:upload(userId, file) → 算 key(`users/{uid}/{yyyy}/{mm}/{cuid}.{ext}`)→ storage.put → prisma.asset.create
- `assets.controller.ts`:
  - POST `/assets/upload` `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5*1024*1024 }, fileFilter: mime 白名单 }))`
  - GET `/assets/mine?limit=20`
- DTO 全 class-validator
- 注册到 app.module

## Step 6:e2e

新建 `apps/api/test/assets-upload.e2e-spec.ts`:

- 启 app 时 STORAGE_DRIVER=mock(setup-env.ts 设)
- 5 个用例(见 spec)

## Step 7:前端

- `apps/web/src/lib/upload-image.ts` + `.test.ts`
- 改 `tiptap-body.tsx`:加 Image extension + dropHandler + 工具栏按钮
- 依赖 `@tiptap/extension-image` 已在 step 2 装

## Step 8:本地验证

```
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api prisma:generate
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api typecheck
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api lint
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/api test:e2e
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web typecheck
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web lint
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web test
unset NODE_OPTIONS && pnpm --filter @bytedance-aigc/web build
```

## Step 9:docker-compose 加 minio

只做 compose 文件 + README 一行说明。CI 不需要。

## Step 10:commit + push

```
feat(api,web): Phase 2.9 §2.1 assets 图片上传 (S3/MinIO)

- Asset 表 + AssetsModule (upload/list mine)
- StorageService 抽象,S3 + Mock 双实现
- @aws-sdk/client-s3 + MinIO 本地 compose
- TipTap @tiptap/extension-image + 拖拽 / 粘贴 / 工具栏
- e2e 5 用例(401/415/413/上传/list)
```

## Step 11:CI watch + verifier
