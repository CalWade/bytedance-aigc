# Phase 2.9 §2.1 assets 图片上传 — Design Spec

> 2026-06-07,把 architecture §2.1 最后未做的 `assets/` 子模块落地。

## 目标

让作者在草稿编辑器里**拖拽 / 粘贴图片直接上传**,得到一个稳定 URL,插入 TipTap 文档。零依赖宿主磁盘,生产可平迁 OSS/COS。

## 范围

- 后端 NestJS `AssetsModule` + Prisma `Asset` 表
- S3 兼容存储(@aws-sdk/client-s3),本地走 MinIO(docker-compose),生产换 endpoint 即接 OSS/COS
- 上传策略 = 后端中转(multipart 直传到 API → API 转存到 S3),demo 项目体感稳,后续要直传换 PUT 预签即可
- TipTap `@tiptap/extension-image` + 自定义拖拽 / 粘贴 handler
- 限制:单文件 ≤ 5MB,mime ∈ {image/jpeg, image/png, image/webp, image/gif}

## 不做项

- 不做图片压缩 / 缩略图(后续)
- 不做单独素材库 UI(只做拖拽嵌入)
- 不做删除接口(demo 不留长期资产管理)
- 不做 CDN(URL 直走 S3 endpoint)
- 不做预签直传(中转够稳,demo 不存在 100MB 图片场景)

## 数据模型

```prisma
model Asset {
  id        String   @id @default(cuid())
  userId    String
  key       String   @unique  // S3 object key, e.g. "users/<uid>/2026/06/<cuid>.webp"
  url       String              // 完整可访问 URL
  mime      String
  size      Int
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("assets")
}
```

User 加 `assets Asset[]`。

## API 设计

| 端点             | 方法 | 鉴权      | 入参             | 出参                                                |
| ---------------- | ---- | --------- | ---------------- | --------------------------------------------------- |
| `/assets/upload` | POST | UserGuard | multipart `file` | `{ id, key, url, mime, size }`                      |
| `/assets/mine`   | GET  | UserGuard | `?limit=20`      | `{ items: Asset[] }`(预留;前端最小集不接,但 e2e 验) |

错误:

- 413 文件超 5MB
- 415 mime 不在白名单
- 401 未登录(全局 JwtGuard)

## 存储抽象

`StorageService` 接口:

```ts
interface StorageService {
  put(key: string, body: Buffer, mime: string): Promise<{ url: string }>;
}
```

`S3StorageService implements StorageService` — 用 @aws-sdk/client-s3 PutObjectCommand。

env:

```
S3_ENDPOINT=http://localhost:9000        # MinIO 本地;生产换成 https://oss-cn-...
S3_REGION=us-east-1                       # MinIO 不校验,真 OSS 填实际 region
S3_BUCKET=bytedance-aigc-dev
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_PUBLIC_URL=http://localhost:9000/bytedance-aigc-dev   # 浏览器访问 URL prefix
S3_FORCE_PATH_STYLE=true                  # MinIO 必须;真 S3 false
```

启动期 fail-loudly:缺任一项 abort。

## docker-compose

加 minio service:

```yaml
minio:
  image: minio/minio:latest
  ports: ["9000:9000", "9001:9001"]
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
  volumes: [minio_data:/data]
```

启动后需手动建 bucket(README 说明,或加个一次性 init container)— demo 阶段手建即可。

## 前端

- 新建 `apps/web/src/lib/upload-image.ts`:`uploadImage(file: File): Promise<{ url: string }>` — 走 fetch FormData
- 改 `apps/web/src/components/tiptap-body.tsx`:
  - 加 `@tiptap/extension-image`
  - `handleDrop` / `handlePaste`:截获 image 文件,调 uploadImage,成功后 `editor.chain().setImage({ src: url }).run()`
  - 上传中显示「上传中…」占位文字(简化,不做完整 placeholder node)
- 工具栏加「图片」按钮 → 弹 file picker → 同样路径

## e2e(api/test)

新增 `assets-upload.e2e-spec.ts`:

- 401 未登录拒绝
- ✓ 登录上传 PNG → 200,DB 落 Asset,响应 url 非空
- ✗ 415 上传 application/json
- ✗ 413 上传 6MB buffer
- ✓ /assets/mine 返回上传项

**MinIO 不在 CI 里**:用 `MockStorageService` 替换 S3StorageService(返回固定 url),只验业务路径。CI env 加 `STORAGE_DRIVER=mock` 配置开关。

## web 单测

`upload-image.test.ts`:fetch mock,验请求格式 + 错误传播。

## 验证清单

- [ ] Prisma migration 应用
- [ ] api typecheck/lint/test/e2e 全绿
- [ ] web typecheck/lint/test/build 全绿
- [ ] CI 5 job 全绿
- [ ] verifier PASS
- [ ] commit + push origin/main
