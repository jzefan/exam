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
let locationStateMock: unknown = null;
// 始终相对当前时间生成，避免测试依赖具体日期（固定日期会随时间流逝变成过去而导致校验失败）。
function futureLocalDateTime(offsetMs: number): string {
  const date = new Date(Date.now() + offsetMs);
  return formatLocalDateTime(date);
}
function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_START_TIME = futureLocalDateTime(7 * DAY_MS);
const FUTURE_END_TIME = futureLocalDateTime(7 * DAY_MS + 2 * 60 * 60 * 1000);
function localDateTimeFrom(value: string, offsetMinutes: number): string {
  return formatLocalDateTime(
    new Date(new Date(value).getTime() + offsetMinutes * 60_000),
  );
}

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

type TestQuestionForDistribution = {
  type: string;
  answer?: { correct?: unknown } | null;
};

function createTypeDistributionData(
  questions: TestQuestionForDistribution[],
) {
  const counts = new Map<string, number>();

  for (const question of questions) {
    const type =
      question.type === "choice"
        ? Array.isArray(question.answer?.correct)
          ? "multi_choice"
          : "single_choice"
        : question.type;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return Array.from(counts, ([type, count]) => ({ type, count }));
}

vi.mock("@refinedev/core", () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentityMock(...args),
  useList: (...args: unknown[]) => useListMock(...args),
  useInvalidate: () => vi.fn(),
  useOne: ({ id }: { id: string }) => ({
    query: {
      data: { data: QUESTION_FIXTURES.find((question) => question.id === id) ?? null },
      isLoading: false,
    },
  }),
  useUpdate: () => ({ mutate: vi.fn(), mutation: { isPending: false } }),
}));

vi.mock("react-router-dom", () => ({
  useBeforeUnload: vi.fn(),
  useLocation: () => ({ pathname: "/exams/create", search: "", hash: "", state: locationStateMock, key: "test" }),
  useNavigate: () => navigateMock,
}));

vi.mock("./PositionSelector", () => ({
  PositionSelector: () => <div data-testid="position-selector" />,
}));

vi.mock("./QuestionSelector", () => ({
  QuestionSelector: ({
    selectedIds,
    onChange,
  }: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <div data-testid="question-selector">
      <span>已选 {selectedIds.length} 题</span>
      {selectedIds.length > 0 && (
        <button type="button" onClick={() => onChange([])}>
          清空选择
        </button>
      )}
    </div>
  ),
}));

vi.mock("./StudentSelector", () => ({
  StudentSelector: () => <div data-testid="student-selector" />,
}));

vi.mock("@/components/ui/date-picker", () => {
  function formatLocalDateTime(value?: Date): string {
    if (!value) return "";
    const pad = (next: number) => String(next).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  return {
    DatePicker: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: Date;
      onChange?: (date: Date | undefined) => void;
      placeholder?: string;
    }) => (
      <input
        aria-label={placeholder ?? "日期时间"}
        data-testid={`date-picker-${placeholder ?? "default"}`}
        type="datetime-local"
        value={formatLocalDateTime(value)}
        onChange={(event) =>
          onChange?.(
            event.currentTarget.value
              ? new Date(event.currentTarget.value)
              : undefined,
          )
        }
      />
    ),
  };
});

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

function createInitialValues(): ExamFormValues {
  return {
    category: "exam",
    title: "Java 后端岗位笔试",
    description: "",
    start_time: FUTURE_START_TIME,
    end_time: FUTURE_END_TIME,
    duration_minutes: 120,
    total_score: 100,
    status: "draft",
    position_id: null,
    max_switch_count: 2,
    allow_retake: false,
    show_result: true,
    notes_template: DEFAULT_NOTES,
    question_mode: "manual",
    question_ids: ["question-1"],
    question_items: [{ question_id: "question-1", order: 0, score_override: 100 }],
    student_ids: ["student-1"],
  };
}

