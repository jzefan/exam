import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { ExamCard } from "./ExamCard";

describe("ExamCard", () => {
  it("offers the detailed grading workbook export from the collapsed action menu", async () => {
    const user = userEvent.setup();
    const onExportGradingDetails = vi.fn();

    render(
      <ExamCard
        exam={{
          id: "exam-1",
          category: "exam",
          title: "期中考试",
          status: "completed",
          start_time: null,
          end_time: null,
          total_questions: 2,
          total_score: 20,
          total_students: 1,
          submitted_count: 0,
          has_student_history: true,
          knowledge_points: [],
        }}
        onView={vi.fn()}
        onAnalysis={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onExportGradingDetails={onExportGradingDetails}
        collapseSecondaryActions
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menu")).toHaveClass(
      "max-h-[min(32rem,calc(100vh-2rem))]",
      "overflow-y-auto",
    );
    await user.click(screen.getByRole("menuitem", { name: "答题与批改明细（Excel）" }));
    expect(onExportGradingDetails).toHaveBeenCalledWith("xlsx");

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "答题与批改明细（HTML）" }));
    expect(onExportGradingDetails).toHaveBeenLastCalledWith("html");
  });

  it("shows a persistent loading state while grading details are generated", async () => {
    const user = userEvent.setup();
    let finishExport: (() => void) | undefined;
    const onExportGradingDetails = vi.fn(
      () => new Promise<void>((resolve) => {
        finishExport = resolve;
      }),
    );

    render(
      <ExamCard
        exam={{
          id: "exam-1",
          category: "exam",
          title: "期中考试",
          status: "completed",
          start_time: null,
          end_time: null,
          total_questions: 2,
          total_score: 20,
          total_students: 1,
          submitted_count: 1,
          has_student_history: true,
          knowledge_points: [],
        }}
        onView={vi.fn()}
        onAnalysis={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onExportGradingDetails={onExportGradingDetails}
        collapseSecondaryActions
        revealActionsOnHover
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "答题与批改明细（HTML）" }));

    const loadingButton = screen.getByRole("button", { name: "正在分析并生成答题与批改明细" });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveTextContent("正在生成");
    expect(loadingButton.parentElement).toHaveClass("md:visible", "md:pointer-events-auto");
    expect(screen.getByRole("status", { name: "正在加载" })).toBeInTheDocument();

    finishExport?.();
    expect(await screen.findByRole("button", { name: "更多操作" })).toBeEnabled();
  });
});
