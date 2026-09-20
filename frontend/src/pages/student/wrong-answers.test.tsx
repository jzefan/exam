import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";
import { render, screen } from "@/test/test-utils";

import { WrongAnswers } from "./wrong-answers";
import type { IWrongAnswer } from "./wrong-answer-shared";

const useListMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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
    last_wrong_at: "2026-09-10T02:00:00.000Z",
  }),
  buildItem({
    id: "p2",
    question_title: "数据库索引题",
    exam_id: "exam-db",
    exam_title: "数据库期末考试",
    exam_category: "exam",
    wrong_count: 2,
    last_wrong_at: "2026-09-11T02:00:00.000Z",
    remedial_practice_count: 2,
  }),
  buildItem({
    id: "p3",
    question_title: "SQL 查询练习",
    exam_id: "practice-sql",
    exam_title: "SQL 基础练习",
    exam_category: "practice",
    last_wrong_at: "2026-09-12T02:00:00.000Z",
  }),
  buildItem({
    id: "p4",
    question_title: "历史遗留错题",
    exam_id: null,
    exam_title: "历史考试",
    last_wrong_at: "2026-09-13T02:00:00.000Z",
  }),
];

function mockList(data: IWrongAnswer[], isLoading = false) {
  useListMock.mockReturnValue({
    query: {
      data: { data },
      isLoading,
    },
  });
}

describe("WrongAnswers", () => {
  it("groups wrong answers by exam/practice instead of listing them flat", () => {
    navigateMock.mockReset();
    mockList(items);

    render(
      <MemoryRouter>
        <WrongAnswers />
      </MemoryRouter>,
    );

    const rows = screen.getAllByRole("heading", { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual([
      "历史考试",
      "SQL 基础练习",
      "数据库期末考试",
    ]);

    // 同一场考试的两道错题聚合成一条，并带出错题数
    expect(screen.getByText(/2 道错题/)).toBeInTheDocument();
    expect(screen.queryByText("数据库范式题")).not.toBeInTheDocument();
  });

  it("labels each group with the exam/practice category", () => {
    mockList(items);

    render(
      <MemoryRouter>
        <WrongAnswers />
      </MemoryRouter>,
    );

    expect(screen.getByText("练习")).toBeInTheDocument();
    expect(screen.getAllByText("考试").length).toBe(2);
  });

  it("opens the wrong answers of the clicked exam/practice", async () => {
    navigateMock.mockReset();
    mockList(items);

    render(
      <MemoryRouter>
        <WrongAnswers />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: /SQL 基础练习/ }));

    expect(navigateMock).toHaveBeenCalledWith("/wrong-answers/exam/practice-sql");
  });

  it("keeps the mastered filter in the drill-down link", async () => {
    navigateMock.mockReset();
    mockList(items);

    render(
      <MemoryRouter initialEntries={["/wrong-answers?tab=mastered"]}>
        <WrongAnswers />
      </MemoryRouter>,
    );

    const calls = useListMock.mock.calls;
    const lastParams = calls[calls.length - 1]?.[0] as { filters?: Array<Record<string, unknown>> } | undefined;
    expect(lastParams?.filters?.[0]).toMatchObject({
      field: "mastered",
      value: true,
    });

    await userEvent.click(screen.getByRole("button", { name: /数据库期末考试/ }));

    expect(navigateMock).toHaveBeenCalledWith("/wrong-answers/exam/exam-db?tab=mastered");
  });

  it("shows the empty state when no exam or practice has wrong answers", () => {
    mockList([]);

    render(
      <MemoryRouter>
        <WrongAnswers />
      </MemoryRouter>,
    );

    expect(screen.getByText("暂无错题记录")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("marks the groups that already have generated practice sessions", () => {
    mockList(items);

    render(
      <MemoryRouter>
        <WrongAnswers />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 个强化练习")).toBeInTheDocument();
    expect(screen.getAllByText(/个强化练习/)).toHaveLength(1);
  });
});
