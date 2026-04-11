import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExamTaking } from "./use-exam-taking";

const axiosPostMock = vi.fn();

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

const examData = {
  exam_id: "exam-1",
  title: "考试",
  duration_minutes: 60,
  max_switch_count: 0,
  started_at: "2026-04-09T10:00:00.000Z",
  end_time: "2026-04-09T11:00:00.000Z",
  questions: [],
  saved_answers: {},
  switch_count: 0,
};

describe("useExamTaking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    axiosPostMock.mockReset();
    axiosPostMock.mockResolvedValue({});
  });

  it("auto-saves filled answers after 30 seconds", async () => {
    const { result } = renderHook(() => useExamTaking({ examData }));

    act(() => {
      result.current.updateAnswer("q-1", { selected: ["A"] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(axiosPostMock).toHaveBeenCalledWith("/api/student/exams/exam-1/answers", {
      answers: [
        {
          question_id: "q-1",
          answer_content: { selected: ["A"] },
        },
      ],
    });
  });

  it("does not auto-save empty answers", async () => {
    const { result } = renderHook(() => useExamTaking({ examData }));

    act(() => {
      result.current.updateAnswer("q-1", {});
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("flushes the current question immediately when requested", async () => {
    const { result } = renderHook(() => useExamTaking({ examData }));

    act(() => {
      result.current.updateAnswer("q-1", { html: "<p>答案</p>" });
    });

    await act(async () => {
      await result.current.flushQuestion("q-1");
    });

    expect(axiosPostMock).toHaveBeenCalledWith("/api/student/exams/exam-1/answers", {
      answers: [
        {
          question_id: "q-1",
          answer_content: { html: "<p>答案</p>" },
        },
      ],
    });
  });

  it("exposes save feedback for success and failure", async () => {
    const { result } = renderHook(() => useExamTaking({ examData }));

    act(() => {
      result.current.updateAnswer("q-1", { selected: ["A"] });
    });

    await act(async () => {
      await result.current.flushQuestion("q-1");
    });

    expect(result.current.saveState).toBe("saved");
    expect(result.current.saveMessage).toBe("已自动保存");

    axiosPostMock.mockRejectedValueOnce(new Error("save failed"));

    act(() => {
      result.current.updateAnswer("q-1", { selected: ["B"] });
    });

    await act(async () => {
      await expect(result.current.flushQuestion("q-1")).rejects.toThrow("save failed");
    });

    expect(result.current.saveState).toBe("error");
    expect(result.current.saveMessage).toBe("保存失败，稍后重试");
  });

  it("submits current in-memory answers together with the final submit request", async () => {
    const { result } = renderHook(() => useExamTaking({ examData }));

    act(() => {
      result.current.updateAnswer("q-1", { selected: ["A"] });
    });

    await act(async () => {
      await result.current.submitExam();
    });

    expect(axiosPostMock).toHaveBeenCalledWith("/api/student/exams/exam-1/submit", {
      answers: [
        {
          question_id: "q-1",
          answer_content: { selected: ["A"] },
        },
      ],
    });
  });
});
