# AI 创作者辅助生产与分发平台

[![CI](https://github.com/CalWade/bytedance-aigc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CalWade/bytedance-aigc/actions/workflows/ci.yml)

字节头条 AI 前端训练营课题：面向创作者的 AI 辅助生产与分发平台，覆盖**得力助手 / 守门员 / 导航员**三角色叙事，专注中长图文（头条资讯形态）。

> 本仓库为训练营 3 周交付项目，处于 Phase 0 工程化基建阶段。

## 文档

- 产品需求文档（PRD）：[`docs/PRD.md`](./docs/PRD.md)
- 系统架构草稿：[`docs/architecture.md`](./docs/architecture.md)（Phase 0 Step 7 产出）
- 架构决策记录（ADR）：[`docs/decisions/`](./docs/decisions/)
  - [ADR-0001](./docs/decisions/0001-api-framework.md) 后端框架——NestJS
  - [ADR-0002](./docs/decisions/0002-data-layer.md) 数据层 ORM——Prisma

## 核心能力（PRD 摘要）

- **双轨创作入口**：快速稿（AI 主导生成）+ 精耀稿（人主导 + AI 工具）
- **两层 Prompt 体系**：平台内置 Prompt 库（只读默认款）+ 作者私人层（复制后可编辑）
- **5 阶段审核链路**：Prompt / 输入 / 生成（流式）/ 发布前 / 发布后，分级响应
- **4 维质量评分**：内容价值 / 表达质量 / 读者体验 / 传播潜力
- **加权榜单**：`score = α·质量 + β·热度 + γ·时间衰减`，权重 UI 可配置

## 技术栈

| 层       | 选型                                                           |
| -------- | -------------------------------------------------------------- |
| Monorepo | pnpm workspace                                                 |
| 前端     | Next.js 16 + React 19 + Tailwind v4 + App Router（`apps/web`） |
| 后端     | NestJS 11（`apps/api`）                                        |
| 共享     | TypeScript 类型 / 常量 / 工具（`packages/shared`）             |
| 数据     | PostgreSQL + Redis（本地 Docker Compose）                      |
| 测试     | Vitest（单元）+ Playwright（端到端）                           |
| CI       | GitHub Actions（lint / typecheck / test / build 四关）         |

## 本地开发

> 需要：Node ≥ 22、pnpm ≥ 10、Docker（含 Compose v2，docker engine ≥ 20.10）

```bash
# 一次性
cp .env.example .env
pnpm install

# 启动数据基建（PostgreSQL + Redis，后台运行）
pnpm db:up

# 启动应用（apps/web + apps/api 并行 dev 模式）
pnpm dev
```

| 命令            | 作用                                   |
| --------------- | -------------------------------------- |
| `pnpm db:up`    | 启动 Postgres + Redis（后台）          |
| `pnpm db:down`  | 停止容器（保留数据）                   |
| `pnpm db:reset` | 停止并删除数据卷（谨慎，全部数据丢失） |
| `pnpm db:logs`  | 查看容器日志                           |

数据持久化：使用 docker named volume（`pg_data` / `redis_data`），不映射到宿主机文件系统。`pnpm db:down` 不会丢数据，只有 `pnpm db:reset` 会。

### 数据层（Prisma）

`apps/api` 使用 Prisma 5 作为 ORM，schema 单一事实源在 [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma)。

| 命令                   | 作用                                                 |
| ---------------------- | ---------------------------------------------------- |
| `pnpm prisma:generate` | 根据 schema 重新生成 `@prisma/client` 类型           |
| `pnpm prisma:migrate`  | 开发态迁移(修改 schema 后生成 + 应用 SQL,需 PG 在跑) |
| `pnpm prisma:seed`     | 灌入平台默认 Prompt(9 条 starter,dev 幂等)           |
| `pnpm prisma:studio`   | 打开 Prisma Studio 浏览数据                          |

首次接入 / 拉新代码后:

```bash
pnpm db:up                 # 起 PG
pnpm prisma:migrate        # 应用最新迁移到本地库
pnpm prisma:seed           # 灌默认 Prompt(只读浏览端点依赖)
pnpm dev                   # 启动 web + api
```

`apps/api` e2e 测试(`/drafts` + `/prompts` 端点)依赖真实 PG,运行:

```bash
pnpm db:up
pnpm --filter @bytedance-aigc/api test:e2e
```

## 交付物清单

- [x] PRD 终稿
- [ ] 可运行系统（线上 URL / 二维码）
- [ ] 飞书技术文档
- [ ] 效果评估报告
- [ ] 规则库说明文档
- [ ] GitHub 项目代码（`main` 分支）

## License

[MIT](./LICENSE)
