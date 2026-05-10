import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

vi.mock("@/pages/exams/components/ClassStudentSelector", () => ({
  ClassStudentSelector: ({
    onChange,
    defaultSupplementCollapsed,
  }: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    summaryLabel?: string;
    emptySummaryText?: string;
    defaultSupplementCollapsed?: boolean;
  }) => (
    <div>
      {defaultSupplementCollapsed && <p>补充方式默认收起</p>}
      <button type="button" onClick={() => onChange(["student-1"])}>
        选择学生
      </button>
      <button type="button" onClick={() => onChange([])}>
        清空学生
      </button>
    </div>
  ),
}));

import { GeneratedAssignmentDialog } from "./GeneratedAssignmentDialog";

describe("GeneratedAssignmentDialog", () => {
  it("renders title input and question count summary", () => {
    render(
      <GeneratedAssignmentDialog
        open
        defaultTitle="数字特征练习"
        questionCount={3}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "作业标题" })).toHaveValue("数字特征练习");
    expect(screen.getByText("将发布 3 道题")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-5xl");
    expect(screen.getByText("补充方式默认收起")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <GeneratedAssignmentDialog
        open
        defaultTitle="数字特征练习"
        questionCount={3}
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("enables publish only when title is non-empty and at least one student selected", async () => {
    const user = userEvent.setup();

    render(
      <GeneratedAssignmentDialog
        open
        defaultTitle=""
        questionCount={3}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const publishButton = screen.getByRole("button", { name: "发布作业" });
    const titleInput = screen.getByRole("textbox", { name: "作业标题" });

    expect(publishButton).toBeDisabled();

    await user.type(titleInput, "数字特征练习");
    expect(publishButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "选择学生" }));
    expect(publishButton).toBeEnabled();

    await user.clear(titleInput);
    expect(publishButton).toBeDisabled();
  });

  it("submits title and selected student ids", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <GeneratedAssignmentDialog
        open
        defaultTitle=""
        questionCount={2}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "作业标题" }), "线性代数练习");
    await user.click(screen.getByRole("button", { name: "选择学生" }));
    await user.click(screen.getByRole("button", { name: "发布作业" }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "线性代数练习",
      studentIds: ["student-1"],
    });
  });
});
