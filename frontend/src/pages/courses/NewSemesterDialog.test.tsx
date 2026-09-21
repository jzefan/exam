import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";

import { NewSemesterDialog } from "./NewSemesterDialog";
import type { CourseSemester } from "./api";

const { apiRequestMock, createCourseSemesterMock, listCourseTemplatesMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  createCourseSemesterMock: vi.fn(),
  listCourseTemplatesMock: vi.fn(),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("./api", () => ({
  createCourseSemester: createCourseSemesterMock,
}));

vi.mock("@/pages/courses/question-gen-templates/api", () => ({
  listCourseTemplates: listCourseTemplatesMock,
}));

const createdSemester: CourseSemester = {
  id: "semester-1",
  course_id: "course-1",
  name: "2026 秋季",
  description: null,
  semester_major_label: null,
  semester_major_description: null,
  class_ids: [],
  start_date: null,
  end_date: null,
  student_profile: null,
  exam_count: 0,
  assignment_count: 0,
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
};

function renderDialog(overrides?: {
  onCreated?: (semester: CourseSemester) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return render(
    <NewSemesterDialog
      courseId="course-1"
      open
      onOpenChange={overrides?.onOpenChange ?? vi.fn()}
      onCreated={overrides?.onCreated ?? vi.fn()}
    />,
  );
}

describe("NewSemesterDialog", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    createCourseSemesterMock.mockReset();
    listCourseTemplatesMock.mockReset();
    apiRequestMock.mockResolvedValue([]);
    listCourseTemplatesMock.mockResolvedValue([]);
    createCourseSemesterMock.mockResolvedValue(createdSemester);
  });

  it("renders a compact single-column form in the requested field order", async () => {
    renderDialog();

    await screen.findByText("暂无可选班级，可稍后在学生管理中创建并关联。");

    expect(screen.queryByText("只需填写学期名称即可创建，其余信息均可稍后补充或修改。")).not.toBeInTheDocument();
    expect(screen.queryByText("名称为必填项")).not.toBeInTheDocument();
    expect(screen.queryByText("均可稍后填写")).not.toBeInTheDocument();
    expect(screen.queryByText("可选")).not.toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "基本信息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "教学信息" })).not.toBeInTheDocument();
    expect(screen.getByTestId("new-semester-fields")).toHaveClass("flex", "flex-col");
    expect(screen.getByRole("heading", { name: "新建学期" }).parentElement).toHaveClass("py-4");

    expect(screen.getByLabelText(/学期名称/)).toBeRequired();
    expect(screen.getByText("*")).toHaveClass("text-destructive");
    expect(screen.getByText("用于区分本学期教学对象。").parentElement).toHaveClass("justify-between");

    const orderedFields = [
      screen.getByLabelText(/学期名称/),
      screen.getByText("关联班级"),
      screen.getByLabelText("专业标签"),
      screen.getByLabelText("专业描述"),
      screen.getByText("教学对象画像"),
      screen.getByLabelText("备注"),
    ];
    orderedFields.slice(0, -1).forEach((element, index) => {
      expect(element.compareDocumentPosition(orderedFields[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("creates a semester when only the name is filled", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onCreated, onOpenChange });

    const createButton = screen.getByRole("button", { name: "创建" });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText(/学期名称/), "  2026 秋季  ");
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    await waitFor(() => {
      expect(createCourseSemesterMock).toHaveBeenCalledWith("course-1", {
        name: "2026 秋季",
        description: null,
        semester_major_label: null,
        semester_major_description: null,
        class_ids: [],
        start_date: null,
        end_date: null,
        student_profile: null,
      });
    });
    expect(onCreated).toHaveBeenCalledWith(createdSemester);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
