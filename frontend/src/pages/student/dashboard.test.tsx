import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { StudentDashboard } from "./dashboard";
import { getStudentDateLocale } from "./i18n";

const useGetIdentityMock = vi.fn();
const useListMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentityMock(...args),
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("StudentDashboard", () => {
  it("shows the current student dashboard sections and lets students enter an ongoing exam directly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T09:00:00.000Z"));
    navigateMock.mockReset();

    useGetIdentityMock.mockReturnValue({
      data: { name: "stud-11" },
    });
    useListMock.mockReturnValue({
      query: {
        data: {
          data: [
            {
              id: "ongoing-1",
              title: "[测试] 7天持续进行中考试",
              description: "当前可进入",
              status: "ongoing",
              start_time: "2026-04-09T08:00:00.000Z",
              end_time: "2026-04-09T10:00:00.000Z",
              started_at: null,
              duration_minutes: 120,
              total_score: 100,
              max_switch_count: 0,
              allow_retake: false,
              notes_template: null,
              total_questions: 20,
              score: null,
              participated: false,
              submitted_at: null,
              created_by_name: "张老师",
            },
            {
              id: "upcoming-1",
              title: "[测试] Python 进阶练习",
              description: null,
              status: "upcoming",
              start_time: "2026-04-10T08:00:00.000Z",
              end_time: "2026-04-10T09:30:00.000Z",
              started_at: null,
              duration_minutes: 90,
              total_score: 100,
              max_switch_count: 0,
              allow_retake: false,
              notes_template: null,
              total_questions: 18,
              score: null,
              participated: false,
              submitted_at: null,
              created_by_name: "李老师",
            },
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
              allow_retake: false,
              notes_template: null,
              total_questions: 15,
              score: 86,
              participated: true,
              submitted_at: "2026-04-01T09:00:00.000Z",
              created_by_name: "王老师",
            },
          ],
        },
        isLoading: false,
      },
    });

    render(
      <MemoryRouter>
        <StudentDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /你好，stud-11/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待参加考试" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已参加考试" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "高效提分秘籍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看全部/i })).toBeInTheDocument();
    expect(screen.getByText("发布老师：张老师")).toBeInTheDocument();
    expect(screen.getByText("发布老师：李老师")).toBeInTheDocument();
    const enterExamButton = screen.getByRole("button", { name: /进入考试/i });
    expect(enterExamButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /考试名称/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /考试时间/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /提交时间/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /用时/i })).toBeInTheDocument();
    expect(screen.getByText("平均得分")).toBeInTheDocument();
    expect(screen.getByText("已过考试")).toBeInTheDocument();
    const expectedTimeCell = `${new Date("2026-04-01T08:00:00.000Z").toLocaleString(getStudentDateLocale("zh"), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })} - ${new Date("2026-04-01T09:00:00.000Z").toLocaleString(getStudentDateLocale("zh"), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    expect(
      screen.getByText(expectedTimeCell),
    ).toBeInTheDocument();
    expect(screen.getByText("58 分钟")).toBeInTheDocument();
    enterExamButton.click();
    expect(navigateMock).toHaveBeenCalledWith("/my-exams/ongoing-1/take");

    const detailButton = screen.getByRole("button", { name: "详情" });
    expect(detailButton).toBeVisible();
    detailButton.click();
    expect(navigateMock).toHaveBeenCalledWith("/my-exams/completed-1/result");

    vi.useRealTimers();
  });

  it("does not expose a result action for closed but unsubmitted exams", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T09:00:00.000Z"));
    navigateMock.mockReset();

    useGetIdentityMock.mockReturnValue({
      data: { name: "stud-11" },
    });
    useListMock.mockReturnValue({
      query: {
        data: {
          data: [
            {
              id: "closed-1",
              title: "[测试] 已结束未提交考试",
              description: null,
              status: "closed",
              start_time: "2026-04-09T08:00:00.000Z",
              end_time: "2026-04-09T09:00:00.000Z",
              started_at: "2026-04-09T08:03:00.000Z",
              duration_minutes: 60,
              total_score: 100,
              max_switch_count: 0,
              allow_retake: false,
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
        <StudentDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText("当前没有待参加的考试，去复习下错题吧。")).toBeInTheDocument();
    expect(screen.queryByText("[测试] 已结束未提交考试")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "详情" })).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
