import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";
import { render, screen } from "@/test/test-utils";

import { MyExams } from "./my-exams";

const useListMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("MyExams", () => {
  it("puts already-started exams into the ongoing section even if backend status is upcoming", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-09T09:00:00.000Z"));
      navigateMock.mockReset();

      useListMock.mockReturnValue({
        query: {
          data: {
            data: [
              {
                id: "started-1",
                title: "[测试] 已开考考试",
                description: "当前可进入",
                status: "upcoming",
                start_time: "2026-04-09T08:00:00.000Z",
                end_time: "2026-04-09T10:00:00.000Z",
                started_at: null,
                duration_minutes: 120,
                total_score: 100,
                max_switch_count: 0,
                notes_template: null,
                total_questions: 20,
                score: null,
                participated: false,
                submitted_at: null,
                created_by_name: "张老师",
              },
            ],
          },
          isLoading: false,
        },
      });

      render(
        <MemoryRouter>
          <MyExams />
        </MemoryRouter>,
      );

      expect(screen.getByText("发布老师：张老师")).toBeInTheDocument();
      expect(screen.queryByText("即将开始")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /立即进入考场/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows empty states for both pending and completed tabs", async () => {
    const user = userEvent.setup();
    navigateMock.mockReset();

    useListMock.mockReturnValue({
      query: {
        data: { data: [] },
        isLoading: false,
      },
    });

    render(
      <MemoryRouter>
        <MyExams />
      </MemoryRouter>,
    );

    expect(screen.getByText("暂无待参加的考试计划")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /已参加记录/i }));

    expect(screen.getByText("暂无已参加记录")).toBeInTheDocument();
  });

  it("opens the exam result page when clicking a completed exam record", async () => {
    const user = userEvent.setup();
    navigateMock.mockReset();

    useListMock.mockReturnValue({
      query: {
        data: {
          data: [
            {
              id: "completed-1",
              title: "[测试] 数据库原理阶段测验",
              description: null,
              status: "completed",
              start_time: "2026-04-01T08:00:00.000Z",
              end_time: "2026-04-01T09:00:00.000Z",
              started_at: "2026-04-01T08:02:00.000Z",
              duration_minutes: 60,
              total_score: 100,
              max_switch_count: 0,
              notes_template: null,
              total_questions: 15,
              score: 86,
              participated: true,
              submitted_at: "2026-04-01T09:00:00.000Z",
            },
          ],
        },
        isLoading: false,
      },
    });

    render(
      <MemoryRouter>
        <MyExams />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /已参加记录/i }));
    await user.click(screen.getByRole("button", { name: /\[测试\] 数据库原理阶段测验/i }));

    expect(navigateMock).toHaveBeenCalledWith("/my-exams/completed-1/result");
  });

  it("does not list closed but unsubmitted exams under completed records", async () => {
    const user = userEvent.setup();
    navigateMock.mockReset();

    useListMock.mockReturnValue({
      query: {
        data: {
          data: [
            {
              id: "closed-1",
              title: "[测试] 已结束未提交考试",
              description: null,
              status: "closed",
              start_time: "2000-04-09T08:00:00.000Z",
              end_time: "2000-04-09T09:00:00.000Z",
              started_at: "2000-04-09T08:03:00.000Z",
              duration_minutes: 60,
              total_score: 100,
              max_switch_count: 0,
              notes_template: null,
              total_questions: 15,
              score: null,
              participated: false,
              submitted_at: null,
            },
          ],
        },
        isLoading: false,
      },
    });

    render(
      <MemoryRouter>
        <MyExams />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /已参加记录/i }));

    expect(screen.getByText("暂无已参加记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\[测试\] 已结束未提交考试/i })).not.toBeInTheDocument();
  });
});
