import { expect, test } from "@playwright/test"

const MODEL_ID = "test-model-1"
const VERSION_ID = "test-version-1"
const EDITOR_URL = `/gwmx/job-models/${MODEL_ID}/versions/${VERSION_ID}/editor`

test.describe("岗位模型编辑器", () => {
  test.beforeEach(async ({ page }) => {
    // 这里仍然假设测试环境里已经准备好了一个可访问的编辑器用例数据。
    await page.goto(EDITOR_URL)
    await page.waitForURL("**/editor")
  })

  test("桌面端显示编辑器基础框架", async ({ page }) => {
    await expect(page.getByRole("button", { name: "切换到树形视图" })).toBeVisible()
    await expect(page.getByRole("button", { name: "切换到图形视图" })).toBeVisible()
    await expect(page.getByTestId("tree-panel")).toBeVisible()
    await expect(page.getByTestId("status-bar")).toBeVisible()
    await expect(page.getByTestId("version-badge")).toContainText(/v\d+/)
  })

  test("可切换到图形视图", async ({ page }) => {
    await page.getByRole("button", { name: "切换到图形视图" }).click()
    await expect(page.getByTestId("graph-panel").first()).toBeVisible()
  })
})

test.describe("岗位模型编辑器响应式", () => {
  test("移动端隐藏左侧树面板", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(EDITOR_URL)
    await page.waitForURL("**/editor")

    const isHidden = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='tree-panel']")
      return el ? window.getComputedStyle(el).display === "none" : false
    })

    expect(isHidden).toBe(true)
    await expect(page.getByTestId("status-bar")).toBeVisible()
  })
})
