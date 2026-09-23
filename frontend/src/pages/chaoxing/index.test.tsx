import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChaoxingPage } from "./index";
import { ConnectionError, connectionRequest } from "./api";

vi.mock("./api", async (original) => ({ ...await original<object>(), connectionRequest: vi.fn() }));
const request = vi.mocked(connectionRequest);
const session = { id: "session-1", connected: true, width: 1080, height: 720, remaining_seconds: 1000 };
const course = { id: "course-1", title: "Python 程序设计", readable: true };
const exam = { id: "exam-1", title: "期中考试", readable: true, submitted_count: 2 };
const candidate = { id: "candidate-1", name: "张三", student_no: "20260001", status: "submitted", readable: true };
const secondCandidate = { id: "candidate-2", name: "李四", student_no: "20260002", status: "submitted", readable: true };
const renderPage = () => render(<StrictMode><MemoryRouter><ChaoxingPage /></MemoryRouter></StrictMode>);

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path) => {
    if (path === "/capabilities") return { enabled: true, reason: "" };
    if (path === "/session") return session;
    if (path.endsWith("/courses")) return { items: [course], semesters: [], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/exams")) return { items: [exam], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/candidates")) return { items: [candidate, secondCandidate], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/review")) return { review_hash: "a".repeat(64), declared_max_score: 10, questions: [{ source_id: "q1", question_type: "名词解释题", content: "输出数字", student_answer: path.includes("candidate-2") ? "李四的回答" : "for n in range(3):\n    print(n)", reference_answer: "", max_score: 10, source_score: null, objective: false, requires_manual_review: true }], notice: "" };
    return undefined;
  });
});

