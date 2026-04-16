import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";

import { ExamWizardForm } from "./ExamWizardForm";
import { DEFAULT_NOTES, type ExamFormValues } from "./exam-form-utils";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));
const useGetIdentityMock = vi.fn();
const useListMock = vi.fn();
const navigateMock = vi.fn();

const QUESTION_FIXTURES = [
  {
    id: "question-1",
    type: "choice",
    title: "选择题 1",
    content: { text: "题目 1" },
    options: { A: "A", B: "B" },
    answer: { correct: "A" },
    analysis: null,
    difficulty: 3,
    score: 10,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "题库",
    tags: [],
    knowledge_points: [],
    created_by: "user-1",
    created_by_name: "Teacher",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "question-2",
    type: "choice",
    title: "选择题 2",
    content: { text: "题目 2" },
    options: { A: "A", B: "B" },
    answer: { correct: "B" },
    analysis: null,
    difficulty: 3,
    score: 10,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "题库",
    tags: [],
    knowledge_points: [],
    created_by: "user-1",
    created_by_name: "Teacher",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "question-3",
    type: "code",
    title: "编程题 1",
    content: { text: "题目 3" },
    options: null,
    answer: { text: "answer" },
    analysis: null,
    difficulty: 3,
    score: 20,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "题库",
    tags: [],
    knowledge_points: [],
    created_by: "user-1",
    created_by_name: "Teacher",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "ai-question-1",
    type: "choice",
    title: "AI 生成选择题",
    content: { text: "下面哪个选项正确？" },
    options: { A: "选项 A", B: "选项 B" },
    answer: { correct: "A" },
    analysis: "解析内容",
    difficulty: 3,
    score: 10,
    usage_count: 0,
    question_bank_id: "ai-bank-1",
    question_bank_name: "AI题库",
    tags: [],
    knowledge_points: [],
    created_by: "teacher-1",
    created_by_name: "老师",
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
  },
];

