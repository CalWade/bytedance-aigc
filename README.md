# AI 创作者辅助生产与分发平台

字节头条 AI 前端训练营课题：面向创作者的 AI 辅助生产与分发平台，覆盖**得力助手 / 守门员 / 导航员**三角色叙事，专注中长图文（头条资讯形态）。

> 本仓库为训练营 3 周交付项目，处于 Phase 0 工程化基建阶段。

## 文档

- 产品需求文档（PRD）：[`docs/PRD.md`](./docs/PRD.md)
- 架构决策记录（ADR）：`docs/decisions/`（待建）
- 系统架构草稿：`docs/architecture.md`（Phase 0 Step 7 产出）

## 核心能力（PRD 摘要）

- **双轨创作入口**：快速稿（AI 主导生成）+ 精耀稿（人主导 + AI 工具）
- **两层 Prompt 体系**：平台内置 Prompt 库（只读默认款）+ 作者私人层（复制后可编辑）
- **5 阶段审核链路**：Prompt / 输入 / 生成（流式）/ 发布前 / 发布后，分级响应
- **4 维质量评分**：内容价值 / 表达质量 / 读者体验 / 传播潜力
- **加权榜单**：`score = α·质量 + β·热度 + γ·时间衰减`，权重 UI 可配置

## 技术栈

| 层 | 选型 |
|---|---|
| Monorepo | pnpm workspace |
| 前端 | Next.js（`apps/web`） |
| 后端 | NestJS / Koa（`apps/api`） |
| 共享 | TypeScript 类型 / 常量 / 工具（`packages/shared`） |
| 数据 | PostgreSQL + Redis（本地 Docker Compose） |
| 测试 | Vitest（单元）+ Playwright（端到端） |
| CI | GitHub Actions（lint / typecheck / test / build 四关） |

## 本地开发（Phase 0 完成后填充）

```bash
pnpm install
pnpm dev
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
