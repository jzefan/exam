import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";

import { ExamStudentsPage } from "./students";

const useListMock = vi.fn();
const apiRequestMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("ExamStudentsPage", () => {
  it("sorts exams from near to far and loads student list for the latest exam first", async () => {
    useListMock.mockReturnValue({
      query: {
        data: {
          data: [
            {
              id: "exam-old",
              title: "较早考试",
              start_time: "2026-04-08T09:00:00.000Z",
              created_at: "2026-04-01T00:00:00.000Z",
              total_students: 1,
            },
            {
              id: "exam-new",
              title: "最近考试",
              start_time: "2026-04-12T09:00:00.000Z",
              created_at: "2026-04-02T00:00:00.000Z",
              total_students: 2,
            },
          ],
        },
        isLoading: false,
      },
    });

    apiRequestMock.mockResolvedValue([
      {
        student_id: "stu-1",
        full_name: "考生乙",
        username: "2026002",
        started_at: "2026-04-12T09:10:00.000Z",
        submitted_at: null,
      },
      {
        student_id: "stu-2",
        full_name: "考生甲",
        username: "2026001",
        started_at: "2026-04-12T09:05:00.000Z",
        submitted_at: "2026-04-12T10:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <ExamStudentsPage />
      </MemoryRouter>,
    );

    const examButtons = screen.getAllByRole("button");
    expect(examButtons.find((button) => button.textContent?.includes("最近考试"))).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith("/exams/exam-new/students");

    await waitFor(() => {
      expect(screen.getByText("考生甲")).toBeInTheDocument();
      expect(screen.getByText("考生乙")).toBeInTheDocument();
    });
  });
});
