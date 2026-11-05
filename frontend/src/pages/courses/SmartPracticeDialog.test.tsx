import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { apiClient } from "@/lib/api";
import { render, screen, waitFor } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { listCourseQuestions } from "./api";
import type { CourseKnowledgeNode } from "./api";
import { SmartPracticeDialog } from "./SmartPracticeDialog";

vi.mock("@/lib/api", () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock("./api", () => ({
  listCourseQuestions: vi.fn(),
}));

vi.mock("@/pages/exams/components/ClassStudentSelector", () => ({
  ClassStudentSelector: ({
    onChange,
    defaultClassIds,
  }: {
    onChange: (ids: string[]) => void;
    defaultClassIds?: string[];
  }) => (
    <button
      type="button"
      data-default-class-ids={defaultClassIds?.join(",") ?? ""}
      onClick={() => onChange(["student-1"])}
    >
      选择测试学生
    </button>
  ),
}));

const mockListCourseQuestions = vi.mocked(listCourseQuestions);
const mockPost = vi.mocked(apiClient.post);

function makeQuestion(
  id: string,
  difficulty = 1,
  knowledgePoint?: { id: string; name: string },
): IQuestion {
  return {
    id,
    type: "choice",
    title: `题目 ${id}`,
    content: { text: `题目 ${id}` },
    options: null,
    answer: {},
    analysis: null,
    difficulty,
    score: 5,
    usage_count: 0,
    question_bank_id: "bank-1",
    question_bank_name: "课程题库",
    tags: [],
    knowledge_points: knowledgePoint
      ? [
          {
            id: knowledgePoint.id,
            name: knowledgePoint.name,
            parent_id: null,
            description: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]
      : [],
    created_by: "teacher-1",
    created_by_name: "教师",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

type RenderDialogOptions = {
  knowledgeOptions?: Array<{ id: string; name: string; path: string }>;
  knowledgeTree?: CourseKnowledgeNode | null;
  initialKnowledgePointId?: string | null;
  defaultClassIds?: string[];
};

function renderDialog(
  selectedQuestionIds: string[] = [],
  {
    knowledgeOptions = [],
    knowledgeTree = null,
    initialKnowledgePointId = null,
    defaultClassIds = ["class-1"],
  }: RenderDialogOptions = {},
) {
  return render(
    <SmartPracticeDialog
      open
      onOpenChange={vi.fn()}
      courseId="course-1"
      courseName="数据结构"
      courseKpId="course-kp-1"
      courseSemesterId="semester-1"
      defaultClassIds={defaultClassIds}
      selectedQuestionIds={selectedQuestionIds}
      knowledgeOptions={knowledgeOptions}
      knowledgeTree={knowledgeTree}
      initialKnowledgePointId={initialKnowledgePointId}
    />,
  );
}

describe("SmartPracticeDialog", () => {
  beforeEach(() => {
    mockListCourseQuestions.mockReset();
    mockPost.mockReset();
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-1"),
      makeQuestion("q-2"),
      makeQuestion("q-3"),
    ]);
  });

  it("未勾选题目时使用课程全部题目", async () => {
    renderDialog();

    expect(await screen.findByText("课程全部 3 题")).toBeInTheDocument();
    expect(mockListCourseQuestions).toHaveBeenCalledWith("course-1");
  });

  it("有勾选时只使用勾选题目并提供提示词模版", async () => {
    const user = userEvent.setup();
    renderDialog(["q-2"]);

    expect(await screen.findByText("已选 1 题")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "提示词" }));
    await user.click(screen.getByRole("button", { name: "10 道容易题" }));
    expect(screen.getByRole("textbox", { name: "练习提示词" })).toHaveValue(
      "请从“数据结构”题库中选取10道容易题生成一份练习。",
    );
  });

  it("本节巩固下拉出知识点与可用题型数量", async () => {
    const user = userEvent.setup();
    const knowledgeTree: CourseKnowledgeNode = {
      id: "course-kp-1",
      name: "计算机网络",
      question_count: 0,
      material_count: 0,
      children: [
        { id: "kp-physical", name: "物理层", question_count: 0, material_count: 0, children: [] },
      ],
    };
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-1", 1, { id: "kp-physical", name: "物理层" }),
      makeQuestion("q-2", 1, { id: "kp-physical", name: "物理层" }),
      makeQuestion("q-3", 1, { id: "kp-physical", name: "物理层" }),
    ]);
    renderDialog([], {
      knowledgeOptions: [{ id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" }],
      knowledgeTree,
    });

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("tab", { name: "提示词" }));

    // 未选知识点：本节巩固只提示去上方选择，不能填提示词。
    await user.click(screen.getByRole("button", { name: "本节巩固" }));
    expect(screen.getByText("请先在上方选择知识点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填入提示词" })).toBeDisabled();

    // 通过页签上方的知识点选择器选中本节。
    await user.click(screen.getByRole("button", { name: "知识点：全部知识点" }));
    await user.click(screen.getByRole("button", { name: "物理层" }));

    await user.click(screen.getByRole("button", { name: "本节巩固" }));
    expect(screen.getByText("该节共 3 道可用题目")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "填入提示词" }));
    expect(screen.getByRole("textbox", { name: "练习提示词" })).toHaveValue(
      "请从“数据结构”题库中选取10道题，围绕本节“物理层”生成一份巩固练习，基础与应用题兼顾。",
    );
  });

  it("按题型配比可生成包含各题型数量与难度的提示词", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("tab", { name: "提示词" }));
    await user.click(screen.getByRole("button", { name: "按题型配比" }));
    await user.click(screen.getByRole("button", { name: "填入提示词" }));

    expect(screen.getByRole("textbox", { name: "练习提示词" })).toHaveValue(
      "请从“数据结构”题库中选取单选题10道、多选题5道、判断题10道、填空题10道、简答题5道，综合难度。",
    );
  });

  it("按配比页签生成预览，并可填入配比提示词", async () => {
    const user = userEvent.setup();
    const knowledgeTree: CourseKnowledgeNode = {
      id: "course-kp-1",
      name: "计算机网络",
      question_count: 0,
      material_count: 0,
      children: [
        { id: "kp-physical", name: "物理层", question_count: 0, material_count: 0, children: [] },
      ],
    };
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-1", 1, { id: "kp-physical", name: "物理层" }),
      makeQuestion("q-2", 1, { id: "kp-physical", name: "物理层" }),
      makeQuestion("q-3", 1, { id: "kp-physical", name: "物理层" }),
    ]);
    renderDialog([], {
      knowledgeOptions: [{ id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" }],
      knowledgeTree,
    });
    await screen.findByText("课程全部 3 题");

    await user.click(screen.getByRole("tab", { name: "提示词" }));
    await user.click(screen.getByRole("button", { name: "按配比" }));
    expect(screen.getByRole("textbox", { name: "练习提示词" })).toHaveValue(
      "请从“数据结构”题库中按章节分配：物理层10道（单选题10道）。",
    );

    await user.click(screen.getByRole("tab", { name: "按配比" }));
    expect(screen.getAllByText("共 10 题").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "生成预览" }));
    expect(await screen.findByText("预览 · 3 题")).toBeInTheDocument();
  });

  it("智能创建试卷可在预览里改分值并提交", async () => {
    const user = userEvent.setup();
    const onPaperCreated = vi.fn();
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-1"),
      makeQuestion("q-2"),
    ]);
    mockPost.mockResolvedValueOnce({ data: { id: "paper-1" } });

    render(
      <SmartPracticeDialog
        target="paper"
        open
        onOpenChange={vi.fn()}
        courseId="course-1"
        courseName="数据结构"
        courseKpId="course-kp-1"
        courseSemesterId={null}
        selectedQuestionIds={[]}
        knowledgeOptions={[]}
        onPaperCreated={onPaperCreated}
      />,
    );

    await screen.findByText("课程全部 2 题");
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    expect(screen.getByLabelText("试卷名称")).toBeInTheDocument();
    const firstScoreInput = screen.getByRole("spinbutton", {
      name: "第 1 题分值",
    });
    await user.clear(firstScoreInput);
    await user.type(firstScoreInput, "8");

    await user.click(screen.getByRole("button", { name: "用 2 题生成" }));
    await user.click(screen.getByRole("button", { name: "创建试卷" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/api/papers",
        expect.objectContaining({
          root_knowledge_point_id: "course-kp-1",
          question_items: expect.arrayContaining([
            expect.objectContaining({ score_override: 8 }),
          ]),
        }),
      );
      expect(onPaperCreated).toHaveBeenCalledWith("paper-1");
    });
  });

  it("配比数量不足时先确认再发布", async () => {
    const user = userEvent.setup();
    const knowledgeTree: CourseKnowledgeNode = {
      id: "course-kp-1",
      name: "数据结构",
      question_count: 0,
      material_count: 0,
      children: [
        { id: "kp-a", name: "章节A", question_count: 0, material_count: 0, children: [] },
      ],
    };
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-1", 1, { id: "kp-a", name: "章节A" }),
      makeQuestion("q-2", 1, { id: "kp-a", name: "章节A" }),
      makeQuestion("q-3", 1, { id: "kp-a", name: "章节A" }),
    ]);
    renderDialog([], {
      knowledgeOptions: [{ id: "kp-a", name: "章节A", path: "数据结构 / 章节A" }],
      knowledgeTree,
    });

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("tab", { name: "按配比" }));
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    expect(await screen.findByText(/当前条件只匹配到/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择测试学生" }));
    expect(screen.getByRole("button", { name: /确认发布/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "用 3 题生成" }));
    await user.click(screen.getByRole("button", { name: /确认发布/ }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const payload = mockPost.mock.calls[0][1] as { question_items?: unknown[] };
    expect(payload.question_items).toHaveLength(3);
  });

  it("模式切换与标题同一行，并共用固定高度的内容区", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("课程全部 3 题");
    const title = screen.getByRole("heading", { name: "智能创建练习" });
    const promptTab = screen.getByRole("tab", { name: "提示词" });
    expect(title.parentElement).toContainElement(promptTab);

    await user.click(screen.getByRole("tab", { name: "按条件" }));
    const modeContent = screen.getByTestId("smart-practice-mode-content");
    expect(modeContent).toHaveClass("h-[268px]", "sm:h-[132px]");
    await user.click(promptTab);
    expect(screen.getByTestId("smart-practice-mode-content")).toBe(modeContent);
  });

  it("知识点选择按树状展开并可选中子知识点", async () => {
    const user = userEvent.setup();
    const knowledgeTree: CourseKnowledgeNode = {
      id: "course-kp-1",
      name: "计算机网络",
      question_count: 0,
      material_count: 0,
      children: [
        {
          id: "kp-physical",
          name: "物理层",
          question_count: 0,
          material_count: 0,
          children: [
            {
              id: "kp-media",
              name: "传输介质",
              question_count: 0,
              material_count: 0,
              children: [],
            },
          ],
        },
      ],
    };
    renderDialog([], {
      knowledgeOptions: [
        { id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" },
        {
          id: "kp-media",
          name: "传输介质",
          path: "计算机网络 / 物理层 / 传输介质",
        },
      ],
      knowledgeTree,
    });

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("tab", { name: "按条件" }));
    // 触发按钮默认是「全部知识点」，点开后展示课程知识点树（一级默认展开）。
    await user.click(screen.getByRole("button", { name: "知识点：全部知识点" }));
    expect(screen.getByText("物理层")).toBeInTheDocument();
    await user.click(screen.getByText("传输介质"));

    expect(
      screen.getByRole("button", { name: "知识点：传输介质" }),
    ).toBeInTheDocument();
  });

  it("选中上级知识点时，预览把子知识点的题目一并纳入", async () => {
    const user = userEvent.setup();
    mockListCourseQuestions.mockResolvedValue([
      makeQuestion("q-parent", 1, { id: "kp-physical", name: "物理层" }),
      makeQuestion("q-child", 1, { id: "kp-media", name: "传输介质" }),
      makeQuestion("q-other", 1, { id: "kp-network", name: "网络层" }),
    ]);
    renderDialog([], {
      knowledgeOptions: [
        { id: "kp-physical", name: "物理层", path: "计算机网络 / 物理层" },
        {
          id: "kp-media",
          name: "传输介质",
          path: "计算机网络 / 物理层 / 传输介质",
        },
        { id: "kp-network", name: "网络层", path: "计算机网络 / 网络层" },
      ],
      initialKnowledgePointId: "kp-physical",
    });

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    expect(await screen.findByText(/题目 q-parent/)).toBeInTheDocument();
    expect(screen.getByText(/题目 q-child/)).toBeInTheDocument();
    expect(screen.queryByText(/题目 q-other/)).not.toBeInTheDocument();
  });

  it("预览确认后发布 7 天有效的练习", async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ data: { id: "practice-1" } });
    renderDialog();

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("button", { name: "生成预览" }));
    expect(screen.getByRole("button", { name: "选择测试学生" })).toHaveAttribute(
      "data-default-class-ids",
      "class-1",
    );
    await user.click(screen.getByRole("button", { name: "选择测试学生" }));
    await user.click(screen.getByRole("button", { name: "用 3 题生成" }));
    await user.click(screen.getByRole("button", { name: /确认发布/ }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const payload = mockPost.mock.calls[0][1] as {
      category: string;
      start_time: string;
      end_time: string;
      question_ids: string[];
    };
    expect(payload.category).toBe("practice");
    expect(payload.question_ids).toHaveLength(3);
    expect(
      new Date(payload.end_time).getTime() - new Date(payload.start_time).getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
