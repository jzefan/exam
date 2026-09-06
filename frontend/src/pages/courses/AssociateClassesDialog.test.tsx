import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { AssociateClassesDialog } from "./AssociateClassesDialog";
import type { CourseSemester } from "./api";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

const semester: CourseSemester = {
  id: "semester-1",
  course_id: "course-1",
  name: "2026 春季",
  description: null,
  semester_major_label: null,
  semester_major_description: null,
  class_ids: [],
  start_date: null,
  end_date: null,
  student_profile: null,
  exam_count: 0,
  assignment_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("AssociateClassesDialog", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue([]);
  });

  it("links teachers to student management when no classes are available", async () => {
    render(
      <MemoryRouter>
        <AssociateClassesDialog
          courseId="course-1"
          semesters={[semester]}
          open
          onOpenChange={vi.fn()}
          onUpdated={vi.fn()}
        />
      </MemoryRouter>,
    );

    const studentManagementLink = await screen.findByRole("link", {
      name: "学生管理",
    });

    expect(studentManagementLink).toHaveAttribute("href", "/students");
    expect(studentManagementLink).toHaveClass("text-primary", "underline");
  });
});
