import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { apiClient } from "@/lib/api";
import { render, screen } from "@/test/test-utils";

import { CreateFromSelectionDialog } from "./create-from-selection-dialog";

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: vi.fn(),
  },
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
      data-testid="student-selector"
      data-default-class-ids={defaultClassIds?.join(",") ?? ""}
      onClick={() => onChange(["student-1"])}
    >
      选择测试学生
    </button>
  ),
}));

const mockPost = apiClient.post as ReturnType<typeof vi.fn>;

function setup(props: {
  selected?: { id: string; type: string; score: number }[];
  defaultTitle?: string;
  defaultCategory?: "exam" | "practice";
  defaultClassIds?: string[];
}) {
  const onOpenChange = vi.fn();
  const onPublished = vi.fn();
  const user = userEvent.setup();
  const utils = render(
    <CreateFromSelectionDialog
      open
      onOpenChange={onOpenChange}
      onPublished={onPublished}
      selected={props.selected ?? [{ id: "1", type: "choice", score: 5 }]}
      defaultTitle={props.defaultTitle ?? "2026-05-11 练习"}
      defaultCategory={props.defaultCategory}
      defaultClassIds={props.defaultClassIds}
    />,
  );
  return { ...utils, onOpenChange, onPublished, user };
}

describe("CreateFromSelectionDialog", () => {
  it("展示所选题目的数量、题型、总分", () => {
    setup({
      selected: [
        { id: "1", type: "choice", score: 5 },
        { id: "2", type: "choice", score: 5 },
        { id: "3", type: "code", score: 10 },
      ],
    });

    expect(screen.getByText(/共 3 道题目/)).toBeInTheDocument();
    expect(screen.getByText(/选择 2 · 编程 1/)).toBeInTheDocument();
    expect(screen.getByText(/总分 20/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-11 练习")).toBeInTheDocument();
  });

  it("默认类型为练习，点击 '正式考试' 后切换", async () => {
    const { user } = setup({});

    expect(screen.getByRole("tab", { name: /练习/ })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: /正式考试/ }));
    expect(screen.getByRole("tab", { name: /正式考试/ })).toHaveAttribute("aria-selected", "true");
  });

  it("没有选题或标题为空时，提交按钮禁用", () => {
    const { rerender } = setup({
      selected: [],
      defaultTitle: "有标题",
    });
    expect(screen.getByRole("button", { name: /发布练习/ })).toBeDisabled();

    rerender(
      <CreateFromSelectionDialog
        open
        onOpenChange={vi.fn()}
        onPublished={vi.fn()}
        selected={[{ id: "1", type: "choice", score: 5 }]}
        defaultTitle=""
      />,
    );
    expect(screen.getByRole("button", { name: /发布练习/ })).toBeDisabled();
  });

  it("把当前学期关联班级交给学生选择器作为默认范围", () => {
    setup({ defaultClassIds: ["class-1", "class-2"] });

    expect(screen.getByTestId("student-selector")).toHaveAttribute(
      "data-default-class-ids",
      "class-1,class-2",
    );
  });

  it("提交成功后调用 onPublished 回调", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "exam-123" } });
    const { user, onPublished } = setup({
      selected: [{ id: "1", type: "choice", score: 5 }],
      defaultCategory: "exam",
    });

    const submitBtn = screen.getByRole("button", { name: /创建考试/ });
    expect(submitBtn).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "选择测试学生" }));
    await user.click(submitBtn);

    expect(mockPost).toHaveBeenCalledWith(
      "/api/exams",
      expect.objectContaining({ student_ids: ["student-1"] }),
    );
    expect(onPublished).toHaveBeenCalledWith("exam-123", "exam");
  });
});
