import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";
import type { IPaperDetail } from "@/types";

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
      选择学生
    </button>
  ),
}));

vi.mock("./api", () => ({
  paperApiRequest: vi.fn(),
}));

import { paperApiRequest } from "./api";
import { PaperQuickPublishDialog, type PaperQuickPublishMode } from "./quick-publish-dialog";

const paper = {
  id: "paper-1",
  title: "数据结构期中卷",
  description: "来自课程试卷",
  total_score: 100,
  question_count: 1,
  questions: [
    {
      question_id: "question-1",
      order: 0,
      score_override: 10,
    },
  ],
} as IPaperDetail;

describe("PaperQuickPublishDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["exam", "创建考试"] as const,
    ["practice", "发布练习"] as const,
  ])(
    "keeps course context when quick publishing a %s from course papers",
    async (mode: PaperQuickPublishMode, submitLabel: string) => {
      const user = userEvent.setup();
      vi.mocked(paperApiRequest).mockResolvedValue({ id: "exam-1" });

      render(
        <PaperQuickPublishDialog
          open
          mode={mode}
          paper={paper}
          courseKpId="course-1"
          courseSemesterId="semester-1"
          defaultClassIds={["class-1"]}
          onOpenChange={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: "选择学生" }));
      expect(screen.getByRole("button", { name: "选择学生" })).toHaveAttribute(
        "data-default-class-ids",
        "class-1",
      );
      await user.click(screen.getByRole("button", { name: submitLabel }));

      await waitFor(() => expect(paperApiRequest).toHaveBeenCalled());
      const [, init] = vi.mocked(paperApiRequest).mock.calls[0];
      const body = JSON.parse(String(init?.body));

      expect(body).toMatchObject({
        category: mode,
        course_kp_id: "course-1",
        course_semester_id: "semester-1",
        question_ids: ["question-1"],
        student_ids: ["student-1"],
      });
    },
  );
});
