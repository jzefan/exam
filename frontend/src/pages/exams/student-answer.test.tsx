import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";
import type { IExamResult } from "@/types";

import { StudentAnswerPage } from "./student-answer";

const apiRequestMock = vi.fn();

vi.mock("@/pages/grading/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

vi.mock("@/components/ui/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) => (
    <div data-testid="code-block" data-language={language}>
      {code}
    </div>
  ),
}));

function buildResult(studentId: string): IExamResult {
  return {
    exam_id: "exam-1",
    title: `考试结果-${studentId}`,
    submitted_at: "2026-05-16T09:30:00.000Z",
    total_score: 100,
    score: 80,
    objective_score: 80,
    subjective_score: 0,
    grading_status: "reviewed",
    can_view: true,
    blocked_reason: null,
    questions: [],
  };
}

function buildResultWithFillIn(studentId: string): IExamResult {
  return {
    ...buildResult(studentId),
    questions: [
      {
        question_id: "q1",
        order: 0,
        type: "fill_in",
        title: "Matplotlib 设置 x 轴标签的函数是____。",
        content: { text: "Matplotlib 设置 x 轴标签的函数是____。" },
        options: null,
        total_score: 2,
        score_awarded: 2,
        is_correct: true,
        answer_content: { blanks: ["plt.xlabel()"] },
        standard_answer: { correct: ["xlabel"] },
        analysis: null,
        feedback: {
          dimensions: [],
          strengths: [],
          deductions: [],
          suggestions: [],
          model_evaluation: {
            model: "deepseek-v4-flash",
            matches: [
              {
                index: 1,
                expected: "xlabel",
                is_correct: true,
                reason: "plt.xlabel() 调用的是同名函数 xlabel，视为可接受答案。",
              },
            ],
          },
        },
        appeal_status: null,
        appeal_reason: null,
        appeal_reply: null,
      },
    ],
  };
}

function buildResultWithCode(studentId: string): IExamResult {
  return {
    ...buildResult(studentId),
    questions: [
      {
        question_id: "q-code",
        order: 0,
        type: "code",
        title: "实现二分查找",
        content: { text: "<p>请使用 Python 实现二分查找。</p>", language: "python" },
        options: null,
        total_score: 20,
        score_awarded: 16,
        is_correct: false,
        answer_content: { language: "python", code: "def search(nums, target):\n    pass" },
        standard_answer: { language: "python", code: "def search(nums, target):\n    return -1" },
        analysis:
          '<p>注意左右边界更新。</p><p><img src="https://example.com/teacher-analysis.png" alt="教师端解析图" /></p>',
        feedback: {
          dimensions: [{ name: "正确性", score: 16, max_score: 20, comment: "主流程基本正确。" }],
          strengths: [],
          deductions: [],
          suggestions: [],
        },
        appeal_status: null,
        appeal_reason: null,
        appeal_reply: null,
      },
    ],
  };
}

