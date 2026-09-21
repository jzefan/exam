import { expect, test } from "@playwright/test";

test("免安装连接交互、逐级读取与断开（模拟源站）", async ({ page }) => {
  let connected = false;
  let exists = false;
  const actions: Record<string, unknown>[] = [];
  const session = () => ({ id: "session", connected, width: 1080, height: 720, remaining_seconds: 7200 });
  const listing = (items: object[]) => ({ items, complete: false, notice: "尚未确认分页完整性，请与学习通核对。" });
  const courses = { ...listing([{ id: "course", title: "Python 程序设计", readable: true }]), semesters: [] };
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "test-only-token");
    localStorage.setItem("user", JSON.stringify({
      id: "teacher", full_name: "测试教师", username: "teacher", persona: "teacher",
      primary_org: { role_name: "teacher" }, organizations: [{ role_name: "teacher" }],
    }));
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: unknown = {};
    if (path.endsWith("/capabilities")) json = { enabled: true, reason: "" };
    else if (path === "/api/chaoxing/session") json = exists ? session() : null;
    else if (path === "/api/chaoxing/sessions" && method === "POST") { exists = true; json = session(); }
    else if (path.endsWith("/frame")) {
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="720"><rect width="1080" height="720" fill="white"/><text x="160" y="120" fill="black">学习通模拟登录页</text><rect x="160" y="160" width="400" height="60" fill="#eee"/></svg>' });
    } else if (path.endsWith("/actions")) {
      actions.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    } else if (path.endsWith("/verify")) { connected = true; json = { session: session(), ...courses }; }
    else if (path.endsWith("/courses")) json = courses;
    else if (path.endsWith("/exams")) json = listing([{ id: "exam", title: "期中考试", submitted_count: 1, readable: true }]);
    else if (path.endsWith("/candidates")) json = listing([{ id: "candidate", name: "张三", student_no: "20260001", status: "submitted", readable: true }]);
    else if (path.endsWith("/review")) json = { questions: [{ source_id: "q1", question_type: "编程题", content: "输出数字", student_answer: "for n in range(3):\n    print(n)", reference_answer: "", max_score: 10, source_score: null, requires_manual_review: false }], notice: "" };
    else if (path === "/api/chaoxing/sessions/session" && method === "DELETE") { exists = false; return route.fulfill({ status: 204 }); }
    else if (path.includes("unread-count")) json = { count: 0 };
    else if (path.includes("notification")) json = [];
    await route.fulfill({ json });
  });
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto("/grading/chaoxing");
  await page.getByRole("button", { name: "连接学习通", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByAltText("学习通官方登录页面的实时画面")).toBeVisible();
  const surface = page.getByRole("group", { name: "学习通远程登录页面" });
  await surface.click({ position: { x: 100, y: 100 } });
  await page.getByLabel("学习通远程键盘输入").pressSequentially("demo");
  await expect(page.getByText("键盘输入已激活，可直接输入学习通账号或密码")).toBeVisible();
  await expect.poll(() => actions.length).toBeGreaterThan(1);
  expect(actions[0].kind).toBe("pointer");
  await expect.poll(() => actions.filter(a => a.kind === "text").map(a => a.text).join("")).toBe("demo");
  await page.getByRole("button", { name: "已完成登录，验证连接" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "读取考试" }).click();
  await page.getByRole("button", { name: "读取考生" }).click();
  await expect(page.getByText("20260001", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看答卷" }).click();
  const answer = page.locator("pre").first();
  await expect(answer).toHaveText("for n in range(3):\n    print(n)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("chaoxing-review.png"), fullPage: true });
  await page.getByRole("button", { name: "断开", exact: true }).click();
  await expect(page.getByText("20260001", { exact: true })).not.toBeVisible();
  await expect(page.getByText("未连接", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("保存答卷、AI评分、教师确认及导出（模拟模型）", async ({ page }) => {
  const user = { id: "teacher", full_name: "测试教师", username: "teacher", persona: "teacher", primary_org: { role_name: "teacher" }, organizations: [{ role_name: "teacher" }] };
  await page.addInitScript(user => { localStorage.setItem("access_token", "test-only-token"); localStorage.setItem("user", JSON.stringify(user)); }, user);
  const item = { id: "q1", position: 1, question_type: "简答题", content: "解释循环", student_answer: "重复执行", reference_answer: "重复执行语句", max_score: 2.5, objective: false, source_score: null, ai_score: null as number | null, confirmed_score: null as number | null, status: "pending", version: 1, comment: "", error: "", requires_manual_review: false, feedback: null as object | null };
  const totals = { question_count: 1, resolved_count: 0, objective_score: 0, ai_subjective_score: 0, ai_graded_count: 0, confirmed_subtotal: 0, final_score: null as number | null, max_score: 2.5, declared_max_score: 2.5, score_mismatch: false };
  const paper = { id: "c1", exam_id: "e1", name: "张三", student_no: "0001", exam_title: "期中考试", course_title: "程序设计", revision: 1, current_revision: 1, source_score: null, items: [item], totals, audit: [] };
  let gradeCalls = 0;
  let queuedReads = 0;
  let imported = false;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path.endsWith("/capabilities")) json = { enabled: true, reason: "" };
    else if (path.endsWith("/session")) json = { id: "s1", connected: true, width: 1080, height: 720, remaining_seconds: 7200 };
    else if (path.endsWith("/courses")) json = { items: [{ id: "co1", title: "程序设计", readable: true }] };
    else if (path === "/api/chaoxing/grading/exams") json = [{ id: "e1", title: "期中考试", course_title: "程序设计", expected_submitted: 10, candidates: [{ id: "c1", name: "张三", student_no: "0001", totals }] }];
    else if (path.endsWith("/exams")) json = { items: [{ id: "e1", title: "期中考试", readable: true }] };
    else if (path.endsWith("/candidates")) json = { items: [{ id: "c1", name: "张三", student_no: "0001", status: "submitted", readable: true }] };
    else if (path.endsWith("/review")) json = { questions: [{ ...item, source_id: "q1" }], review_hash: "a".repeat(64), declared_max_score: 2.5 };
    else if (path.endsWith("/import")) { expect(route.request().postDataJSON()).toEqual({ review_hash: "a".repeat(64), completeness_confirmed: true }); imported = true; json = { id: "c1", revision: 1 }; }
    else if (path.endsWith("/grade")) { gradeCalls++; item.status = "queued"; item.version++; json = { queued: 1 }; }
    else if (path.endsWith("/confirm")) {
      expect(route.request().postDataJSON()).toEqual({ version: item.version, score: 2.4, reason: "复核通过" });
      item.confirmed_score = 2.4; item.status = "confirmed"; item.version++;
      totals.final_score = 2.4; totals.confirmed_subtotal = 2.4; totals.resolved_count = 1; json = paper;
    } else if (path.endsWith("/grading/candidates/c1")) {
      expect(imported).toBe(true);
      if (item.status === "queued" && ++queuedReads >= 2) {
        item.status = "review"; item.ai_score = 2.25; item.version++;
        item.feedback = { dimension_comments: { correctness: "基本正确" }, deduction_reasons: ["未说明条件"], strengths: [], improvement_suggestions: [], risk_flags: [] };
        totals.ai_subjective_score = 2.25; totals.ai_graded_count = 1;
      }
      json = paper;
    } else if (path.endsWith("/export")) return route.fulfill({ contentType: "text/csv", headers: { "Content-Disposition": 'attachment; filename="grades.csv"' }, body: "姓名,学号,最终成绩\n张三,'0001,2.4\n" });
    else if (path.includes("unread-count")) json = { count: 0 };
    else if (path.includes("notification")) json = [];
    await route.fulfill({ json });
  });
  await page.goto("/grading/chaoxing");
  await page.getByRole("button", { name: "读取考试" }).click();
  await page.getByRole("button", { name: "读取考生" }).click();
  await page.getByRole("button", { name: "查看答卷" }).click();
  await expect(page.getByRole("button", { name: "保存答卷并阅卷" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "保存答卷并阅卷" }).click();
  await expect(page).toHaveURL(/results\?candidate=c1/);
  await page.getByRole("button", { name: "AI 评分", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 评分", exact: true })).toBeDisabled();
  await expect(page.getByText("待教师确认", { exact: true })).toBeVisible();
  expect(gradeCalls).toBe(1);
  await expect(page.getByText("最终成绩 待确认", { exact: true })).toBeVisible();
  await page.getByLabel("第 1 题确认分数").fill("2.4");
  await page.getByLabel("第 1 题评语").fill("复核通过");
  await page.getByRole("button", { name: "确认分数", exact: true }).click();
  await expect(page.getByText("最终成绩 2.4", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("chaoxing-grading.png"), fullPage: true });
  await page.getByRole("link", { name: "返回", exact: true }).click();
  await expect(page.getByText("已保存 1 份 / 学习通已提交 10 份")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出成绩" }).click();
  expect((await downloaded).suggestedFilename()).toBe("学习通评分.csv");
  expect(errors).toEqual([]);
});
