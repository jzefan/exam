import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { render, screen, waitFor, within } from "@/test/test-utils";

import { OperationsRegradingPage } from "./regrading";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/operations/regrading"]}>{ui}</MemoryRouter>);
}

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

describe("OperationsRegradingPage", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  it("loads assignees, then their exams, questions, and runs regrading for the selected question", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/api/operations/regrading/assignees") {
        return Promise.resolve({
          data: [
            {
              id: "admin-1",
              username: "admin01",
              full_name: "平台管理员",
              roles: ["platform_admin"],
              exam_count: 1,
              practice_count: 0,
            },
            {
              id: "teacher-1",
              username: "teacher01",
              full_name: "张老师",
              roles: ["teacher"],
              exam_count: 1,
              practice_count: 1,
            },
          ],
        });
      }
      if (url === "/api/operations/regrading/assignees/teacher-1/exams") {
        return Promise.resolve({
          data: [
            {
              id: "exam-1",
              title: "高数期末考试",
              kind: "exam",
              status: "published",
              total_questions: 3,
              submitted_count: 12,
            },
          ],
        });
      }
      if (url === "/api/operations/regrading/exams/exam-1/questions") {
        return Promise.resolve({
          data: [
            {
              question_id: "question-1",
              order: 2,
              type: "fill_in",
              title: "拉格朗日余项",
              content_preview: "函数 f(x) 在 x0 处...",
              score: 3,
              submitted_count: 12,
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });
    apiPostMock.mockResolvedValue({
      data: {
        exam_id: "exam-1",
        question_id: "question-1",
        question_type: "fill_in",
        affected_submissions: 12,
        updated_latest_answers: 12,
        created_grading_tasks: 0,
      },
    });

    renderWithRouter(<OperationsRegradingPage />);

    await userEvent.click(screen.getByRole("button", { name: /开始重新评分/i }));
    expect(screen.getByRole("heading", { name: /选择归属题目/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /平台管理员/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /管理员 1/i })).toBeInTheDocument();

    await screen.findByRole("button", { name: /张老师/i });
    await userEvent.click(screen.getByRole("button", { name: /张老师/i }));

    await screen.findByRole("button", { name: /高数期末考试/i });
    await userEvent.click(screen.getByRole("button", { name: /高数期末考试/i }));

    await screen.findByRole("button", { name: /第 2 题/i });
    await userEvent.click(screen.getByRole("button", { name: /第 2 题/i }));

    const footer = screen.getByTestId("regrading-dialog-footer");
    await userEvent.click(within(footer).getByRole("button", { name: /确认重新评分/i }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        "/api/operations/regrading/exams/exam-1/questions/question-1",
      );
    });
    expect(await screen.findByText(/已重新评分 12 份提交/i)).toBeInTheDocument();
  });
});
