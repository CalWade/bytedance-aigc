/**
 * e2e 测试全局 setup — 在任何 testing module 加载前注入 fake LLM 配置。
 *
 * 为什么 e2e 需要这个:
 * - apps/api 的 AppModule 在 boot 期 instantiate LlmClient,LlmClient 构造函数
 *   通过 ConfigService.getOrThrow 读 LLM_BASE_URL/API_KEY/MODEL,缺失即抛(Plan D6)。
 * - e2e 流程**不真打 LLM**(plan 风险段:e2e 也要 mock LlmClient,不能让 CI 烧 key),
 *   所以这里塞 dummy 值只为让 boot 不挂;具体测试若要校验 LLM 行为,会
 *   `app.overrideProvider(LlmClient).useValue(...)` 替换 provider。
 * - CI 跑 e2e 时同样没有真实 LLM_API_KEY,这层 setup 保证任何环境都能起。
 */
process.env.LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://fake.e2e.invalid/v1";
process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? "sk-fake-e2e-key";
process.env.LLM_MODEL = process.env.LLM_MODEL ?? "fake-e2e-model";

// Phase 2.6 — admin 白名单。e2e 用独立 admin 用户(handle=admin),需在 boot 前注入。
process.env.ADMIN_HANDLES = process.env.ADMIN_HANDLES ?? "admin";

// Phase 2.9 — 资产存储用 mock,避免 e2e 真打 S3/MinIO。AssetsModule 工厂按 driver 分支选实现。
process.env.STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? "mock";
