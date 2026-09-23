import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { ClassStudentsDialog } from "./ClassStudentsDialog";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

describe("ClassStudentsDialog", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue([
      {
        id: "student-1",
        full_name: "张三",
        username: "13800000001",
        phone: "13800000001",
        student_id: "S001",
      },
    ]);
  });

  it("loads and displays the students of the selected class", async () => {
    render(
      <ClassStudentsDialog
        classId="class-1"
        className="一班"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "一班 · 班级人员" }),
    ).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("S001")).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students?class_id=class-1");
  });
});
