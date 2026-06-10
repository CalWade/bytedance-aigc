# Lighthouse 性能复测 — 2026-06-10 (post Modern DevTools refactor)

复测对象: design/devtools-aesthetic 分支 HEAD (commit 361b442 之后, C15 完成时点)

对比基线: docs/perf/lighthouse-2026-06-10.md (refactor 前)

## 元数据

- 工具: Lighthouse 13.4.0 (CLI, headless Chrome)
- 构建: `next build` (Next.js 16.2.6 production, Turbopack)
- API: localhost:4000 (NestJS dev server, 在跑)
- Web: localhost:3100 (`next start`)
- 取样: Mobile preset(默认 Slow 4G + 4× CPU slowdown), Desktop preset, 各 1-3 次

## 复测结果

### Desktop (single run)

| 页面    | Perf | A11y | Best Pr | LCP    | FCP   | TBT | CLS | TTI    |
| ------- | ---- | ---- | ------- | ------ | ----- | --- | --- | ------ |
| /login  | 100  | 100  | 100     | 595ms  | 293ms | 0ms | 0   | 595ms  |
| /(home) | 98   | 96   | 96      | 1083ms | 328ms | 0ms | 0   | 1086ms |

### Mobile (3 次取样, /(home) 取均值)

| 页面    | Perf | A11y | Best Pr | LCP avg | FCP    | TBT avg | CLS avg | TTI    |
| ------- | ---- | ---- | ------- | ------- | ------ | ------- | ------- | ------ |
| /login  | 87   | 100  | 100     | 4075ms  | 1057ms | 34ms    | 0       | 4075ms |
| /(home) | 90   | 100  | 96      | 3636ms  | 1206ms | 21ms    | 0       | 4103ms |

samples (mobile / LCP): 3654 / 3651 / 3602 ms — 抖动 < 2%

## 红线对照

| 指标        | Plan 红线   | desktop /(home) | mobile /(home) avg | 结论                          |
| ----------- | ----------- | --------------- | ------------------ | ----------------------------- |
| LCP         | ≤ 2.0s      | 1.08s           | **3.64s**          | desktop PASS, mobile **FAIL** |
| CLS         | ≤ 0.05      | 0               | 0                  | PASS                          |
| TBT         | 不增加 30%+ | 0ms             | 21ms               | 远低于基线, PASS              |
| Performance | (基线 92)   | 98              | 90                 | desktop ↑, mobile ≈           |

## 与基线对比

旧基线 (refactor 前, 2026-06-10):

- LCP ~1.8s (mobile, Simulated Fast 3G + 4× CPU)
- Performance 92
- 当时未单独记录 desktop / mobile, 推测为 mobile

复测 mobile LCP 3.64s vs 基线 1.8s ⇒ **退化 ~1.84s (~+102%)**

可能成因 (未做归因实测):

1. next/font 引入 Inter + JetBrains_Mono, 字体子集 + swap 期间 LCP 元素文本可能被 fallback 字体先绘制再 swap
2. ThemeProvider (next-themes) 客户端水合 + suppressHydrationWarning 抑制了主题闪烁但增加了一次 hydration tick
3. AppShell 在首屏多了 Sidebar (240px aside) + sticky TopBar + Toaster, 组件树加深约 4 层
4. shadcn 组件树整体 client component 数量↑, hydration JS 可能更大
5. 首页 PostCard 改用 shadcn Card (新增 hover ring/shadow class), 渲染开销略增

## TBT / CLS 表现

CLS = 0 (3 次稳定 0.000) 显著优于基线 ~0.02 — 推测因新前端骨架屏布局更精确, 字体 swap 也无字号跳动 (Inter + 系统中文 fallback 字号一致)。

TBT mobile 21ms (home) / 34ms (login), 远低于"基线 + 30%"的隐含上界。

## Accessibility / Best Practices 增益

| 类别           | 基线 | 复测 (mobile /home) | 增量 |
| -------------- | ---- | ------------------- | ---- |
| Accessibility  | 88   | 100                 | +12  |
| Best Practices | 95   | 96                  | +1   |
| Performance    | 92   | 90                  | -2   |

A11y 满分主要来自 shadcn / Radix 的 aria 默认值: PopoverTrigger / DropdownMenuTrigger / Sheet 都自动注入 aria-expanded / aria-controls / aria-haspopup。

## 结论

**部分达标:**

- 桌面端全面提升 (Perf 98, LCP 1.08s, CLS 0)
- A11y 从 88 → 100 是显著增量
- TBT / CLS 维持或下降, hydration cost 没有失控

**Plan 红线 LCP ≤ 2.0s 在 mobile 上未达 (3.64s)**

可能修复路径(未实施, 留作后续优化任务):

- 把 next/font Inter 切到 `display: optional` 或减少 weights 子集
- 首页 server component 化 LCP 元素文本 (PostCard 标题), 移出 client island
- 关闭暗模式默认或推迟 ThemeProvider hydration
- 测真实环境 (移动设备 真实网络), 当前是 lighthouse 模拟节流

## 复现命令

```bash
# 1) 启动 API + Web (生产)
unset NODE_OPTIONS
pnpm --filter @bytedance-aigc/api dev &
pnpm --filter @bytedance-aigc/web build
PORT=3100 pnpm --filter @bytedance-aigc/web start &

# 2) 取样 (mobile preset 是默认)
npx lighthouse http://localhost:3100/login --quiet \
  --only-categories=performance,accessibility,best-practices \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=lh-login-mobile.json

npx lighthouse http://localhost:3100/ --quiet \
  --only-categories=performance,accessibility,best-practices \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=lh-home-mobile.json

# 3) Desktop preset 加 --preset=desktop
```
