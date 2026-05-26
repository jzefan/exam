/**
 * Mobile exam-taking E2E tests.
 *
 * These tests rely on a running backend. In CI they are skipped unless
 * ENABLE_MOBILE_E2E=1 is set, because they require a seeded database.
 *
 * Scenarios:
 *  1. Login → dashboard → start exam → answer → offline → reconnect → submit → result
 *  2. Refresh during exam → recovery banner → apply all → continue → submit
 *  3. Submit while offline → button disabled, banner explains
 */

import { expect, test } from "@playwright/test";

const SKIP = !process.env.ENABLE_MOBILE_E2E;

test.describe("考生移动端答题流程", () => {
  test.skip(SKIP, "Set ENABLE_MOBILE_E2E=1 to run these tests against a live backend");

  /**
   * Helper: log in via the login form and navigate to the exam taking page.
   */
  async function loginAndStartExam(
    page: import("@playwright/test").Page,
    { username, password, examId }: { username: string; password: string; examId: string },
  ) {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/(student|dashboard)**");
    await page.goto(`/student/exam/${examId}`);
  }

  test("完整答题提交流程", async ({ page, context }) => {
    // This test requires STUDENT_USERNAME, STUDENT_PASSWORD, EXAM_ID env vars.
    const username = process.env.STUDENT_USERNAME ?? "student";
    const password = process.env.STUDENT_PASSWORD ?? "password";
    const examId = process.env.EXAM_ID ?? "test-exam-id";

    await loginAndStartExam(page, { username, password, examId });

    // Wait for exam to load
    await expect(page.locator("text=第 1 题")).toBeVisible({ timeout: 15000 });

    // Answer first question (choose first option if choice type)
    const firstOption = page.locator("[data-type=choice] button, input[type=radio]").first();
    if (await firstOption.isVisible()) {
      await firstOption.click();
    }

    // Simulate going offline
    await context.setOffline(true);

    // Offline indicator should show in submit sheet
    await page.locator('[aria-label="题目地图"], button:has-text("题目地图")').first().click();
    await page.locator('button:has-text("提交")').last().click();

    await expect(page.locator("text=当前处于离线状态")).toBeVisible({ timeout: 5000 });
    const submitBtn = page.locator('button:has-text("提交考试")');
    await expect(submitBtn).toBeDisabled();

    // Reconnect
    await context.setOffline(false);
    await page.waitForTimeout(2500); // 2s debounce + buffer

    // Submit button should be enabled again
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await submitBtn.click();

    // Redirects to result
    await page.waitForURL("**/result**", { timeout: 15000 });
  });

  test("刷新后草稿恢复流程", async ({ page }) => {
    const username = process.env.STUDENT_USERNAME ?? "student";
    const password = process.env.STUDENT_PASSWORD ?? "password";
    const examId = process.env.EXAM_ID ?? "test-exam-id";

    await loginAndStartExam(page, { username, password, examId });
    await expect(page.locator("text=第 1 题")).toBeVisible({ timeout: 15000 });

    // Inject a fake local draft diverging from server
    await page.evaluate((eid) => {
      const user = JSON.parse(localStorage.getItem("user") ?? "{}") as { id?: string };
      const pid = user.id ?? "test-user";
      const key = `exam-draft:${pid}:${eid}`;
      const draft = {
        answers: { "test-q-001": { text: "本地草稿答案" } },
        last_local_save_ms: Date.now(),
        attempt_id: eid,
        principal_id: pid,
      };
      localStorage.setItem(key, JSON.stringify(draft));
    }, examId);

    // Reload to trigger recovery banner
    await page.reload();
    await expect(page.locator("text=在此设备上找到")).toBeVisible({ timeout: 15000 });

    // Click "全部恢复"
    await page.locator('button:has-text("全部恢复")').click();

    // Banner disappears
    await expect(page.locator("text=在此设备上找到")).not.toBeVisible({ timeout: 5000 });
  });

  test("离线时提交按钮被禁用且有说明", async ({ page, context }) => {
    const username = process.env.STUDENT_USERNAME ?? "student";
    const password = process.env.STUDENT_PASSWORD ?? "password";
    const examId = process.env.EXAM_ID ?? "test-exam-id";

    await loginAndStartExam(page, { username, password, examId });
    await expect(page.locator("text=第 1 题")).toBeVisible({ timeout: 15000 });

    // Go offline
    await context.setOffline(true);

    // Open submit sheet
    await page.locator('button:has-text("提交")').last().click();

    await expect(page.locator("text=当前处于离线状态")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("提交考试")')).toBeDisabled();
  });
});
