import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChaoxingResultsPage } from "./results";
import { ConnectionError, connectionRequest } from "./api";
import type { SavedPaper } from "./api";

vi.mock("./api", async original => ({ ...await original<object>(), connectionRequest: vi.fn() }));
const request = vi.mocked(connectionRequest);
let paper: SavedPaper;
const renderPage = (url = "/grading/chaoxing/results?candidate=c1") => render(<StrictMode><MemoryRouter initialEntries={[url]}><ChaoxingResultsPage /></MemoryRouter></StrictMode>);
beforeEach(() => {
  request.mockReset();
  paper = {
    id: "c1", exam_id: "e1", name: "张三", student_no: "0001", exam_title: "期中", course_title: "计算机基础",
    revision: 1, current_revision: 1, source_score: 0, audit: [],
    totals: { question_count: 1, resolved_count: 0, objective_score: 0, ai_subjective_score: 2.25, ai_graded_count: 1, confirmed_subtotal: 0, final_score: null, max_score: 2.5, declared_max_score: 2.5, score_mismatch: false },
    items: [{ id: "q1", position: 1, question_type: "简答题", content: "循环的用途", student_answer: "重复执行", reference_answer: "重复执行语句", max_score: 2.5, objective: false, source_score: 0, ai_score: 2.25, confirmed_score: null, status: "review", version: 3, comment: "", error: "", requires_manual_review: false, feedback: { dimension_comments: { correctness: "基本正确" }, deduction_reasons: [], strengths: [], improvement_suggestions: [], risk_flags: [] } }],
  };
  request.mockImplementation(async path => {
    if (path === "/grading/exams") return [{ id: "e1", title: "期中", course_title: "计算机基础", expected_submitted: 10, candidates: [{ id: "c1", name: "张三", student_no: "0001", totals: paper.totals }] }];
    return structuredClone(paper);
  });
});

describe("学习通结果复核", () => {
  it("不依赖源站会话显示结果，小数确认分保存后才形成最终成绩", async () => {
    renderPage();
    const input = await screen.findByLabelText("第 1 题确认分数");
    expect(input).toHaveValue(2.25);
    expect(screen.getByText("最终成绩 待确认")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "2.4" } });
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/confirm")) {
        expect(JSON.parse(String(init?.body))).toEqual({ version: 3, score: 2.4, reason: "" });
        paper.items[0].confirmed_score = 2.4; paper.items[0].status = "confirmed"; paper.items[0].version = 4;
        paper.totals!.final_score = 2.4;
      }
      return structuredClone(paper);
    });
    fireEvent.click(screen.getByRole("button", { name: "确认分数" }));
    expect(await screen.findByText("最终成绩 2.4")).toBeInTheDocument();
    expect(request.mock.calls.every(([path]) => !path.includes("/sessions"))).toBe(true);
  });
  it("拦截超出满分的输入，并显示并发状态冲突", async () => {
    renderPage();
    const input = await screen.findByLabelText("第 1 题确认分数");
    fireEvent.change(input, { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "确认分数" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2" } });
    request.mockRejectedValueOnce(new ConnectionError(409, "分数状态已更新，请刷新后再确认"));
    fireEvent.click(screen.getByRole("button", { name: "确认分数" }));
    expect(await screen.findByText("分数状态已更新，请刷新后再确认")).toBeInTheDocument();
    expect(screen.getByText("最终成绩 待确认")).toBeInTheDocument();
  });
  it("题目按题库口径展示，客观题沿用学习通得分不送 AI", async () => {
    paper.items[0].question_type = "名词解释题";
    paper.items.push({ ...paper.items[0], id: "q2", position: 2, question_type: "单选题", objective: true, status: "source", source_score: 2.5, confirmed_score: null, ai_score: null });
    paper.totals!.question_count = 2;
    renderPage();
    // 源站的「名词解释题」在题库口径下就是「简答题」，展示随题库统一。
    expect(await screen.findByText("简答题")).toBeInTheDocument();
    expect(screen.getAllByText("满分 2.5")).toHaveLength(2);
    // 客观题的学习通得分直接可用，且不会被排队给模型。
    expect(screen.getByText("沿用学习通客观分")).toBeInTheDocument();
    expect(screen.getByText("AI 只评主观题（简答、论述、编程），客观题沿用学习通得分；点开题目可看参考答案。")).toBeInTheDocument();
  });
  it("历史版本不允许评分或确认", async () => {
    paper.current_revision = 2; paper.totals = null;
    renderPage("/grading/chaoxing/results?candidate=c1&revision=1");
    await screen.findByText("历史版本，仅供查看。");
    expect(screen.queryByRole("button", { name: "AI 评分" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("第 1 题确认分数")).not.toBeInTheDocument();
  });
  it("明确区分保存份数和源站总人数", async () => {
    renderPage("/grading/chaoxing/results");
    expect(await screen.findByText("已保存 1 份 / 学习通已提交 10 份")).toBeInTheDocument();
    expect(screen.getByText("待确认")).toBeInTheDocument();
  });
  it("评分排队时阻止重复提交并轮询到结果", async () => {
    paper.items[0].status = "pending"; paper.items[0].ai_score = null;
    request.mockImplementation(async path => {
      if (path.endsWith("/grade")) { paper.items[0].status = "queued"; return { queued: 1 }; }
      return structuredClone(paper);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "AI 评分" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "AI 评分" })).toBeDisabled());
    paper.items[0].status = "review"; paper.items[0].ai_score = 2.25; paper.items[0].version += 1;
    expect(await screen.findByText("待教师确认", {}, { timeout: 3500 })).toBeInTheDocument();
    expect(request.mock.calls.filter(([path]) => path.endsWith("/grade"))).toHaveLength(1);
  });
});
