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
const exam = { id: "exam-1", title: "期中考试", readable: true, submitted_count: 1 };
const candidate = { id: "candidate-1", name: "张三", student_no: "20260001", status: "submitted", readable: true };
const renderPage = () => render(<StrictMode><MemoryRouter><ChaoxingPage /></MemoryRouter></StrictMode>);

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path) => {
    if (path === "/capabilities") return { enabled: true, reason: "" };
    if (path === "/session") return session;
    if (path.endsWith("/courses")) return { items: [course], semesters: [], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/exams")) return { items: [exam], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/candidates")) return { items: [candidate], notice: "尚未确认分页完整性", complete: false };
    if (path.endsWith("/review")) return { review_hash: "a".repeat(64), declared_max_score: 10, questions: [{ source_id: "q1", question_type: "名词解释题", content: "输出数字", student_answer: "for n in range(3):\n    print(n)", reference_answer: "", max_score: 10, source_score: null, objective: false, requires_manual_review: true }], notice: "" };
    return undefined;
  });
});

describe("学习通连接验证", () => {
  it("在 StrictMode 下恢复连接，逐级读取答卷并保留程序缩进", async () => {
    renderPage();
    expect(await screen.findByText("Python 程序设计")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "读取考试" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    expect(await screen.findByText("20260001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看答卷" }));
    const answer = await screen.findByText(/for n in range/);
    expect(answer.textContent).toBe("for n in range(3):\n    print(n)");
    // 题目按题库统一口径展示：源站题型串 名词解释题 显示为题库的 简答题。
    expect(screen.getByText("简答题")).toBeInTheDocument();
    expect(screen.getByText("满分 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存答卷并阅卷" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "保存答卷并阅卷" })).toBeEnabled();
    expect(screen.getByText("含附件或识别信息不全，需要教师在学习通核对。")).toBeInTheDocument();
    expect(request.mock.calls.every(([path]) => !path.includes("submitmark"))).toBe(true);
  });

  it("读取答卷后把答卷带到视口", async () => {
    // 答卷渲染在整张名单下面，不主动带过去就等于「点了没反应」。
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    fireEvent.click(screen.getByRole("button", { name: "查看答卷" }));
    await screen.findByText(/for n in range/);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("源站会话失效时移除已有学生信息并要求重连", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "读取考试" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取考生" }));
    await screen.findByText("20260001");
    request.mockRejectedValueOnce(new ConnectionError(410, "学习通登录已失效，请重新连接"));
    fireEvent.click(screen.getByRole("button", { name: "查看答卷" }));
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
