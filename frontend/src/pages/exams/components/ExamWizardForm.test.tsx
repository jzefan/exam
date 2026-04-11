import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@/test/test-utils";

import { ExamWizardForm } from "./ExamWizardForm";
import { DEFAULT_NOTES, type ExamFormValues } from "./exam-form-utils";

const useGetIdentityMock = vi.fn();
const useListMock = vi.fn();
const navigateMock = vi.fn();

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
    question_ids: ["question-1"],
    question_items: [{ question_id: "question-1", order: 0, score_override: 100 }],
    student_ids: ["student-1"],
  };
}

describe("ExamWizardForm", () => {
  beforeEach(() => {
    useGetIdentityMock.mockReturnValue({ data: { id: "teacher-1" } });
    useListMock.mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      if (resource === "questions") {
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
});
