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

    expect(await screen.findAllByTestId("code-block")).toHaveLength(2);
    expect(screen.getAllByText("SQL")).toHaveLength(2);
    expect(screen.getByText("SELECT * FROM scores WHERE score > 90;")).toBeInTheDocument();
    expect(screen.getByText("SELECT name FROM scores WHERE score > 90;")).toBeInTheDocument();
  });
});
