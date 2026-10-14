import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";
import { GradingCenterPage } from "./index";
import { apiRequest, GradingApiError } from "./api";
import { createGradingApiHandler } from "./test-handlers";
import { readRecentGradingTask } from "./recent-task";

// GradingCenterPage funnels every backend call through `apiRequest`, so mocking
// that one export gives us full control over the grading endpoints.
vi.mock("./api", () => ({ apiRequest: vi.fn() }));

const apiRequestMock = vi.mocked(apiRequest);

function renderGradingCenter(initialEntry = "/grading") {
  // The page relies on react-router hooks (useLocation/useNavigate/
  // useSearchParams), so it must render inside a Router.
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GradingCenterPage />
      <RouteProbe />
    </MemoryRouter>,
  );
}

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="grading-location">{location.search}</output>;
}

beforeEach(() => {
  localStorage.clear(); // grading_mode is persisted per-session — reset it between tests
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(createGradingApiHandler() as never);
});

describe("GradingCenterPage", () => {
  it("loads the inbox and renders the question-mode workspace", async () => {
    renderGradingCenter();

    expect(screen.getByRole("heading", { name: "阅卷中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /按题目阅卷/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /按考生阅卷/ })).toBeInTheDocument();

    // Default mode is 「按题目阅卷」: sidebar groups exams/questions.
    expect(screen.getByText("待阅试卷和题目")).toBeInTheDocument();
    expect(await screen.findByText("Java 后端期中考试")).toBeInTheDocument();

    // Middle column shows the candidate list and the score-confirm action.
    expect(await screen.findByText("考生列表")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定分数" })).toBeInTheDocument();

    // Candidate list comes from the question-detail endpoint…
    expect(await screen.findByText("李四")).toBeInTheDocument();
    // …and the model opinions come from the candidate-detail endpoint.
    expect(await screen.findByText("Qwen")).toBeInTheDocument();
  });

  it("shows each AI scoring dimension's awarded and maximum scores", async () => {
    renderGradingCenter();

    expect(await screen.findByText("要点覆盖")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
  });

  it("switches to candidate mode and renders the per-candidate workspace", async () => {
    const user = userEvent.setup();
    renderGradingCenter();

    // Let the default question-mode load settle before switching modes.
    await screen.findByText("Java 后端期中考试");

    await user.click(screen.getByRole("button", { name: /按考生阅卷/ }));

    // Sidebar header reflects candidate mode; the middle-column header now shows
    // the active candidate's info (name + 学号), with 学号 unique to that header.
    expect(await screen.findByText("待阅试卷和考生")).toBeInTheDocument();
    expect(await screen.findByText("A-101")).toBeInTheDocument();

    // Context bar exposes per-candidate navigation; action row steps questions.
    expect(screen.getByRole("button", { name: /下一位考生/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一题" })).toBeInTheDocument();

    // The candidate roster is aggregated from the question-detail matrix.
    expect(await screen.findByText("李四")).toBeInTheDocument();
  });

  it("opens a compact task, confirms its score, then advances only after the request succeeds", async () => {
    const user = userEvent.setup();
    renderGradingCenter();

    await screen.findByText("Java 后端期中考试");
    await user.click(screen.getByRole("button", { name: /请解释 JVM 内存模型的组成/ }));

    expect(await screen.findByLabelText("人工评分")).toHaveValue(8);
    expect(screen.getByTestId("grading-location").textContent).toContain("taskId=task-q1-a");

    await user.click(screen.getByRole("button", { name: "确认并下一项" }));
    expect(apiRequestMock).toHaveBeenCalledWith("/grading/tasks/task-q1-a/confirm", { method: "POST" });
    expect(await screen.findByLabelText("人工评分")).toHaveValue(5);
    await waitFor(() => expect(screen.getByTestId("grading-location").textContent).toContain("taskId=task-q1-b"));
  });

  it("keeps the current score and task when confirmation fails", async () => {
    const handler = createGradingApiHandler();
    apiRequestMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === "/grading/tasks/task-q1-a/confirm") throw new Error("网络暂不可用");
      return handler(path, init);
    }) as never);
    const user = userEvent.setup();
    renderGradingCenter();

    await screen.findByText("Java 后端期中考试");
    await user.click(screen.getByRole("button", { name: /请解释 JVM 内存模型的组成/ }));
    const score = await screen.findByLabelText("人工评分");
    await user.clear(score);
    await user.type(score, "7");
    await user.click(screen.getByRole("button", { name: "确认并下一项" }));

    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("网络暂不可用");
    expect(screen.getByLabelText("人工评分")).toHaveValue(7);
    expect(screen.getByTestId("grading-location").textContent).toContain("taskId=task-q1-a");
  });

  it("returns a missing deep-linked task to the queue", async () => {
    const handler = createGradingApiHandler();
    apiRequestMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === "/grading/inbox/tasks/missing") throw new GradingApiError("任务不存在", 404);
      return handler(path, init);
    }) as never);

    renderGradingCenter("/grading?taskId=missing&questionRef=exam-1%3A%3Aq-1");

    expect(await screen.findByText("这份阅卷任务已不可访问，请从队列重新选择。")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("grading-location").textContent).not.toContain("taskId="));
    expect(screen.getByText("待阅试卷和题目")).toBeInTheDocument();
  });

  it("recovers a missing task link in candidate mode", async () => {
    const handler = createGradingApiHandler();
    apiRequestMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === "/grading/inbox/tasks/missing") throw new GradingApiError("任务不存在", 404);
      return handler(path, init);
    }) as never);

    renderGradingCenter("/grading?taskId=missing&mode=candidate&questionRef=exam-1%3A%3Aq-1");

    expect(await screen.findByText("这份阅卷任务已不可访问，请从队列重新选择。")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("grading-location").textContent).not.toContain("taskId="));
  });

  it("clears the resume entry after confirming the final task", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "teacher-a", primary_org: { role_name: "teacher" } }));
    const user = userEvent.setup();
    renderGradingCenter();

    await screen.findByText("Java 后端期中考试");
    await user.click(screen.getByRole("button", { name: /实现一个线程安全的单例模式/ }));
    await user.click(await screen.findByRole("button", { name: "李四" }));
    await waitFor(() => expect(readRecentGradingTask()?.taskId).toBe("task-q2-b"));
    await user.click(screen.getByRole("button", { name: "确认分数" }));

    await waitFor(() => expect(readRecentGradingTask()).toBeNull());
  });
});