describe("ExamWizardForm", () => {
  beforeEach(() => {
    locationStateMock = null;
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/knowledge/majors") {
        return Promise.resolve([]);
      }
      if (path === "/questions/ai-generate/frequent-knowledge-points") {
        return Promise.resolve({ recent: [], frequent: [] });
      }
      if (path === "/rbac/students") {
        return Promise.resolve([]);
      }
      if (path === "/rbac/students/classes") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    vi.stubGlobal("fetch", vi.fn());
    useGetIdentityMock.mockReturnValue({ data: { id: "teacher-1" } });
    useListMock.mockImplementation(({ resource, filters }: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      if (resource === "questions/type-distribution") {
        const data = createTypeDistributionData(QUESTION_FIXTURES);
        return {
          query: {
            data: { data, total: QUESTION_FIXTURES.length },
            isFetching: false,
            isLoading: false,
          },
        };
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

  it("updates duration when the end time changes", async () => {
    render(
      <ExamWizardForm
        mode="create"
        initialValues={createInitialValues()}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: localDateTimeFrom(FUTURE_START_TIME, 240) },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(240);
    });
  });

  it("updates duration when the start time changes", async () => {
    const endTime = localDateTimeFrom(FUTURE_START_TIME, 240);

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          end_time: endTime,
          duration_minutes: 240,
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: localDateTimeFrom(FUTURE_START_TIME, 60) },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("考试时长（分钟）")).toHaveValue(180);
    });
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

    // 预览卡片展示题干（content.text）与解析，而非内部 title 字段。
    expect(screen.getByText("下面哪个选项正确？")).toBeInTheDocument();
    expect(screen.getByText("解析内容")).toBeInTheDocument();
  });

  it("keeps generated questions when switching from auto mode to manual mode", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          question_mode: "auto",
          question_ids: ["question-1"],
          question_items: [{ question_id: "question-1", order: 0, score_override: 10 }],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
        initialStep={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: /精确控制题目内容/ }));
    expect(screen.getByText(/已加入考试的题目会保留/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认切换" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "清空选择" })).toBeInTheDocument();
    });
  });

  it("clears selected questions only when switching from manual mode to AI mode", async () => {
    const user = userEvent.setup();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          question_mode: "manual",
          question_ids: ["question-1"],
          question_items: [{ question_id: "question-1", order: 0, score_override: 10 }],
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
        initialStep={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: /AI出题/i }));
    expect(screen.getByText(/当前已选题目会被清空/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认切换" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "确认切换" })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /精确控制题目内容/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "清空选择" })).not.toBeInTheDocument();
    });
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
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
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

  it("prefills the course and course question bank when launched from a course", async () => {
    locationStateMock = {
      courseKpId: "course-1",
      courseName: "Python程序设计",
    };
    useListMock.mockImplementation(({ resource, filters }: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      if (resource === "question-banks") {
        return {
          query: {
            data: {
              data: [
                { id: "bank-course", name: "Python程序设计-题库" },
                { id: "bank-other", name: "其它题库" },
              ],
            },
            isLoading: false,
          },
        };
      }

      if (resource === "questions/type-distribution") {
        const data = createTypeDistributionData(QUESTION_FIXTURES);
        return {
          query: {
            data: { data, total: QUESTION_FIXTURES.length },
            isFetching: false,
            isLoading: false,
          },
        };
      }

      if (resource === "questions") {
        const questionIds = filters?.find((filter) => filter.field === "id")?.value;
        if (Array.isArray(questionIds)) {
          return {
            query: {
              data: { data: QUESTION_FIXTURES.filter((question) => questionIds.includes(question.id)) },
              isLoading: false,
            },
          };
        }
        return { query: { data: { data: QUESTION_FIXTURES }, isLoading: false } };
      }

      return { query: { data: { data: [] }, total: 0, isFetching: false, isLoading: false } };
    });

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          question_mode: "auto",
          question_ids: [],
          question_items: [],
          total_score: 0,
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
        initialStep={1}
        defaultAutoBankName="Python程序设计-题库"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Python程序设计-题库")).toBeInTheDocument();
    });
  });

  it("uses default per-type scores and updates the summary total before generation", async () => {
    const user = userEvent.setup();
    useListMock.mockImplementation(({ resource, filters }: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      if (resource === "question-banks") {
        return {
          query: {
            data: { data: [{ id: "bank-1", name: "题库" }] },
            isLoading: false,
          },
        };
      }

      if (resource === "questions/type-distribution") {
        const data = createTypeDistributionData(QUESTION_FIXTURES);
        return {
          query: {
            data: { data, total: QUESTION_FIXTURES.length },
            isFetching: false,
            isLoading: false,
          },
        };
      }

      if (resource === "questions") {
        const questionIds = filters?.find((filter) => filter.field === "id")?.value;
        if (Array.isArray(questionIds)) {
          return {
            query: {
              data: { data: QUESTION_FIXTURES.filter((question) => questionIds.includes(question.id)) },
              isLoading: false,
            },
          };
        }
        return { query: { data: { data: QUESTION_FIXTURES }, isLoading: false } };
      }

      return { query: { data: { data: [] }, total: 0, isFetching: false, isLoading: false } };
    });

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          question_mode: "auto",
          question_ids: [],
          question_items: [],
          total_score: 0,
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
        initialStep={1}
      />,
    );

    const choiceCount = screen.getByLabelText("单选题数量");
    await user.clear(choiceCount);
    await user.type(choiceCount, "2");

    const codeCount = screen.getByLabelText("编程题数量");
    await user.clear(codeCount);
    await user.type(codeCount, "1");

    expect(screen.getByLabelText("单选题每题分值")).toHaveValue(1);
    expect(screen.getByLabelText("编程题每题分值")).toHaveValue(10);
    expect(screen.getByText("12 分")).toBeInTheDocument();
  });

  it("keeps knowledge quotas within the selected type plan", async () => {
    const user = userEvent.setup();
    const kp1 = { id: "kp-1", name: "Python程序设计导论", path: "Python程序设计导论" };
    const kp2 = { id: "kp-2", name: "程序流程控制", path: "程序流程控制" };
    const questionTexts: Record<string, string> = {
      "choice-1": "在 Python 交互式环境中执行 print('hello') 后，控制台会输出什么内容？",
      "choice-2": "下列哪个命令可以查看当前安装的 Python 解释器版本？",
      "choice-3": "当 if 条件表达式为 False 时，程序会优先执行哪个分支？",
      "choice-4": "for 循环遍历 range(3) 时，循环变量会依次取得哪些值？",
      "code-1": "编写 Python 程序，读取用户姓名并输出一行欢迎语。",
      "code-2": "编写 Python 程序，输入一个整数，判断它是否为正数。",
      "code-3": "编写 Python 程序，统计列表中大于 10 的元素个数。",
    };
    const makeQuestion = (id: string, type: "choice" | "code", kp: typeof kp1) => ({
      id,
      type,
      title: `${type}-${id}`,
      content: { text: questionTexts[id] },
      options:
        type === "choice"
          ? { A: "选项 A", B: "选项 B", C: "选项 C", D: "选项 D" }
          : null,
      answer: type === "choice" ? { correct: "A" } : { text: "print('ok')" },
      analysis: null,
      difficulty: 3,
      score: type === "choice" ? 1 : 10,
      usage_count: 0,
      question_bank_id: "bank-1",
      question_bank_name: "题库",
      tags: [],
      knowledge_points: [kp],
      created_by: "user-1",
      created_by_name: "Teacher",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    });
    const questions = [
      makeQuestion("choice-1", "choice", kp1),
      makeQuestion("choice-2", "choice", kp1),
      makeQuestion("choice-3", "choice", kp2),
      makeQuestion("choice-4", "choice", kp2),
      makeQuestion("code-1", "code", kp1),
      makeQuestion("code-2", "code", kp2),
      makeQuestion("code-3", "code", kp2),
    ];

    useListMock.mockImplementation(({ resource, filters }: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      if (resource === "question-banks") {
        return {
          query: {
            data: { data: [{ id: "bank-1", name: "题库" }] },
            isLoading: false,
          },
        };
      }

      if (resource === "knowledge-points") {
        return {
          query: {
            data: { data: [kp1, kp2] },
            isLoading: false,
          },
        };
      }

      if (resource === "questions/type-distribution") {
        const data = createTypeDistributionData(questions);
        return {
          query: {
            data: { data, total: questions.length },
            isFetching: false,
            isLoading: false,
          },
        };
      }

      if (resource === "questions") {
        const questionIds = filters?.find((filter) => filter.field === "id")?.value;
        if (Array.isArray(questionIds)) {
          return {
            query: {
              data: { data: questions.filter((question) => questionIds.includes(question.id)) },
              isLoading: false,
            },
          };
        }
        return { query: { data: { data: questions }, isLoading: false } };
      }

      return { query: { data: { data: [] }, total: 0, isFetching: false, isLoading: false } };
    });

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          question_mode: "auto",
          question_ids: [],
          question_items: [],
          total_score: 0,
        }}
        isPending={false}
        submitError={null}
        onSubmit={vi.fn()}
        initialStep={1}
      />,
    );

    await user.clear(screen.getByLabelText("单选题数量"));
    await user.type(screen.getByLabelText("单选题数量"), "3");
    await user.clear(screen.getByLabelText("编程题数量"));
    await user.type(screen.getByLabelText("编程题数量"), "2");
    await user.click(screen.getByRole("button", { name: /技能知识点配额/ }));
    await user.click(screen.getByRole("button", { name: "按章节均匀覆盖" }));

    expect(screen.getAllByText("合计 5 题").length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole("button", { name: "生成题单" }));

    await waitFor(() => {
      expect(screen.getByText(/最近生成 5 题 \/ 23 分/)).toBeInTheDocument();
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
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
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

  it("moves from step 3 to step 4 without submitting when students are already selected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
          student_ids: ["student-1"],
        }}
        isPending={false}
        submitError={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("第 3 步：选择考试考生")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一步" }));

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
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
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

  it("automatically adds every generated AI question even when fewer than requested are returned", async () => {
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
      if (path === "/rbac/students") {
        return Promise.resolve([]);
      }
      if (path === "/rbac/students/classes") {
        return Promise.resolve([]);
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
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
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

    // 题目总数由题型分配自动得出：设置 2 道单选题即总数 2。
    const choiceCountInput = screen.getByLabelText("单选题数量");
    await user.clear(choiceCountInput);
    await user.type(choiceCountInput, "2");

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("下面哪个选项正确？")).toBeInTheDocument();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/questions",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/已自动加入 1 道题目/)).toBeInTheDocument();
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
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
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

    await user.click(screen.getByRole("button", { name: "预览与设置分数" }));
    await user.click(screen.getByRole("button", { name: "按题型展示" }));

    const choiceTotalInput = screen.getByLabelText("题型总分", { selector: "#type-total-score-single_choice" });
    await user.clear(choiceTotalInput);
    await user.type(choiceTotalInput, "12");
    await user.click(screen.getByRole("button", { name: "将单选题总分均分到每题" }));

    await waitFor(() => {
      expect(document.getElementById("fullscreen-exam-question-score-question-1")).toHaveValue(6);
      expect(document.getElementById("fullscreen-exam-question-score-question-2")).toHaveValue(6);
      expect(document.getElementById("fullscreen-exam-question-score-question-3")).toHaveValue(20);
    });
  });

  it("creates and publishes the exam from the last step in create mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
        }}
        isPending={false}
        submitError={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "创建并发布" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "upcoming",
        }),
      );
    });
  });

  it("can save the exam as draft from the last step in create mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ExamWizardForm
        mode="create"
        initialValues={{
          ...createInitialValues(),
          start_time: FUTURE_START_TIME,
          end_time: FUTURE_END_TIME,
        }}
        isPending={false}
        submitError={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "保存到草稿" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "draft",
        }),
      );
    });
  });
});
