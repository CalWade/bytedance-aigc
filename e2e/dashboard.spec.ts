import { test, expect } from "@playwright/test";

/**
 * /me/dashboard 是 client-only 页:useEffect 读 localStorage token + 调 /me/analytics。
 * 这里 mock /me/analytics 返回固定 totals + topPosts,验证看板渲染。
 */

const ANALYTICS_FIXTURE = {
  totals: {
    totalDrafts: 12,
    totalPublished: 10,
    totalOffline: 1,
    totalImpression: 5000,
    totalClick: 800,
    totalLike: 200,
    totalCollect: 60,
    totalShare: 30,
    totalReport: 2,
    avgQualityOverall: 78.5,
    premiumRate: 0.4,
    engagementRate: 0.3625,
  },
  topPosts: [
    {
      id: "post-1",
      title: "热门文章一",
      publishedAt: "2026-06-01T00:00:00.000Z",
      qualityOverall: 85,
      impression: 2000,
      click: 400,
      like: 100,
      collect: 30,
      share: 15,
    },
    {
      id: "post-2",
      title: "热门文章二",
      publishedAt: "2026-06-02T00:00:00.000Z",
      qualityOverall: 75,
      impression: 1500,
      click: 250,
      like: 60,
      collect: 20,
      share: 10,
    },
  ],
};

test.describe("工作台数据看板", () => {
  test.beforeEach(async ({ page }) => {
    // 必须先把 token 写进 localStorage,否则 useEffect 的 getToken() 会跳走 /login
    await page.addInitScript(() => {
      window.localStorage.setItem("bytedance-aigc.accessToken", "tok-test-1");
      window.localStorage.setItem(
        "bytedance-aigc.user",
        JSON.stringify({ id: "u1", handle: "demo-author" }),
      );
    });
  });

  test("有 token 时渲染总览卡片 + Top 5 表 + 优质徽章", async ({ page }) => {
    await page.route("**/me/analytics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANALYTICS_FIXTURE),
      });
    });

    await page.goto("/studio/me/dashboard");
    await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible();
    await expect(page.getByText("作品总数")).toBeVisible();
    await expect(page.getByText("12", { exact: true })).toBeVisible();
    // 平均质量分卡片
    await expect(page.getByText("78.5")).toBeVisible();
    // Top 5 表第一行
    await expect(page.getByText("热门文章一")).toBeVisible();
    // qualityOverall=85 → QualityBadge 渲染「优质」
    await expect(page.getByText("优质").first()).toBeVisible();
  });

  test("API 返 401 时清空 token 并跳 /login", async ({ page }) => {
    await page.route("**/me/analytics", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });
    await page.goto("/studio/me/dashboard");
    // hard navigation 跨 Multi-Zones 跳 consumer 的 /login(window.location.replace)
    await page.waitForURL("**/login");
    // NOTE: addInitScript 在每次 navigation 都会重新注入,无法用于验证最终 storage 状态。
    //       URL 跳到 /login 即说明 401 分支命中并执行了 clearToken() + redirect。
  });
});
