import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { render, screen } from "@/test/test-utils";

import { ExamTakingMobile } from "./exam-taking-mobile";
import type { IExamTaking } from "@/types";

vi.mock("./components/countdown-timer", () => ({
  CountdownTimer: () => <span>01:24:49</span>,
}));

const examData: IExamTaking = {
  exam_id: "exam-1",
  title: "2025-2026学年第2学期 Java 面向对象程序设计期末考试",
  category: "exam",
  duration_minutes: 90,
  max_switch_count: 0,
  allow_retake: false,
  started_at: "2026-06-08T04:00:00.000Z",
  end_time: "2026-06-08T05:30:00.000Z",
  switch_count: 0,
  saved_answers: {},
  questions: [
    {
      question_id: "q-1",
      order: 1,
      score: 2,
      type: "choice",
      title: "类是对象的蓝图",
      content: {
        text: "<p>类是对象的蓝图，对象是类的实例。以下关于类和对象的说法中，错误的是：</p>",
      },
      options: {
        A: "一个类可以创建多个对象",
        B: "对象是类的具体化",
        C: "类定义了对象的属性和方法",
        D: "对象可以直接调用类的方法，而不需要实例化对象",
      },
    },
  ],
};

const multiQuestionExam: IExamTaking = {
  ...examData,
  questions: [
    examData.questions[0],
    { ...examData.questions[0], question_id: "q-2", order: 2 },
    { ...examData.questions[0], question_id: "q-3", order: 3 },
  ],
};

function renderShell(props: Partial<Parameters<typeof ExamTakingMobile>[0]> = {}) {
  const setCurrentIndex = vi.fn();
  const flushQuestion = vi.fn().mockResolvedValue(undefined);
  render(
    <ExamTakingMobile
      examData={multiQuestionExam}
      answers={{}}
      currentIndex={1}
      setCurrentIndex={setCurrentIndex}
      saveState="saved"
      updateAnswer={vi.fn()}
      flushQuestion={flushQuestion}
      isSubmittingAction={false}
      switchWarning={null}
      onBack={vi.fn()}
      onTimeUp={vi.fn()}
      onSubmitConfirm={vi.fn()}
      {...props}
    />,
  );
  return { setCurrentIndex, flushQuestion };
}

function swipe(element: HTMLElement, fromX: number, toX: number) {
  fireEvent.touchStart(element, {
    touches: [{ clientX: fromX, clientY: 200 }],
    changedTouches: [{ clientX: fromX, clientY: 200 }],
  });
  fireEvent.touchEnd(element, {
    touches: [],
    changedTouches: [{ clientX: toX, clientY: 205 }],
  });
}

describe("ExamTakingMobile", () => {
  it("does not create horizontal page overflow on phone-width layouts", () => {
    render(
      <ExamTakingMobile
        examData={examData}
        answers={{}}
        currentIndex={0}
        setCurrentIndex={vi.fn()}
        saveState="saved"
        updateAnswer={vi.fn()}
        flushQuestion={vi.fn().mockResolvedValue(undefined)}
        isSubmittingAction={false}
        switchWarning={null}
        onBack={vi.fn()}
        onTimeUp={vi.fn()}
        onSubmitConfirm={vi.fn()}
      />,
    );

    const shell = screen.getByTestId("mobile-exam-shell");
    const content = screen.getByTestId("mobile-exam-content");

    expect(shell.className).not.toContain("w-screen");
    expect(shell.className).toContain("w-full");
    expect(shell.className).toContain("overflow-x-hidden");
    expect(content.className).toContain("overflow-x-hidden");
  });

  it("advances to the next question on a left swipe", async () => {
    const { setCurrentIndex, flushQuestion } = renderShell();
    const content = screen.getByTestId("mobile-exam-content");

    await act(async () => swipe(content, 300, 180)); // right-to-left

    expect(flushQuestion).toHaveBeenCalledWith("q-2");
    expect(setCurrentIndex).toHaveBeenCalledWith(2);
  });

  it("returns to the previous question on a right swipe", async () => {
    const { setCurrentIndex } = renderShell();
    const content = screen.getByTestId("mobile-exam-content");

    await act(async () => swipe(content, 100, 260)); // left-to-right

    expect(setCurrentIndex).toHaveBeenCalledWith(0);
  });

  it("does not navigate past the last question on a left swipe", async () => {
    const { setCurrentIndex } = renderShell({
      currentIndex: multiQuestionExam.questions.length - 1,
    });
    const content = screen.getByTestId("mobile-exam-content");

    await act(async () => swipe(content, 300, 120));

    expect(setCurrentIndex).not.toHaveBeenCalled();
  });

  it("ignores a vertical scroll gesture", async () => {
    const { setCurrentIndex } = renderShell();
    const content = screen.getByTestId("mobile-exam-content");

    await act(async () => {
      fireEvent.touchStart(content, {
        touches: [{ clientX: 200, clientY: 100 }],
        changedTouches: [{ clientX: 200, clientY: 100 }],
      });
      fireEvent.touchEnd(content, {
        touches: [],
        changedTouches: [{ clientX: 150, clientY: 400 }],
      });
    });

    expect(setCurrentIndex).not.toHaveBeenCalled();
  });
});
