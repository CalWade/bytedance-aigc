/**
 * Phase 1.3 fixtures · 统一工厂
 *
 * 用法:
 *   - prisma/seed.ts 调 applyAllFixtures(prisma) 把库灌成已知态
 *   - e2e spec 在 beforeAll 调同一函数,免得每个 spec 各自 deleteMany
 *
 * 删除顺序固定为:Report → Review → DraftVersion → Draft → Prompt → User
 *   FK 依赖:Report.postId → Draft、Report.reporterId → User、Review.draftId → Draft、
 *   DraftVersion.draftId → Draft、Draft.authorId → User、Prompt.authorId → User、
 *   Prompt.sourcePromptId → Prompt(自引用,SET NULL)
 *
 * 写入顺序反过来:User → Prompt → Draft → Review(回写 Draft.lastReviewId) → Report
 */
import { PrismaClient } from "@prisma/client";

import { DEMO_DRAFTS } from "./drafts";
import { PROMPT_STARTERS } from "./prompts";
import { applyReportFixtures, DEMO_REPORTS } from "./reports";
import { applyReviews } from "./reviews";
import { ADMIN_USER_ID, DEMO_AUTHOR_ID, DEMO_USERS } from "./users";

export { ADMIN_USER_ID, DEMO_AUTHOR_ID, DEMO_DRAFTS, DEMO_REPORTS, DEMO_USERS, PROMPT_STARTERS };

export interface FixtureSummary {
  users: number;
  prompts: number;
  drafts: number;
  reviews: number;
  reports: number;
}

export async function cleanupAllFixtures(prisma: PrismaClient): Promise<void> {
  // Draft.lastReviewId → Review FK,先解开避免 review.deleteMany 失败
  await prisma.draft.updateMany({ data: { lastReviewId: null } });
  await prisma.report.deleteMany();
  await prisma.review.deleteMany();
  await prisma.draftVersion.deleteMany();
  await prisma.postStat.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.prompt.deleteMany();
  await prisma.user.deleteMany();
}

export async function applyAllFixtures(prisma: PrismaClient): Promise<FixtureSummary> {
  await cleanupAllFixtures(prisma);

  const users = await prisma.user.createMany({ data: DEMO_USERS });
  const prompts = await prisma.prompt.createMany({ data: PROMPT_STARTERS });
  const drafts = await prisma.draft.createMany({ data: DEMO_DRAFTS });
  const reviewCount = await applyReviews(prisma);
  const reportCount = await applyReportFixtures(prisma);

  return {
    users: users.count,
    prompts: prompts.count,
    drafts: drafts.count,
    reviews: reviewCount,
    reports: reportCount,
  };
}
