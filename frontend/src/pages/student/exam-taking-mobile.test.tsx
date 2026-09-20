import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { render, screen, within } from "@/test/test-utils";

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

describe("ExamTakingMobile 移动端改版布局", () => {
  it("把交卷放在顶栏，底栏不再有交卷", () => {
    renderShell();

    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByRole("button", { name: "交卷" })).toBeInTheDocument();

    const bottomBar = screen.getByRole("contentinfo");
    expect(within(bottomBar).queryByRole("button", { name: "交卷" })).toBeNull();
    expect(within(bottomBar).getByRole("button", { name: "题目导航" })).toBeInTheDocument();
  });

  it("题号在左、倒计时在题号行最右，且顶栏不再放倒计时", () => {
    renderShell();

    const infoRow = screen.getByTestId("mobile-exam-info-row");
    const timer = within(infoRow).getByText("01:24:49");

    expect(infoRow.textContent).toMatch(/第\s*2\s*题\s*\/\s*共\s*3\s*题/);
    // 倒计时是这一行最右侧的最后一个元素
    expect(infoRow.lastElementChild).toContainElement(timer);
    expect(infoRow.lastElementChild?.lastElementChild).toBe(timer);
    // 保存态在倒计时左边
    expect(within(infoRow).getByText(/已(本地保存|同步)/)).toBeInTheDocument();

    expect(within(screen.getByRole("banner")).queryByText("01:24:49")).toBeNull();
  });

  it("题号前显示题型短标签，题型不随题号一起被截断", () => {
    renderShell();

    const infoRow = screen.getByTestId("mobile-exam-info-row");
    expect(infoRow.textContent).toMatch(/单选\s*·\s*第\s*2\s*题\s*\/\s*共\s*3\s*题/);
    expect(within(infoRow).getByTestId("mobile-exam-question-type").className).toContain(
      "shrink-0",
    );
  });

  it("SQL 题在题号前显示 SQL", () => {
    renderShell({
      currentIndex: 0,
      examData: {
        ...examData,
        questions: [
          {
            ...examData.questions[0],
            type: "short_answer",
            title: "请编写 SQL 查询语句",
            content: { text: "<p>请使用 SQL 查询所有分数大于 90 的学生。</p>" },
            options: null,
          },
        ],
      },
    });

    expect(screen.getByTestId("mobile-exam-info-row").textContent).toMatch(/SQL\s*·\s*第\s*1\s*题/);
  });

  it("底栏中间显示题号并可点击打开题目导航", async () => {
    renderShell({ currentIndex: 1 });

    const chip = screen.getByRole("button", { name: "题目导航" });
    expect(chip.textContent).toContain("2/3");

    fireEvent.click(chip);

    expect(await screen.findByRole("heading", { name: "题目导航" })).toBeInTheDocument();
  });

  it("顶栏交卷触发带数据的二次确认", async () => {
    renderShell({ currentIndex: 1 });

    fireEvent.click(screen.getByRole("button", { name: "交卷" }));

    expect(await screen.findByRole("heading", { name: "确认交卷" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续答题" })).toBeInTheDocument();
  });
});
