import { expect, test } from "@playwright/test";

test("学习通图片公式与附件：读取和保存答卷", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-only-token");
    localStorage.setItem("user", JSON.stringify({ id: "teacher", username: "teacher", persona: "teacher", primary_org: { role_name: "teacher" }, organizations: [{ role_name: "teacher" }] }));
  });
  const question = {
    id: "q", source_id: "q", position: 1, question_type: "其它", content: "", student_answer: "if x < 2:\n    print(x)", reference_answer: "", max_score: 100, source_score: null, objective: false, requires_manual_review: true,
    rich_content: {
      content: [{ kind: "image", name: "题干图片", asset_id: "stem" }, { kind: "text", text: String.raw`计算 \(x^2 + y^2\)` }],
      student_answer: [{ kind: "image", name: "作答截图", asset_id: "answer" }, { kind: "file", name: "lesson2.py", asset_id: "code", preview: "if x < 2:\n    print(x)" }],
    },
    status: "manual", version: 1, ai_score: null, confirmed_score: null, comment: "", error: "", feedback: null,
  };
  const totals = { question_count: 1, resolved_count: 0, objective_score: 0, ai_subjective_score: 0, ai_graded_count: 0, confirmed_subtotal: 0, final_score: null, max_score: 100, declared_max_score: 100, score_mismatch: false };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path.includes("/media/")) {
      expect(route.request().headers().authorization).toBe("Bearer test-only-token");
      if (path.endsWith("/code")) return route.fulfill({ contentType: "application/octet-stream", body: question.student_answer });
      return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEn8AAAAASUVORK5CYII=", "base64") });
    }
    if (path.endsWith("/capabilities")) json = { enabled: true };
    else if (path.endsWith("/session")) json = { id: "s", connected: true, width: 1080, height: 720, remaining_seconds: 7200 };
    else if (path.endsWith("/courses")) json = { items: [{ id: "course", title: "Python程序设计", readable: true }], semesters: [] };
    else if (path === "/api/chaoxing/grading/exams") json = [{ id: "exam", title: "课堂作业", course_title: "Python程序设计", candidates: [{ id: "saved", name: "测试学生", student_no: "001", revision: 1, totals }] }];
    else if (path.endsWith("/exams")) json = { items: [{ id: "exam", title: "课堂作业", item_type: "作业", readable: true }] };
    else if (path === "/api/chaoxing/grading/candidates/saved") json = { id: "saved", exam_id: "exam", name: "测试学生", student_no: "001", exam_title: "课堂作业", course_title: "Python程序设计", revision: 1, current_revision: 1, items: [question], totals, audit: [] };
    else if (path.endsWith("/candidates")) json = { items: [{ id: "candidate", name: "测试学生", student_no: "001", status: "submitted", readable: true }] };
    else if (path.endsWith("/review")) json = { review_hash: "a".repeat(64), declared_max_score: 100, questions: [question] };
    else if (path.includes("unread-count")) json = { count: 0 };
    else if (path.includes("notification")) json = [];
    await route.fulfill({ json });
  });
  await page.goto("/grading/chaoxing");
  await page.getByRole("button", { name: "读取考试与作业" }).click();
  await page.getByRole("button", { name: "读取考生" }).click();
  await page.getByRole("button", { name: "查看答卷" }).click();
  const checkContent = async () => {
    const stem = page.getByRole("button", { name: "预览图片：题干图片" });
    await expect(stem).toBeVisible();
    await expect.poll(() => stem.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator(".katex")).toHaveCount(1);
    await expect(page.locator("pre")).toHaveText(question.student_answer);
    await expect(page.getByRole("button", { name: "预览图片：作答截图" })).toBeVisible();
    await stem.click();
    await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
    await page.getByRole("button", { name: "关闭图片预览" }).click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "lesson2.py · 下载" }).click();
    expect((await downloadEvent).suggestedFilename()).toBe("lesson2.py");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  await checkContent();
  await page.goto("/grading/chaoxing/results?candidate=saved");
  await checkContent();
  await page.screenshot({ path: test.info().outputPath("chaoxing-media.png"), fullPage: true });
  expect(errors).toEqual([]);
});
