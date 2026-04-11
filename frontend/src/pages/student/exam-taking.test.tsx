import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen } from "@/test/test-utils";

const axiosPostMock = vi.fn();
const navigateMock = vi.fn();
const useExamTakingMock = vi.fn();
const useVisibilityDetectionMock = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: {
        request: {
          use: vi.fn(),
        },
      },
      post: (...args: unknown[]) => axiosPostMock(...args),
    }),
  },
}));

vi.mock("@/hooks/use-exam-taking", () => ({
  useExamTaking: (...args: unknown[]) => useExamTakingMock(...args),
}));

vi.mock("@/hooks/use-visibility-detection", () => ({
  useVisibilityDetection: (...args: unknown[]) => useVisibilityDetectionMock(...args),
}));

vi.mock("./components/countdown-timer", () => ({
  CountdownTimer: ({ onTimeUp }: { onTimeUp: () => void }) => (
    <button type="button" onClick={onTimeUp}>
      触发时间到
    </button>
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { ExamTaking } from "./exam-taking";

describe("ExamTaking", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    navigateMock.mockReset();
    useExamTakingMock.mockReset();
    useVisibilityDetectionMock.mockReset();

    axiosPostMock.mockResolvedValue({
      data: {
        exam_id: "exam-1",
        title: "abc",
        duration_minutes: 60,
        max_switch_count: 0,
        started_at: "2026-04-09T10:00:00.000Z",
        end_time: "2026-04-09T11:00:00.000Z",
        questions: [
          {
            question_id: "q-1",
            order: 0,
            score: 5,
            type: "essay",
            title: "题目一",
            content: { text: "<p>题目一</p>" },
            options: null,
          },
          {
            question_id: "q-2",
            order: 1,
            score: 5,
            type: "choice",
            title: "题目二",
            content: { text: "<p>题目二</p>" },
            options: { A: "选项A", B: "选项B" },
          },
        ],
        saved_answers: { "q-1": { html: "已答" } },
        switch_count: 0,
      },
    });

    useExamTakingMock.mockReturnValue({
      answers: { "q-1": { html: "已答" } },
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
      showAll: false,
      setShowAll: vi.fn(),
      updateAnswer: vi.fn(),
      flushAnswers: vi.fn(),
      flushQuestion: vi.fn().mockResolvedValue(undefined),
      saveState: "idle",
      saveMessage: "",
      submitExam: vi.fn(),
      reportSwitch: vi.fn(),
    });

    useVisibilityDetectionMock.mockReturnValue({
      setCount: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the question navigation open by default", async () => {
    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("答题卡")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
  });

  it("lets students return to my exams from the exam header", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /返回我的考试/i }));
    expect(navigateMock).toHaveBeenCalledWith("/my-exams");
  });

  it("saves the current question before moving to the next one", async () => {
    const user = userEvent.setup();
    const flushQuestion = vi.fn().mockResolvedValue(undefined);
    const setCurrentIndex = vi.fn();

    useExamTakingMock.mockReturnValue({
      answers: { "q-1": { html: "已答" } },
      currentIndex: 0,
      setCurrentIndex,
      showAll: false,
      setShowAll: vi.fn(),
      updateAnswer: vi.fn(),
      flushAnswers: vi.fn(),
      flushQuestion,
      saveState: "idle",
      saveMessage: "",
      submitExam: vi.fn(),
      reportSwitch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /下一题/i }));
    expect(flushQuestion).toHaveBeenCalledWith("q-1");
    expect(setCurrentIndex).toHaveBeenCalledWith(1);
  });

  it("shows the lightweight save feedback message in the header", async () => {
    useExamTakingMock.mockReturnValue({
      answers: { "q-1": { html: "已答" } },
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
      showAll: false,
      setShowAll: vi.fn(),
      updateAnswer: vi.fn(),
      flushAnswers: vi.fn(),
      flushQuestion: vi.fn().mockResolvedValue(undefined),
      saveState: "saved",
      saveMessage: "已自动保存",
      submitExam: vi.fn(),
      reportSwitch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("已自动保存")).toBeInTheDocument();
  });

  it("uses a full-width workspace layout for code questions", async () => {
    useExamTakingMock.mockReturnValue({
      answers: {},
      currentIndex: 1,
      setCurrentIndex: vi.fn(),
      showAll: false,
      setShowAll: vi.fn(),
      updateAnswer: vi.fn(),
      flushAnswers: vi.fn(),
      flushQuestion: vi.fn().mockResolvedValue(undefined),
      saveState: "idle",
      saveMessage: "",
      submitExam: vi.fn(),
      reportSwitch: vi.fn(),
    });

    axiosPostMock.mockResolvedValue({
      data: {
        exam_id: "exam-1",
        title: "abc",
        duration_minutes: 60,
        max_switch_count: 0,
        started_at: "2026-04-09T10:00:00.000Z",
        end_time: "2026-04-09T11:00:00.000Z",
        questions: [
          {
            question_id: "q-1",
            order: 0,
            score: 5,
            type: "essay",
            title: "题目一",
            content: { text: "<p>题目一</p>" },
            options: null,
          },
          {
            question_id: "q-2",
            order: 1,
            score: 20,
            type: "code",
            title: "代码题",
            content: {
              description: "<p>实现一个函数</p>",
              starter_code: { python: "def solve():\n    pass\n" },
            },
            options: null,
          },
        ],
        saved_answers: {},
        switch_count: 0,
      },
    });

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    const content = await screen.findByTestId("exam-content-shell");
    expect(content.className).toContain("max-w-none");
    expect(content.className).toContain("px-4");
  });

  it("counts down and auto-submits before returning to my exams when time is up", async () => {
    vi.useFakeTimers();
    const submitExam = vi.fn().mockResolvedValue(undefined);

    useExamTakingMock.mockReturnValue({
      answers: {},
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
      showAll: false,
      setShowAll: vi.fn(),
      updateAnswer: vi.fn(),
      flushAnswers: vi.fn(),
      flushQuestion: vi.fn().mockResolvedValue(undefined),
      saveState: "idle",
      saveMessage: "",
      submitExam,
      reportSwitch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "触发时间到" }));

    expect(screen.getByText("考试时间到，3 秒后自动提交...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("考试时间到，2 秒后自动提交...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("考试时间到，1 秒后自动提交...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {});
    expect(submitExam).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(navigateMock).toHaveBeenCalledWith("/my-exams");
  });
});