describe("学习通连接验证", () => {
  it("在 StrictMode 下恢复连接，逐级读取答卷并保留程序缩进", async () => {
    renderPage();
    expect(await screen.findByText("Python 程序设计")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    expect(await screen.findByText("20260001")).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole("button", { name: "查看答卷" }))[0]);
    const answer = await screen.findByText(/for n in range/);
    expect(answer.textContent).toBe("for n in range(3):\n    print(n)");
    // 题目按题库统一口径展示：源站题型串 名词解释题 显示为题库的 简答题。
    expect(screen.getByText("简答题")).toBeInTheDocument();
    expect(screen.getByText("满分 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存答卷" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "保存答卷" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "AI 评分" })).toBeDisabled();
    expect(screen.getByText("含附件或识别信息不全，需要教师在学习通核对。")).toBeInTheDocument();
    expect(request.mock.calls.every(([path]) => !path.includes("submitmark"))).toBe(true);
  });

  it("考生列表进入按考生阅卷视图，支持题号定位和切换考生", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    expect(screen.getByRole("region", { name: "考生列表" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "查看答卷" })[0]);
    await screen.findByText(/for n in range/);
    expect(screen.getByRole("complementary", { name: "按考生阅卷导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "跳转第 1 题" })).toHaveAttribute("href", "#chaoxing-question-1");
    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(await screen.findByText("李四的回答")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回考生列表" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索考生" }), { target: { value: "20260001" } });
    expect(screen.queryByText("李四")).not.toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("同一课程列表中区分考试与作业", async () => {
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/exams")) return {
        items: [exam, { id: "work-1", title: "单元练习", item_type: "作业", submitted_count: 8, readable: true }],
        notice: "", complete: false,
      };
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    expect(await screen.findByText("单元练习")).toBeInTheDocument();
    expect(screen.getByText("作业")).toBeInTheDocument();
    expect(screen.getByText("期中考试")).toBeInTheDocument();
  });

  it("考生列表隐藏分页提示，批量评分处理全部已提交答卷且不受搜索筛选影响", async () => {
    const fallback = request.getMockImplementation()!;
    const other = { id: "candidate-3", name: "王五", student_no: "20260003", status: "unsubmitted", readable: false };
    const processed: string[] = [];
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/candidates")) return { items: [candidate, secondCandidate, other], expected_submitted: 2, notice: "当前为读取验证，尚未确认分页完整性；请与学习通核对人数和题目。", complete: false };
      if (path.endsWith("/review")) {
        processed.push(path);
        return { review_hash: "c".repeat(64), questions: [], declared_max_score: null, notice: "" };
      }
      if (path.endsWith("/import")) {
        expect(JSON.parse(String(init?.body))).toEqual({ review_hash: "c".repeat(64), completeness_confirmed: false });
        return { id: path.includes("candidate-1") ? "saved-1" : "saved-2" };
      }
      if (path.endsWith("/grade")) return { queued: path.includes("saved-1") ? 1 : 0 };
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    expect(screen.queryByText(/当前为读取验证/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索考生" }), { target: { value: "张三" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 评分" }));
    expect(await screen.findByText(/批量处理结束：2\/2 份/)).toBeInTheDocument();
    expect(screen.getByText(/已提交 AI 1 份（1 题）· 无新增评分任务 1 份 · 失败 0 份/)).toBeInTheDocument();
    expect(processed).toEqual([
      "/sessions/session-1/candidates/candidate-1/review",
      "/sessions/session-1/candidates/candidate-2/review",
    ]);
  });

  it("已读取名单少于考试已提交人数时禁用整场评分", async () => {
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/candidates")) return { items: [candidate], expected_submitted: 2, notice: "", complete: false };
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    expect(await screen.findByText("已读取 1 / 已提交 2 份答卷，名单未齐，暂不能批量评分。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 评分" })).toBeDisabled();
  });

  it("批量读取单份失败后继续处理下一份，并显示失败原因", async () => {
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("candidate-1/review")) throw new ConnectionError(502, "学习通答卷暂不可读");
      if (path.endsWith("candidate-2/review")) return { review_hash: "d".repeat(64), questions: [], declared_max_score: null };
      if (path.endsWith("/import")) return { id: "saved-2" };
      if (path.endsWith("/grade")) return { queued: 1 };
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    fireEvent.click(screen.getByRole("button", { name: "AI 评分" }));
    expect(await screen.findByText(/批量处理结束：2\/2 份/)).toBeInTheDocument();
    expect(screen.getByText(/失败 1 份/)).toBeInTheDocument();
    expect(screen.getByText(/张三：读取失败，学习通答卷暂不可读/)).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/grading/candidates/saved-2/grade", { method: "POST" });
  });

  it("核对后保存答卷并使用系统主观题评分接口，客观题不进入阅卷区", async () => {
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/review")) return {
        review_hash: "b".repeat(64), declared_max_score: 12, notice: "",
        questions: [
          { source_id: "q1", question_type: "单选题", content: "选择正确选项\nA. 甲\nB. 乙", student_answer: "B", reference_answer: "B", max_score: 2, source_score: 2, objective: true, requires_manual_review: false },
          { source_id: "q2", question_type: "简答题", content: "说明循环的用途", student_answer: "重复执行", reference_answer: "重复执行语句", max_score: 10, source_score: null, objective: false, requires_manual_review: false },
        ],
      };
      if (path.endsWith("/import")) {
        expect(JSON.parse(String(init?.body))).toEqual({ review_hash: "b".repeat(64), completeness_confirmed: true });
        return { id: "saved-1" };
      }
      if (path.endsWith("/grade")) return { queued: 1 };
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "查看答卷" }))[0]);
    expect(await screen.findByText("说明循环的用途")).toBeInTheDocument();
    expect(screen.queryByText("选择正确选项")).not.toBeInTheDocument();
    expect(screen.getByText(/客观题 1 题沿用学习通得分/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 评分" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "AI 评分" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/grading/candidates/saved-1/grade", { method: "POST" }));
    const paths = request.mock.calls.map(([path]) => path);
    expect(paths.indexOf("/sessions/session-1/candidates/candidate-1/import")).toBeLessThan(paths.indexOf("/grading/candidates/saved-1/grade"));
  });

  it("模型配置不可用时说明答卷已经保存、评分未启动", async () => {
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/review")) return { review_hash: "b".repeat(64), declared_max_score: 10, notice: "", questions: [
        { source_id: "q1", question_type: "简答题", content: "说明循环的用途", student_answer: "重复执行", reference_answer: "重复执行语句", max_score: 10, source_score: null, objective: false, requires_manual_review: false },
      ] };
      if (path.endsWith("/import")) return { id: "saved-1" };
      if (path.endsWith("/grade")) throw new Error("请管理员先配置主评和复核模型");
      return fallback(path, init);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "查看答卷" }))[0]);
    await screen.findByText("说明循环的用途");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "AI 评分" }));
    expect(await screen.findByText(/答卷已保存，但 AI 评分未启动：请管理员先配置主评和复核模型/)).toBeInTheDocument();
  });

  it("等待源站响应时，提示钉在屏幕中央并说明在读什么", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    request.mockImplementation(async path => {
      if (path === "/capabilities") return { enabled: true, reason: "" };
      if (path === "/session") return session;
      if (path.endsWith("/courses")) return { items: [course], semesters: [], notice: "", complete: false };
      if (path.endsWith("/exams")) return { items: [exam], notice: "", complete: false };
      if (path.endsWith("/candidates")) {
        await gate;
        return { items: [candidate], notice: "", complete: false };
      }
      return undefined;
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    // 提示不再趴在文档流里（列表下方），而是 fixed 满屏居中的浮层。
    const overlay = (await screen.findByText("正在读取考生名单")).closest(".pointer-events-none");
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain("fixed inset-0");
    expect(overlay!.className).toContain("items-center justify-center");
    release();
    await screen.findByText("20260001");
    await waitFor(() => expect(screen.queryByText("正在读取考生名单")).not.toBeInTheDocument());
  });

  it("源站会话失效时移除已有学生信息并要求重连", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试与作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    request.mockRejectedValueOnce(new ConnectionError(410, "学习通登录已失效，请重新连接"));
    fireEvent.click(screen.getAllByRole("button", { name: "查看答卷" })[0]);
    expect(await screen.findByText("学习通登录已失效，请重新连接")).toBeInTheDocument();
    expect(screen.queryByText("20260001")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接学习通" })).toBeEnabled();
  });

  it("明确禁用尚未部署的连接功能", async () => {
    request.mockImplementation(async path => path === "/capabilities" ? { enabled: false, reason: "管理员尚未启用学习通连接" } : null);
    renderPage();
    await screen.findByText("管理员尚未启用学习通连接");
    expect(screen.getByRole("button", { name: "连接学习通" })).toBeDisabled();
  });

  it("断开成功后清空连接和列表", async () => {
    renderPage();
    await screen.findByText("Python 程序设计");
    fireEvent.click(screen.getByRole("button", { name: "断开" }));
    await waitFor(() => expect(screen.queryByText("Python 程序设计")).not.toBeInTheDocument());
    expect(request).toHaveBeenCalledWith("/sessions/session-1", { method: "DELETE" });
    expect(screen.getByText("未连接")).toBeInTheDocument();
  });
});
