import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { QuestionPreviewCard } from "./question-preview-card";

const sampleQuestion: IQuestion = {
  id: "question-1",
  type: "choice",
  title: "默认标题",
  content: { text: "下面关于 TCP 三次握手的说法，正确的是？" },
  options: {
    A: "客户端发送 SYN",
    B: "服务端发送 ACK",
    C: "客户端发送 FIN",
    D: "服务端直接关闭连接",
  },
  answer: { correct: "A" },
  analysis: "握手的第一步由客户端发起 SYN。",
  difficulty: 3,
  score: 5,
  usage_count: 2,
  question_bank_id: "bank-1",
  question_bank_name: "网络基础",
  tags: [
    { id: "tag-1", name: "TCP", type: "knowledge", question_count: 1, created_at: "2026-04-01T00:00:00Z" },
  ],
  knowledge_points: [
    {
      id: "kp-1",
      name: "三次握手",
      parent_id: null,
      description: "连接建立",
      created_at: "2026-04-01T00:00:00Z",
      direction_id: null,
      tags: [],
      difficulty: null,
      question_count: 1,
    },
  ],
  created_by: "user-1",
  created_by_name: "Teacher",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("QuestionPreviewCard", () => {
  it("renders the full question preview content when expanded", () => {
    render(<QuestionPreviewCard question={sampleQuestion} index={8} defaultExpanded />);

    expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "A. 客户端发送 SYN")).toBeInTheDocument();
    expect(screen.getByText("参考答案")).toBeInTheDocument();
    expect(screen.getByText("解析")).toBeInTheDocument();
    expect(screen.getByText("TCP")).toBeInTheDocument();
    expect(screen.getAllByText("三次握手").length).toBeGreaterThan(0);
    expect(screen.getByText((_, node) => node?.textContent === "5分")).toBeInTheDocument();
  });

  it("shows the simple inline answer when collapsed", () => {
    render(<QuestionPreviewCard question={sampleQuestion} />);

    expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
    expect(screen.getByText("答案")).toBeInTheDocument();
  });

  it("shows the reference answer in expanded details even when collapsed answers are hidden", () => {
    render(
      <QuestionPreviewCard
        question={sampleQuestion}
        defaultExpanded
        hideAnswer
      />,
    );

    expect(screen.getByText("参考答案")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("supports compact mode while keeping the question stem visible", () => {
    render(<QuestionPreviewCard question={sampleQuestion} mode="compact" />);

    expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
    expect(screen.queryByText("解析")).not.toBeInTheDocument();
  });

  it("expands and collapses details on click when click expansion is enabled", async () => {
    const user = userEvent.setup();
    render(<QuestionPreviewCard question={sampleQuestion} expandOnClick hideAnswer />);

    const card = screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")
      .closest(".group");
    expect(card).not.toBeNull();
    expect(screen.getByTestId("question-preview-details")).toHaveClass(
      "grid-rows-[0fr]",
    );

    await user.click(card as HTMLElement);
    expect(screen.getByTestId("question-preview-details")).toHaveClass(
      "grid-rows-[1fr]",
    );

    await user.click(card as HTMLElement);
    expect(screen.getByTestId("question-preview-details")).toHaveClass(
      "grid-rows-[0fr]",
    );
  });

  it("renders shorthand badge for legacy true false type values", () => {
    const legacyTrueFalseQuestion = {
      ...sampleQuestion,
      id: "question-legacy-true-false",
      type: "判断题",
      title: "旧数据判断题",
      content: { text: "MySQL 默认端口是 3306。" },
      answer: { correct: false },
    } as unknown as IQuestion;

    render(<QuestionPreviewCard question={legacyTrueFalseQuestion} mode="compact" />);

    expect(screen.getByText("判断题")).toBeInTheDocument();
  });

  it("renders shorthand badge for legacy fill in type values", () => {
    const legacyFillInQuestion = {
      ...sampleQuestion,
      id: "question-legacy-fill-in",
      type: "填空题",
      title: "旧数据填空题",
      content: { text: "MySQL 默认使用 ____ 端口。" },
      answer: { correct: ["3306"] },
    } as unknown as IQuestion;

    render(<QuestionPreviewCard question={legacyFillInQuestion} mode="compact" />);

    expect(screen.getByText("填空题")).toBeInTheDocument();
  });

  it("renders knowledge recognition status badges when provided", () => {
    render(
      <QuestionPreviewCard
        question={sampleQuestion}
        mode="compact"
        knowledgeRecognitionStatus="running"
      />,
    );

    expect(screen.getByText("AI 识别中")).toBeInTheDocument();
  });

  it("expands on hover and collapses on click in hover mode", async () => {
    const user = userEvent.setup();
    render(
      <QuestionPreviewCard
        question={sampleQuestion}
        expandOnHover
        hoverDetailDelay={0}
      />,
    );

    const card = screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")
      .closest(".group");
    expect(card).not.toBeNull();
    expect(screen.getByTestId("question-preview-details")).toHaveClass(
      "grid-rows-[0fr]",
    );

    await user.hover(card as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("question-preview-details")).toHaveClass(
        "grid-rows-[1fr]",
      ),
    );

    await user.click(card as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("question-preview-details")).toHaveClass(
        "grid-rows-[0fr]",
      ),
    );

    await user.unhover(card as HTMLElement);
    await user.hover(card as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("question-preview-details")).toHaveClass(
        "grid-rows-[1fr]",
      ),
    );
  });

  it("marks correct options inline and drops the standalone answer box", () => {
    render(
      <QuestionPreviewCard
        question={{ ...sampleQuestion, answer: { correct: ["A", "C"] } }}
        markChoiceAnswer
        hideAnswer
      />,
    );

    const option = (text: string) =>
      screen.getByText((_, node) => node?.textContent === text);

    expect(option("A. 客户端发送 SYN").className).toContain("text-primary");
    expect(option("C. 客户端发送 FIN").className).toContain("text-primary");
    expect(option("B. 服务端发送 ACK").className).not.toContain("text-primary");
    expect(screen.queryByText("答案")).not.toBeInTheDocument();
  });

  it("splits merged choice answer strings so every correct option is marked", () => {
    render(
      <QuestionPreviewCard
        question={{ ...sampleQuestion, answer: { correct: "AC" } }}
        markChoiceAnswer
        hideAnswer
      />,
    );

    const option = (text: string) =>
      screen.getByText((_, node) => node?.textContent === text);

    expect(option("A. 客户端发送 SYN").className).toContain("text-primary");
    expect(option("C. 客户端发送 FIN").className).toContain("text-primary");
    expect(option("B. 服务端发送 ACK").className).not.toContain("text-primary");
  });
});
