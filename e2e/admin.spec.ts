import { test, expect } from "@playwright/test";

/**
 * /studio/admin 导航 → /studio/admin/offline 直接下线表单。
 * studio zone 走 basePath=/studio,所以浏览器侧路径都带 /studio 前缀。
 *
 * RBAC mini (2026-06-11):admin/layout.tsx 客户端守卫读 user.role,
 * 非 ADMIN 会被 hard-nav 弹回 /studio/me/dashboard。所以注入的伪 user 必须带 role:"ADMIN"。
 * 后端 AdminGuard 兜底(本测试 mock 了响应,不实际打后端)。
 */

test.describe("admin 平台后台", () => {
  // RBAC mini:admin/layout.tsx 客户端守卫读 user.role,所有 case 都需要伪造 ADMIN user
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("bytedance-aigc.accessToken", "tok-admin");
      window.localStorage.setItem(
        "bytedance-aigc.user",
        JSON.stringify({ id: "u-admin", handle: "admin", role: "ADMIN" }),
      );
    });
  });

  test("/studio/admin 首页 → 点直接下线卡片跳到 /studio/admin/offline", async ({ page }) => {
    await page.goto("/studio/admin");
    await expect(page.getByRole("heading", { name: "平台管理后台" })).toBeVisible();
    await expect(page.getByText("举报工作台")).toBeVisible();
    await page.getByText("直接下线", { exact: true }).click();
    await page.waitForURL("**/studio/admin/offline");
    await expect(page.getByRole("heading", { name: "直接下线作品" })).toBeVisible();
  });

  test("/studio/admin/offline 表单提交成功后显示已下线提示", async ({ page }) => {
    await page.route("**/admin/drafts/*/offline", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/studio/admin/offline");
    await page.getByPlaceholder("例:pub000draft0000000000000000").fill("test-draft-id");
    await page.getByPlaceholder(/留空则使用默认/).fill("命中政策违规");
    await page.getByRole("button", { name: "确认下线" }).click();
    await expect(page.getByText(/已下线/)).toBeVisible();
  });

  test("/studio/admin/offline 后端返 400 时显示错误", async ({ page }) => {
    await page.route("**/admin/drafts/*/offline", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "ALREADY_OFFLINE", message: "该作品已下线" }),
      });
    });

    await page.goto("/studio/admin/offline");
    await page.getByPlaceholder("例:pub000draft0000000000000000").fill("test-draft-id");
    await page.getByRole("button", { name: "确认下线" }).click();
    await expect(page.getByText("该作品已下线")).toBeVisible();
  });
});
