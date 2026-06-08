import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { WrongAnswerDetailPage } from "./wrong-answer-detail";

const { useOneMock, invalidateMock, postMock, requestUseMock } = vi.hoisted(() => ({
  useOneMock: vi.fn(),
  invalidateMock: vi.fn(),
  postMock: vi.fn(),
  requestUseMock: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({
  useOne: (...args: unknown[]) => useOneMock(...args),
  useInvalidate: () => invalidateMock,
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      post: postMock,
      interceptors: {
        request: {
          use: requestUseMock,
        },
      },
    }),
  },
}));

vi.mock("@/components/ui/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) => (
    <div data-testid="code-block" data-language={language}>
      {code}
    </div>
  ),
}));

describe("WrongAnswerDetailPage", () => {
  it("renders sql answers as code blocks", async () => {
    useOneMock.mockReturnValue({
      query: {
        isLoading: false,
        data: {
          data: {
            id: "wa-1",
            question_id: "q-1",
            question_title: "请编写 SQL 查询语句",
            question_type: "short_answer",
            exam_title: "数据库考试",
            wrong_count: 1,
            last_wrong_at: "2026-04-10T10:00:00.000Z",
            tags: [],
            mastered: false,
            question_content: { text: "<p>使用 SQL 查询所有成绩大于 90 分的学生。</p>" },
            standard_answer: { correct: "SELECT name FROM scores WHERE score > 90;" },
            analysis: null,
            student_answer: { language: "sql", code: "SELECT * FROM scores WHERE score > 90;" },
            feedback: { strengths: [], deductions: [], suggestions: [] },
          },
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/wrong-answers/wa-1"]}>
        <Routes>
          <Route path="/wrong-answers/:id" element={<WrongAnswerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const codeBlocks = await screen.findAllByTestId("code-block");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveAttribute("data-language", "sql");
    expect(codeBlocks[1]).toHaveAttribute("data-language", "sql");
    expect(screen.getByText("SELECT * FROM scores WHERE score > 90;")).toBeInTheDocument();
    expect(screen.getByText("SELECT name FROM scores WHERE score > 90;")).toBeInTheDocument();
  });

  it("renders code answers with syntax highlighting and shows rich analysis", async () => {
    useOneMock.mockReturnValue({
      query: {
        isLoading: false,
        data: {
          data: {
            id: "wa-code",
            question_id: "q-code",
            question_title: "实现一个二分查找",
            question_type: "code",
            exam_title: "算法考试",
            wrong_count: 1,
            last_wrong_at: "2026-04-10T10:00:00.000Z",
            tags: [],
            mastered: false,
            question_content: { text: "<p>请使用 Python 实现二分查找。</p>", language: "python" },
            standard_answer: { language: "python", code: "def search(nums, target):\n    return -1" },
            analysis:
              '<p>注意左右边界更新。</p><p><img src="https://example.com/binary-search.png" alt="二分查找示意图" /></p>',
            student_answer: { language: "python", code: "def search(nums, target):\n    pass" },
            feedback: { strengths: [], deductions: [], suggestions: [] },
          },
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/wrong-answers/wa-code"]}>
        <Routes>
          <Route path="/wrong-answers/:id" element={<WrongAnswerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const blocks = await screen.findAllByTestId("code-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveAttribute("data-language", "python");
    expect(blocks[1]).toHaveAttribute("data-language", "python");
    expect(screen.getByText("注意左右边界更新。")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "二分查找示意图" })).toBeInTheDocument();
  });

  it("renders choice question options in wrong answer detail", async () => {
    useOneMock.mockReturnValue({
      query: {
        isLoading: false,
        data: {
          data: {
            id: "wa-choice",
            question_id: "q-choice",
            question_title: "Python中列表的索引",
            question_type: "choice",
            exam_title: "Python模拟试卷",
            wrong_count: 1,
            last_wrong_at: "2026-06-07T08:57:00.000Z",
            tags: [],
            mastered: false,
            question_content: {
              text: "在Python中，给定列表 lst = [10, 20, 30, 40, 50]，请问 lst[2] 的值是多少？",
            },
            question_options: {
              A: "10",
              B: "20",
              C: "30",
              D: "40",
            },
            standard_answer: { correct: "C" },
            analysis: null,
            student_answer: {},
            feedback: { strengths: [], deductions: [], suggestions: [] },
          },
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/wrong-answers/wa-choice"]}>
        <Routes>
          <Route path="/wrong-answers/:id" element={<WrongAnswerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getAllByText("C").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });
});
