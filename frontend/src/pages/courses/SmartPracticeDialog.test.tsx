import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { apiClient } from "@/lib/api";
import { render, screen, waitFor } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { listCourseQuestions } from "./api";
import { SmartPracticeDialog } from "./SmartPracticeDialog";

vi.mock("@/lib/api", () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock("./api", () => ({
  listCourseQuestions: vi.fn(),
}));

vi.mock("@/pages/exams/components/ClassStudentSelector", () => ({
  ClassStudentSelector: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onChange(["student-1"])}>
      选择测试学生
    </button>
  ),
}));

const mockListCourseQuestions = vi.mocked(listCourseQuestions);
const mockPost = vi.mocked(apiClient.post);

function makeQuestion(id: string, difficulty = 1): IQuestion {
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
    knowledge_points: [],
    created_by: "teacher-1",
    created_by_name: "教师",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function renderDialog(selectedQuestionIds: string[] = []) {
  return render(
    <SmartPracticeDialog
      open
      onOpenChange={vi.fn()}
      courseId="course-1"
      courseName="数据结构"
      courseKpId="course-kp-1"
      courseSemesterId="semester-1"
      selectedQuestionIds={selectedQuestionIds}
      knowledgeOptions={[]}
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
      "请从这些题目中选取10道容易题，围绕“数据结构”生成一份练习。",
    );
  });

  it("模式切换与标题同一行，并共用固定高度的内容区", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText("课程全部 3 题");
    const title = screen.getByRole("heading", { name: "智能创建练习" });
    const promptTab = screen.getByRole("tab", { name: "提示词" });
    expect(title.parentElement).toContainElement(promptTab);

    const modeContent = screen.getByTestId("smart-practice-mode-content");
    expect(modeContent).toHaveClass("h-[268px]", "sm:h-[132px]");
    await user.click(promptTab);
    expect(screen.getByTestId("smart-practice-mode-content")).toBe(modeContent);
  });

  it("预览确认后发布 7 天有效的练习", async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ data: { id: "practice-1" } });
    renderDialog();

    await screen.findByText("课程全部 3 题");
    await user.click(screen.getByRole("button", { name: "生成预览" }));
    await user.click(screen.getByRole("button", { name: "选择测试学生" }));
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