describe("StudentAnswerPage", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/exams/exam-1/students") {
        return Promise.resolve([
          {
            student_id: "student-newer",
            full_name: "较新考生",
            username: "2026001",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T10:00:00.000Z",
          },
          {
            student_id: "student-current",
            full_name: "当前考生",
            username: "2026002",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:30:00.000Z",
          },
          {
            student_id: "student-older",
            full_name: "较早考生",
            username: "2026003",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:00:00.000Z",
          },
        ]);
      }

      const match = path.match(/^\/exams\/exam-1\/students\/(.+)\/result$/);
      if (match) {
        return Promise.resolve(buildResult(match[1]));
      }

      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  it("switches to the next student in the same exam", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/exams/exam-1/students/student-current/result"]}>
        <Routes>
          <Route path="/exams/:examId/students/:studentId/result" element={<StudentAnswerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("当前考生")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一个" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/exams/exam-1/students/student-older/result");
    });
    expect(await screen.findByText("较早考生")).toBeInTheDocument();
  });

  it("renders DeepSeek model evaluation for fill-in questions", async () => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/exams/exam-1/students") {
        return Promise.resolve([
          {
            student_id: "student-current",
            full_name: "当前考生",
            username: "2026002",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:30:00.000Z",
          },
        ]);
      }
      const match = path.match(/^\/exams\/exam-1\/students\/(.+)\/result$/);
      if (match) {
        return Promise.resolve(buildResultWithFillIn(match[1]));
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={["/exams/exam-1/students/student-current/result"]}>
        <Routes>
          <Route path="/exams/:examId/students/:studentId/result" element={<StudentAnswerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("模型评估输出")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText(/第 1 空 · 可接受/)).toBeInTheDocument();
    expect(
      screen.getByText(/plt.xlabel\(\) 调用的是同名函数 xlabel/),
    ).toBeInTheDocument();
  });

  it("merges the AI 判题 response into just the target question without re-fetching", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockReset();

    const initialResult = buildResultWithFillIn("student-current");
    initialResult.questions[0].score_awarded = 0;
    initialResult.questions[0].is_correct = false;
    initialResult.questions[0].feedback = {};
    initialResult.score = 0;
    initialResult.objective_score = 0;

    // Backend now returns just the patched fields for this one question.
    const aiGradePatch = {
      question_id: "q1",
      total_score: 2,
      score_awarded: 2,
      is_correct: true,
      feedback: {
        dimensions: [],
        strengths: [],
        deductions: [],
        suggestions: [],
        model_evaluation: {
          model: "deepseek-v4-flash",
          matches: [
            {
              index: 1,
              expected: "xlabel",
              is_correct: true,
              reason: "plt.xlabel() 调用的是 xlabel 函数。",
            },
          ],
        },
      },
    };

    let resultCallCount = 0;
    let aiGradeCallCount = 0;
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/exams/exam-1/students") {
        return Promise.resolve([
          {
            student_id: "student-current",
            full_name: "当前考生",
            username: "2026002",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:30:00.000Z",
          },
        ]);
      }
      const resultMatch = path.match(/^\/exams\/exam-1\/students\/(.+)\/result$/);
      if (resultMatch) {
        resultCallCount += 1;
        return Promise.resolve(initialResult);
      }
      if (
        init?.method === "POST" &&
        path.startsWith("/exams/exam-1/students/student-current/questions/")
      ) {
        aiGradeCallCount += 1;
        return Promise.resolve(aiGradePatch);
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={["/exams/exam-1/students/student-current/result"]}>
        <Routes>
          <Route path="/exams/:examId/students/:studentId/result" element={<StudentAnswerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("0 / 2")).toBeInTheDocument();
    expect(resultCallCount).toBe(1);

    await user.click(screen.getByRole("button", { name: /AI 判题/ }));

    await waitFor(() => {
      expect(aiGradeCallCount).toBe(1);
    });

    // Score and model evaluation update inline without re-fetching the result endpoint.
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("模型评估输出")).toBeInTheDocument();
    expect(screen.getByText(/plt.xlabel\(\) 调用的是 xlabel 函数/)).toBeInTheDocument();
    expect(resultCallCount).toBe(1); // no second fetch of the full result
  });

  it("renders code answers with syntax highlighting and shows rich analysis", async () => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/exams/exam-1/students") {
        return Promise.resolve([
          {
            student_id: "student-current",
            full_name: "当前考生",
            username: "2026002",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:30:00.000Z",
          },
        ]);
      }
      const match = path.match(/^\/exams\/exam-1\/students\/(.+)\/result$/);
      if (match) {
        return Promise.resolve(buildResultWithCode(match[1]));
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={["/exams/exam-1/students/student-current/result"]}>
        <Routes>
          <Route path="/exams/:examId/students/:studentId/result" element={<StudentAnswerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const codeBlocks = await screen.findAllByTestId("code-block");
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks[0]).toHaveAttribute("data-language", "python");
    expect(codeBlocks[1]).toHaveAttribute("data-language", "python");
    expect(screen.getByText("注意左右边界更新。")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "教师端解析图" })).toBeInTheDocument();
  });

  it("lets teachers manually update a question score from the answer detail", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/exams/exam-1/students") {
        return Promise.resolve([
          {
            student_id: "student-current",
            full_name: "当前考生",
            username: "2026002",
            phone: null,
            started_at: "2026-05-16T09:00:00.000Z",
            submitted_at: "2026-05-16T09:30:00.000Z",
          },
        ]);
      }
      const resultMatch = path.match(/^\/exams\/exam-1\/students\/(.+)\/result$/);
      if (resultMatch) {
        return Promise.resolve(buildResultWithCode(resultMatch[1]));
      }
      if (
        init?.method === "PATCH" &&
        path === "/exams/exam-1/students/student-current/questions/q-code/score"
      ) {
        return Promise.resolve({
          question_id: "q-code",
          total_score: 20,
          score_awarded: 18,
          is_correct: false,
          objective_score: 0,
          subjective_score: 18,
          exam_score: 82,
          grading_status: "reviewed",
          feedback: { manual_score: { score_awarded: 18 } },
        });
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });

    render(
      <MemoryRouter initialEntries={["/exams/exam-1/students/student-current/result"]}>
        <Routes>
          <Route path="/exams/:examId/students/:studentId/result" element={<StudentAnswerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("16 / 20")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "改分" }));
    const input = screen.getByRole("spinbutton", { name: "本题得分" });
    await user.clear(input);
    await user.type(input, "18");
    await user.click(screen.getByRole("button", { name: "保存分数" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/exams/exam-1/students/student-current/questions/q-code/score",
        {
          method: "PATCH",
          body: JSON.stringify({ score_awarded: 18 }),
        },
      );
    });
    expect((await screen.findAllByText("18 / 20")).length).toBeGreaterThan(0);
    expect(screen.getByText("82 / 100")).toBeInTheDocument();
  });
});
