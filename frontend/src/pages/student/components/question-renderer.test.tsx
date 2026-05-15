import { useState } from "react";
import { render, screen } from "@/test/test-utils";
import { describe, expect, it, vi } from "vitest";
import { QuestionRenderer } from "./question-renderer";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => (
    <div data-testid="monaco-editor">{value ?? ""}</div>
  ),
}));

vi.mock("./short-answer-question", () => ({
  ShortAnswerQuestion: ({ answer }: { answer: Record<string, unknown> }) => {
    const [value] = useState(() => (answer?.html as string) ?? "");
    return <div data-testid="short-answer-value">{value}</div>;
  },
}));

describe("QuestionRenderer", () => {
  it("renders code questions with the code question component", () => {
    render(
      <QuestionRenderer
        question={{
          question_id: "code-1",
          order: 0,
          score: 20,
          type: "code",
          title: "实现二分查找",
          content: {
            description: "<p>请实现一个二分查找函数</p>",
            starter_code: {
              python: "def solve(nums, target):\n    pass\n",
            },
            sample_tests: [{ input: "nums=[1,2,3], target=2", expected_output: "1" }],
          },
          options: null,
        }}
        answer={{}}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("题目说明")).toBeInTheDocument();
    expect(screen.getByText("运行代码")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("resets internal question component state when switching to a question without saved answer", () => {
    const { rerender } = render(
      <QuestionRenderer
        question={{
          question_id: "short-1",
          order: 0,
          score: 10,
          type: "short_answer",
          title: "第一题",
          content: { text: "<p>第一题</p>" },
          options: null,
        }}
        answer={{ html: "<p>已填写答案</p>" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("short-answer-value")).toHaveTextContent("<p>已填写答案</p>");

    rerender(
      <QuestionRenderer
        question={{
          question_id: "short-2",
          order: 1,
          score: 10,
          type: "short_answer",
          title: "第二题",
          content: { text: "<p>第二题</p>" },
          options: null,
        }}
        answer={{}}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("short-answer-value")).toHaveTextContent("");
  });

  it("renders one input for each fill-in blank placeholder", () => {
    render(
      <QuestionRenderer
        question={{
          question_id: "fill-1",
          order: 0,
          score: 10,
          type: "fill_in",
          title: "Pandas 行选择",
          content: { text: "在Pandas中，用于选择DataFrame的某一行的方法是____（入参为索引）或____（入参为标签）。" },
          options: null,
        }}
        answer={{}}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText("填写第 1 空")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("填写第 2 空")).toBeInTheDocument();
  });
});
