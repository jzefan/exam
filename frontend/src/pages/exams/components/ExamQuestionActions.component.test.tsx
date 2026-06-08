import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { ExamQuestionActions } from "./ExamQuestionActions";

const { apiRequestMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("@/components/questions/question-preview-card", () => ({
  QuestionPreviewCard: ({ question }: { question: IQuestion }) => (
    <div data-testid="question-preview">{question.title}</div>
  ),
}));

const baseQuestion: IQuestion = {
  id: "question-1",
  type: "code",
  title: "判断闰年",
  content: { text: "编写一个 Python 程序，输入年份并判断是否为闰年。" },
  options: null,
  answer: { text: "year = int(input())" },
  analysis: "考查条件判断。",
  difficulty: 3,
  score: 10,
  usage_count: 0,
  question_bank_id: "bank-1",
  question_bank_name: "Python程序设计-题库",
  tags: [],
  knowledge_points: [
    {
      id: "kp-child-1",
      name: "程序流程控制",
      parent_id: "course-kp-1",
      direction_id: "direction-1",
      description: null,
      question_count: 0,
      created_at: "2026-06-04T00:00:00.000Z",
    },
  ],
  created_by: "teacher-1",
  created_by_name: "老师",
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: "2026-06-04T00:00:00.000Z",
};

function mockStreamResponse(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    body,
  } as Response;
}

describe("ExamQuestionActions", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMock.mockReset();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("falls back to AI generation when random replacement has no candidate question", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockResolvedValue([]);
    const fetchMock = vi.fn().mockResolvedValue(
      mockStreamResponse({
        type: "question",
        data: {
          type: "code",
          title: "AI 生成的同知识点编程题",
          content: { text: "编写一个 Python 程序，统计列表中的偶数数量。" },
          options: null,
          answer: { text: "nums = [1, 2, 3]\nprint(sum(n % 2 == 0 for n in nums))" },
          analysis: "考查循环与条件判断。",
          difficulty: 3,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <ExamQuestionActions
          question={baseQuestion}
          currentExamQuestionIds={[baseQuestion.id]}
          onReplaceQuestion={vi.fn()}
          courseKnowledgePointId="course-kp-1"
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "随机换题" }));

    await screen.findByText("AI 生成的新题");
    expect(screen.getByTestId("question-preview")).toHaveTextContent("AI 生成的同知识点编程题");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions/ai-generate/stream",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek");
    expect(body.knowledge_point_ids).toEqual(["kp-child-1"]);
    expect(body.prompt).toContain("编写一个 Python 程序");
    expect(body.prompt).toContain("严禁生成语文");
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "已改用 AI 生成" }),
    );

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1));
  });

  it("regenerates only answer and analysis from the edit menu", async () => {
    const user = userEvent.setup();
    const onQuestionUpdated = vi.fn();
    const choiceQuestion: IQuestion = {
      ...baseQuestion,
      type: "choice",
      content: { text: "Python 中用于定义函数的关键字是？" },
      options: { A: "def", B: "class", C: "import", D: "return" },
      answer: { correct: "A" },
      analysis: "def 用于定义函数。",
    };
    const updatedQuestion: IQuestion = {
      ...choiceQuestion,
      analysis: "A 正确，def 用于定义函数；B 错误，class 用于定义类；C 错误，import 用于导入模块；D 错误，return 用于返回值。",
    };
    apiRequestMock.mockResolvedValue(updatedQuestion);
    const fetchMock = vi.fn().mockResolvedValue(
      mockStreamResponse({
        type: "question",
        data: {
          type: "choice",
          title: "Python 函数关键字",
          content: choiceQuestion.content,
          options: choiceQuestion.options,
          answer: { correct: "A" },
          analysis: updatedQuestion.analysis,
          difficulty: 3,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <ExamQuestionActions
          question={choiceQuestion}
          currentExamQuestionIds={[choiceQuestion.id]}
          onReplaceQuestion={vi.fn()}
          onQuestionUpdated={onQuestionUpdated}
          courseKnowledgePointId="course-kp-1"
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /编辑/ }));
    expect(await screen.findByText("编辑题目")).toBeInTheDocument();
    await user.click(screen.getByText("重新生成答案和解析"));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/questions/question-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const aiBody = JSON.parse(String(fetchInit.body)) as Record<string, unknown>;
    expect(aiBody.prompt).toContain("只重新判断 answer 与 analysis");
    expect(aiBody.prompt).toContain("必须逐项说明每个选项为什么正确或为什么错误");

    const [, updateInit] = apiRequestMock.mock.calls[0] as [string, RequestInit];
    const updateBody = JSON.parse(String(updateInit.body)) as Record<string, unknown>;
    expect(updateBody).toEqual({
      answer: { correct: "A" },
      analysis: updatedQuestion.analysis,
    });
    expect(onQuestionUpdated).toHaveBeenCalledWith(updatedQuestion);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "已重新生成答案和解析" }),
    );
  });
});
