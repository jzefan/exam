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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
        allow_retake: false,
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

  it("keeps the question navigation closed by default and shows a hint for the answer card", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("右上角的答题卡可以快速跳转到任意题目，适合回看和检查未完成的题。")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "打开答题卡" }).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "打开答题卡" })[1]);

    expect(screen.getByText("答题卡")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(screen.queryByText("右上角的答题卡可以快速跳转到任意题目，适合回看和检查未完成的题。")).not.toBeInTheDocument();
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

  it("explains that the personal exam time is exhausted instead of auto-submitting on re-entry", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-09T11:00:01.000Z").getTime());
    const submitExam = vi.fn();

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

    axiosPostMock.mockResolvedValue({
      data: {
        exam_id: "exam-1",
        title: "abc",
        duration_minutes: 60,
        max_switch_count: 0,
        allow_retake: false,
        started_at: "2026-04-09T10:00:00.000Z",
        end_time: "2026-04-09T12:00:00.000Z",
        questions: [],
        saved_answers: {},
        switch_count: 0,
      },
    });

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("本次考试答题时间已用完")).toBeInTheDocument();
    expect(screen.getByText("系统从你第一次进入考试时开始计时。当前已超过本次考试的答题时长，因此不能继续作答。")).toBeInTheDocument();
    expect(screen.getByText("如果你认为这是异常情况，请联系老师处理。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "触发时间到" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看考试结果" })).not.toBeInTheDocument();
    expect(submitExam).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "返回我的考试" }));
    expect(navigateMock).toHaveBeenCalledWith("/my-exams");
    dateNowSpy.mockRestore();
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

  it("shows a loading state while moving to the next question", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    const flushQuestion = vi.fn().mockReturnValue(deferred.promise);

    useExamTakingMock.mockReturnValue({
      answers: { "q-1": { html: "已答" } },
      currentIndex: 0,
      setCurrentIndex: vi.fn(),
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

    expect(screen.getByRole("button", { name: /下一题处理中/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /交卷/i })).toBeDisabled();

    deferred.resolve();
    await act(async () => {
      await deferred.promise;
    });
  });

  it("shows a submit button instead of next question on the last question", async () => {
    const user = userEvent.setup();

    useExamTakingMock.mockReturnValue({
      answers: { "q-2": { selected: ["A"] } },
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

    render(
      <MemoryRouter initialEntries={["/my-exams/exam-1/take"]}>
        <Routes>
          <Route path="/my-exams/:id/take" element={<ExamTaking />} />
        </Routes>
      </MemoryRouter>,
    );

    const submitButtons = await screen.findAllByRole("button", { name: /交卷/i });
    expect(submitButtons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /下一题/i })).not.toBeInTheDocument();

    await user.click(submitButtons[1]);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
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
        allow_retake: false,
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
    expect(content.className).toContain("h-full");
    expect(content.className).toContain("w-full");
    expect(content.className).toContain("px-0");
  });

  it("hides the answer-card hint and top mode row for single code questions", async () => {
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
        allow_retake: false,
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

    await screen.findByTestId("exam-content-shell");
    expect(screen.queryByText("右上角的答题卡可以快速跳转到任意题目，适合回看和检查未完成的题。")).not.toBeInTheDocument();
    expect(screen.queryByText("全部显示")).not.toBeInTheDocument();
    expect(screen.queryByText("编程")).not.toBeInTheDocument();
  });

  it("shows previous and next navigation in the header for code questions when the exam has multiple questions", async () => {
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
        allow_retake: false,
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
          {
            question_id: "q-3",
            order: 2,
            score: 5,
            type: "choice",
            title: "题目三",
            content: { text: "<p>题目三</p>" },
            options: { A: "A", B: "B" },
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

    expect(await screen.findByRole("button", { name: /上一题/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一题/i })).toBeInTheDocument();
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
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

  it("shows a loading state while submitting from the confirmation dialog", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    const submitExam = vi.fn().mockReturnValue(deferred.promise);

    useExamTakingMock.mockReturnValue({
      answers: { "q-1": { html: "已答" }, "q-2": { selected: ["A"] } },
      currentIndex: 1,
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

    await user.click(await screen.findAllByRole("button", { name: /交卷/i }).then((buttons) => buttons[1]));
    await user.click(await screen.findByRole("button", { name: "确认交卷" }));

    expect(screen.getByText("正在提交考试...")).toBeInTheDocument();
    expect(screen.getByText("请稍候，请勿关闭页面")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    deferred.resolve();
    await act(async () => {
      await deferred.promise;
    });
  });
});
