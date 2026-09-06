import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";
import { GradingCenterPage } from "./index";
import { apiRequest } from "./api";
import { createGradingApiHandler } from "./test-handlers";

// GradingCenterPage funnels every backend call through `apiRequest`, so mocking
// that one export gives us full control over the grading endpoints.
vi.mock("./api", () => ({ apiRequest: vi.fn() }));

const apiRequestMock = vi.mocked(apiRequest);

function renderGradingCenter() {
  // The page relies on react-router hooks (useLocation/useNavigate/
  // useSearchParams), so it must render inside a Router.
  return render(
    <MemoryRouter>
      <GradingCenterPage />
    </MemoryRouter>,
  );
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
});
