/**
 * Phase 1.2 Prompt 库 seed
 * 策略:每次运行先清空 owner=PLATFORM 的内置款,再 createMany 9 条默认 starter
 * dev-only:本地反复跑总能回到"9 条默认款"的稳态
 * 生产 seed 应改 upsert + 业务键(Phase 1.4+)
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STARTERS: Prisma.PromptCreateManyInput[] = [
  {
    owner: "PLATFORM",
    tool: "REWRITE_FLUENT",
    name: "默认·改写更通顺",
    systemPrompt:
      "你是一名专业中文编辑。请在不改变原意的前提下,提升给定段落的流畅度与可读性,保留事实、人名、术语,不增加新信息。",
    params: { temperature: 0.4, topP: 0.9, maxTokens: 800 },
    fewShots: [
      {
        input: "这件事情吧,其实呢,是有点复杂的,涉及到很多的人和事。",
        output: "这件事比较复杂,牵涉的人和事都不少。",
      },
    ],
    designNote: `用于"快速稿"中段落级流畅度修复;不允许增删事实,只动表达。`,
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "EXPAND",
    name: "默认·扩写补充",
    systemPrompt:
      "你是一名内容编辑。请基于给定段落补充背景、细节或例子,使内容更充实,但不得引入未经验证的事实。如需举例请明确标注为示例。",
    params: { temperature: 0.6, topP: 0.9, maxTokens: 1200 },
    fewShots: [
      {
        input: "AI 写作正在改变编辑工作流。",
        output:
          "AI 写作正在改变编辑工作流:从前期选题、到中期初稿,再到后期质检,大量原本由人逐字处理的环节,正在被 LLM 与编辑工具的组合接管。例如,头条编辑团队反馈,引入 AI 协作后单篇平均成稿时间下降约 40%(数据示例,以实际为准)。",
      },
    ],
    designNote: `扩写最容易"造假",prompt 显式禁止引入未经验证事实,并要求示例标注。`,
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "TRANSFORM_STYLE",
    name: "默认·风格转换",
    systemPrompt: `请把给定段落改写为目标风格(由用户在 input 中提供"目标风格"字段),保留事实与逻辑,只调整语气、句式与措辞。`,
    params: { temperature: 0.5, topP: 0.9, maxTokens: 1000 },
    fewShots: [
      {
        input: { 段落: "公司发布了新产品。", 目标风格: "活泼" },
        output: "公司新产品来啦!",
      },
    ],
    designNote: `目标风格是结构化输入而不是自然语言,降低"听不懂用户的风格描述"导致的偏差。`,
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "HEADLINE_SUB",
    name: "默认·副标题生成",
    systemPrompt:
      "你是头条副标题写手。请基于正文生成 1 个不超过 25 字的副标题,要求点出核心信息差,不剧透结尾,不使用煽动性词汇(震惊、紧急等)。",
    params: { temperature: 0.7, topP: 0.9, maxTokens: 80 },
    fewShots: [
      {
        input: "5G-A 技术在 2026 年开始大规模商用,运营商部署成本下降 30%...",
        output: "5G-A 商用启动:运营商成本砍三成的关键变化",
      },
    ],
    designNote: "禁用煽动词是平台合规要求,在 prompt 而非 post-审核 拦最便宜。",
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "HEADLINE_NEW",
    name: "默认·主标题重写",
    systemPrompt: `请基于正文重写主标题,要求 12-22 字,信息密度高,具体可证伪。禁止疑问句、禁止使用"震惊体"。`,
    params: { temperature: 0.7, topP: 0.9, maxTokens: 60 },
    fewShots: [
      {
        input: "正文:某公司在内部信中宣布裁员 5%...",
        output: "某公司内部信:裁员 5% 涉及哪些岗位",
      },
    ],
    designNote: "标题最容易触发审核切面,prompt 端先约束;后端审核 prompt 在 §4.7,不在本步范围。",
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "REWRITE_OPENING",
    name: "默认·重写开头",
    systemPrompt: `请重写文章开头第一段,要求:在 80 字内交代背景 + 抛出核心冲突或信息差,不使用"近日""日前"等空洞时间词。`,
    params: { temperature: 0.6, topP: 0.9, maxTokens: 200 },
    fewShots: [
      {
        input: "近日,有报道指出某平台修改了推荐算法...",
        output:
          "某平台 5 月底悄悄换了推荐算法,几名头部创作者的曝光量在一周内掉到不到原来的三成——这次改了什么?",
      },
    ],
    designNote: "训练集开头质量决定打开率,prompt 显式禁用空洞时间词是直接来自头条编辑规范。",
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "ADD_FACTS",
    name: "默认·补事实",
    systemPrompt: `请在不改变原立场的前提下,为段落补充 1-2 个具体可核查的事实(数据 / 时间 / 地点 / 人物职务)。如果没有可补充的事实,请输出"无可信补充事实"。`,
    params: { temperature: 0.3, topP: 0.85, maxTokens: 600 },
    fewShots: [
      {
        input: "新能源车销量近期增长很快。",
        output:
          "新能源车销量近期增长很快——根据中汽协 2026 年 4 月数据,中国新能源乘用车单月销量约 95 万辆,同比增长 35%。",
      },
    ],
    designNote: `本工具最容易造假,prompt 留了"无可信补充事实"的退出口,降低 LLM 编造数据的压力。`,
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "ADD_TOPIC",
    name: "默认·扩展话题",
    systemPrompt:
      "基于给定段落,推荐 3 个相关延伸话题(每个 ≤15 字),要求与原文核心相关、可独立成段、不重复原文已覆盖的角度。",
    params: { temperature: 0.7, topP: 0.9, maxTokens: 200 },
    fewShots: [
      {
        input: "讨论了远程办公的工具选型。",
        output:
          "1. 远程协作的异步沟通最佳实践\n2. 跨时区团队的会议节奏设计\n3. 远程团队的绩效评估痛点",
      },
    ],
    designNote: "扩展话题输出结构化(编号 + 短句),便于前端做 chip 选择 UI。",
    isStarter: true,
  },
  {
    owner: "PLATFORM",
    tool: "IMAGE_SUGGEST",
    name: "默认·配图建议",
    systemPrompt: `请基于段落内容,给出 2 个配图描述(每个 ≤30 字),用于 AI 生图或图库检索。要求:具体场景化、避免抽象概念词、避免人物肖像版权风险(用"商务人士背影"替代具体人物)。`,
    params: { temperature: 0.6, topP: 0.9, maxTokens: 200 },
    fewShots: [
      {
        input: "讨论了开放式办公区的效率问题。",
        output:
          "1. 现代开放式办公区,工程师在工位戴耳机专注工作\n2. 玻璃会议室内白板上贴满便利贴的特写",
      },
    ],
    designNote: "肖像版权约束是合规条款,放在 prompt 比放在审核环节便宜。",
    isStarter: true,
  },
];

async function main(): Promise<void> {
  console.log("[seed] 清空 owner=PLATFORM, isStarter=true 的内置款...");
  await prisma.prompt.deleteMany({
    where: { owner: "PLATFORM", isStarter: true },
  });

  console.log(`[seed] 写入 ${STARTERS.length} 条默认 starter prompt...`);
  const result = await prisma.prompt.createMany({ data: STARTERS });
  console.log(`[seed] 完成:created=${result.count}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