vi.mock("@refinedev/core", () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentityMock(...args),
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("./PositionSelector", () => ({
  PositionSelector: () => <div data-testid="position-selector" />,
}));

vi.mock("./QuestionSelector", () => ({
  QuestionSelector: () => <div data-testid="question-selector" />,
}));

vi.mock("./StudentSelector", () => ({
  StudentSelector: () => <div data-testid="student-selector" />,
}));

vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

function createInitialValues(): ExamFormValues {
  return {
    title: "Java 后端岗位笔试",
    description: "",
    start_time: "2026-04-10T10:00",
    end_time: "2026-04-10T12:00",
    duration_minutes: 120,
    total_score: 100,
    status: "draft",
    position_id: null,
    max_switch_count: 2,
    show_result: false,
    notes_template: DEFAULT_NOTES,
    question_mode: "manual",
    question_ids: ["question-1"],
    question_items: [{ question_id: "question-1", order: 0, score_override: 100 }],
    student_ids: ["student-1"],
  };
}

describe("ExamWizardForm", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/knowledge/majors") {
        return Promise.resolve([]);
      }
      if (path === "/questions/ai-generate/frequent-knowledge-points") {
        return Promise.resolve({ recent: [], frequent: [] });
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    vi.stubGlobal("fetch", vi.fn());
    useGetIdentityMock.mockReturnValue({ data: { id: "teacher-1" } });
    useListMock.mockImplementation(({ resource, filters }: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      if (resource === "questions") {
        const questionIds = filters?.find((filter) => filter.field === "id")?.value;
        if (Array.isArray(questionIds)) {
          return {
            query: {
              data: {
                data: QUESTION_FIXTURES.filter((question) => questionIds.includes(question.id)),
              },
              isLoading: false,
            },
          };
        }
        return { query: { data: { data: [] }, isLoading: false } };
      }

      return { query: { data: { data: [] }, total: 0, isFetching: false, isLoading: false } };
    });
  });

  it("disables save in edit mode when nothing has changed", () => {
    render(
      <ExamWizardForm
        mode="edit"
        initialValues={createInitialValues()}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });

  it("enables save from the first step after a field changes", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="edit"
        initialValues={createInitialValues()}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "保存修改" });
    expect(saveButton).toBeDisabled();

    await user.clear(screen.getByLabelText("考试名称"));
    await user.type(screen.getByLabelText("考试名称"), "Java 后端岗位笔试（调整版）");

    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
  });

  it("restores AI question mode in edit mode when the exam was created by AI", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="edit"
        initialValues={{
          ...createInitialValues(),
          question_mode: "ai",
          question_ids: ["ai-question-1"],
          question_items: [{ question_id: "ai-question-1", order: 0, score_override: 10 }],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("AI出题设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AI出题/i })).toHaveClass("border-primary");
  });

  it("shows previously generated AI questions when editing an AI exam", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="edit"
        initialValues={{
          ...createInitialValues(),
          question_mode: "ai",
          question_ids: ["ai-question-1"],
          question_items: [{ question_id: "ai-question-1", order: 0, score_override: 10 }],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("AI 生成选择题")).toBeInTheDocument();
    expect(screen.getByText("下面哪个选项正确？")).toBeInTheDocument();
    expect(screen.getByText("解析内容")).toBeInTheDocument();
  });

  it("infers AI question mode for legacy exams whose questions all come from AI题库", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="edit"
        initialValues={{
          ...createInitialValues(),
          question_mode: null,
          question_ids: ["ai-question-1"],
          question_items: [{ question_id: "ai-question-1", order: 0, score_override: 10 }],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("AI出题设置")).toBeInTheDocument();
  });

  it("does not block step one progression on auto-calculated total score", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: "2026-04-20T10:00",
          end_time: "2026-04-20T12:00",
          total_score: 0,
          question_ids: [],
          question_items: [],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(screen.getByText("第 2 步：选择题目 / 自动出卷")).toBeInTheDocument();
    });
  });

  it("moves from step 3 to step 4 instead of submitting in create mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: "2026-04-20T10:00",
          end_time: "2026-04-20T12:00",
        }}
        isPending={false}
        submitError={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("第 3 步：选择考试考生")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跳过并继续|下一步/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /跳过并继续|下一步/ }));

    await waitFor(() => {
      expect(screen.getByText("第 4 步：考试设置")).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("guards against accidental form submit before the last step in create mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    const { container } = render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: "2026-04-20T10:00",
          end_time: "2026-04-20T12:00",
        }}
        isPending={false}
        submitError={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByText("第 3 步：选择考试考生")).toBeInTheDocument();

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText("第 4 步：考试设置")).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("generates AI questions and adds selected ones to the current exam", async () => {
    const user = userEvent.setup();
    const generatedEvent = {
      type: "question",
      data: {
        type: "choice",
        title: "AI 生成选择题",
        content: { text: "下面哪个选项正确？" },
        options: { A: "选项 A", B: "选项 B" },
        answer: { correct: "A" },
        analysis: "解析内容",
        difficulty: 3,
      },
    };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(generatedEvent)}\n\n`));
        controller.close();
      },
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: stream,
    } as Response);
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/knowledge/majors") {
        return Promise.resolve([]);
      }
      if (path === "/questions/ai-generate/frequent-knowledge-points") {
        return Promise.resolve({ recent: [], frequent: [] });
      }
      if (path === "/question-banks") {
        return Promise.resolve([{ id: "ai-bank-1", name: "AI题库" }]);
      }
      if (path === "/questions" && init?.method === "POST") {
        return Promise.resolve({
          id: "ai-question-1",
          type: "choice",
          title: "AI 生成选择题",
          content: { text: "下面哪个选项正确？" },
          options: { A: "选项 A", B: "选项 B" },
          answer: { correct: "A" },
          analysis: "解析内容",
          difficulty: 3,
          score: 10,
          usage_count: 0,
          question_bank_id: "ai-bank-1",
          question_bank_name: "AI题库",
          tags: [],
          knowledge_points: [],
          created_by: "teacher-1",
          created_by_name: "老师",
          created_at: "2026-04-13T10:00:00.000Z",
          updated_at: "2026-04-13T10:00:00.000Z",
        });
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: "2026-04-20T10:00",
          end_time: "2026-04-20T12:00",
          total_score: 0,
          question_ids: [],
          question_items: [],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: /AI出题/i }));
    expect(screen.getByText("AI出题设置")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("AI 生成选择题")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "加入当前考试" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/questions",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await user.click(screen.getByRole("button", { name: "下一步" }));

    await waitFor(() => {
      expect(screen.getByText("第 3 步：选择考试考生")).toBeInTheDocument();
    });
  });

  it("supports distributing scores by question type total", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: "2026-04-20T10:00",
          end_time: "2026-04-20T12:00",
          question_ids: ["question-1", "question-2", "question-3"],
          question_items: [
            { question_id: "question-1", order: 0, score_override: 10 },
            { question_id: "question-2", order: 1, score_override: 10 },
            { question_id: "question-3", order: 2, score_override: 20 },
          ],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    await user.click(screen.getByRole("button", { name: "按题型展示" }));

    const choiceTotalInput = screen.getByLabelText("题型总分", { selector: "#type-total-score-choice" });
    await user.clear(choiceTotalInput);
    await user.type(choiceTotalInput, "12");
    await user.click(screen.getByRole("button", { name: "将选择题总分均分到每题" }));

    await waitFor(() => {
      expect(
        screen.getByLabelText("考试分数", { selector: "#embedded-exam-question-score-question-1" }),
      ).toHaveValue(6);
      expect(
        screen.getByLabelText("考试分数", { selector: "#embedded-exam-question-score-question-2" }),
      ).toHaveValue(6);
      expect(
        screen.getByLabelText("考试分数", { selector: "#embedded-exam-question-score-question-3" }),
      ).toHaveValue(20);
    });
  });
});
