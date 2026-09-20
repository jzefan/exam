import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@/test/test-utils";

import { WrongAnswerExamPage } from "./wrong-answer-exam";
import type { IRemedialPracticeAnalysis, IWrongAnswer } from "./wrong-answer-shared";

const useListMock = vi.fn();
const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

function buildItem(overrides: Partial<IWrongAnswer>): IWrongAnswer {
  return {
    id: "progress-1",
    question_id: "question-1",
    question_title: "默认题干",
    question_type: "choice",
    exam_id: "exam-1",
    exam_title: "默认考试",
    exam_category: "exam",
    wrong_count: 1,
    last_wrong_at: "2026-09-01T02:00:00.000Z",
    mastered_at: null,
    mastered: false,
    tags: [],
    ...overrides,
  };
}

const items: IWrongAnswer[] = [
  buildItem({
    id: "p1",
    question_title: "数据库范式题",
    exam_id: "exam-db",
    exam_title: "数据库期末考试",
    exam_category: "exam",
  }),
  buildItem({
    id: "p2",
    question_title: "数据库索引题",
    exam_id: "exam-db",
    exam_title: "数据库期末考试",
    exam_category: "exam",
  }),
  buildItem({
    id: "p3",
    question_title: "SQL 查询练习",
    exam_id: "practice-sql",
    exam_title: "SQL 基础练习",
    exam_category: "practice",
  }),
  buildItem({
    id: "p4",
    question_title: "历史遗留错题",
    exam_id: null,
    exam_title: "历史考试",
  }),
];

function buildAnalysis(overrides: Partial<IRemedialPracticeAnalysis> = {}): IRemedialPracticeAnalysis {
  return {
    source_exam_id: "exam-db",
    source_title: "数据库期末考试",
    source_category: "exam",
    wrong_question_count: 5,
    default_total_count: 10,
    max_total_count: 50,
    groups: [
      {
        key: "kp:a",
        knowledge_point_id: "a",
        name: "关系范式",
        path: "数据库 > 关系范式",
        wrong_question_count: 3,
        suggested_count: 6,
      },
      {
        key: "other",
        knowledge_point_id: null,
        name: "其他错题",
        path: null,
        wrong_question_count: 2,
        suggested_count: 4,
      },
    ],
    practices: [],
    ...overrides,
  };
}

function mockList(data: IWrongAnswer[], isLoading = false) {
  useListMock.mockReturnValue({
    query: {
      data: { data },
      isLoading,
    },
  });
}

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/wrong-answers/exam/:examId" element={<WrongAnswerExamPage />} />
        <Route path="/my-exams/:id/take" element={<div>练习进行中</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WrongAnswerExamPage", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiGetMock.mockResolvedValue({ data: buildAnalysis() });
  });

  it("lists every wrong answer of the opened exam", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/exam-db");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("数据库期末考试");
    expect(screen.getByText(/2 道错题/)).toBeInTheDocument();
    expect(screen.getByText("数据库范式题")).toBeInTheDocument();
    expect(screen.getByText("数据库索引题")).toBeInTheDocument();
    expect(screen.queryByText("SQL 查询练习")).not.toBeInTheDocument();
    expect(screen.queryByText("历史遗留错题")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        "/api/wrong-answers/practice-analysis/exam-db",
        expect.anything(),
      ),
    );
  });

  it("shows the practice category of the opened group", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/practice-sql");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("SQL 基础练习");
    expect(screen.getByText("练习")).toBeInTheDocument();
    expect(screen.getByText("SQL 查询练习")).toBeInTheDocument();
    expect(screen.queryByText("数据库范式题")).not.toBeInTheDocument();
    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());
  });

  it("keeps wrong answers without an exam together under the legacy group", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/legacy");

    expect(screen.getByText("历史遗留错题")).toBeInTheDocument();
    expect(screen.queryByText("数据库范式题")).not.toBeInTheDocument();
    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());
  });

  it("shows an empty state when the group has nothing left to review", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/exam-unknown");

    expect(screen.getByText("暂无错题记录")).toBeInTheDocument();
    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());
  });

  it("lists generated practice sessions with their status", async () => {
    mockList(items);
    apiGetMock.mockResolvedValue({
      data: buildAnalysis({
        practices: [
          {
            id: "practice-open",
            title: "数据库期末考试 · 错题强化练习",
            question_count: 6,
            duration_minutes: 12,
            created_at: "2026-09-19T02:00:00.000Z",
            started_at: null,
            submitted_at: null,
            score: null,
            total_score: 60,
          },
          {
            id: "practice-done",
            title: "数据库期末考试 · 错题强化练习（2）",
            question_count: 4,
            duration_minutes: 10,
            created_at: "2026-09-18T02:00:00.000Z",
            started_at: "2026-09-18T03:00:00.000Z",
            submitted_at: "2026-09-18T04:00:00.000Z",
            score: 30,
            total_score: 40,
          },
        ],
      }),
    });

    renderPage("/wrong-answers/exam/exam-db");

    expect(await screen.findByText("已生成的强化练习")).toBeInTheDocument();
    expect(screen.getByText("未开始")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText(/30 分/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /进入练习/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看结果/ })).toBeInTheDocument();
  });

  it("asks for the question count per knowledge point before generating", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/exam-db");

    await userEvent.click(await screen.findByRole("button", { name: /继续练习/ }));

    expect(await screen.findByText("关系范式")).toBeInTheDocument();
    expect(screen.getByText("其他错题")).toBeInTheDocument();
    // 默认 10 道，按错题数 3:2 分配
    expect(screen.getByText("共 10 道")).toBeInTheDocument();
    expect(screen.getByLabelText("关系范式 练习题目数")).toHaveValue(6);
    expect(screen.getByLabelText("其他错题 练习题目数")).toHaveValue(4);
  });

  it("keeps the total in sync when a knowledge point count is edited", async () => {
    mockList(items);

    renderPage("/wrong-answers/exam/exam-db");

    await userEvent.click(await screen.findByRole("button", { name: /继续练习/ }));

    const groupInput = await screen.findByLabelText("关系范式 练习题目数");
    await userEvent.clear(groupInput);
    await userEvent.type(groupInput, "3");

    expect(groupInput).toHaveValue(3);
    expect(screen.getByText("共 7 道")).toBeInTheDocument();
  });

  it("creates the practice and jumps straight into it", async () => {
    mockList(items);
    apiPostMock.mockResolvedValue({ data: { exam_id: "practice-new" } });

    renderPage("/wrong-answers/exam/exam-db");

    await userEvent.click(await screen.findByRole("button", { name: /继续练习/ }));
    await userEvent.click(await screen.findByRole("button", { name: /生成并开始练习/ }));

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith("/api/wrong-answers/practice", {
        source_exam_id: "exam-db",
        total_count: 10,
        allocations: [
          { group_key: "kp:a", count: 6 },
          { group_key: "other", count: 4 },
        ],
      }),
    );
    expect(await screen.findByText("练习进行中")).toBeInTheDocument();
  });

  it("hides the practice entry when nothing can be practised", async () => {
    mockList(items);
    apiGetMock.mockResolvedValue({ data: buildAnalysis({ groups: [], practices: [] }) });

    renderPage("/wrong-answers/exam/exam-db");

    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /继续练习/ })).not.toBeInTheDocument();
  });
});
