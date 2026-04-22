import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

import { ShortAnswerQuestion } from "./short-answer-question";

vi.mock("@monaco-editor/react", () => ({
  default: ({ language, value }: { language?: string; value?: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value ?? ""}
    </div>
  ),
}));

vi.mock("@/components/ui/rich-text-editor", () => ({
  RichTextEditor: ({ value }: { value?: string }) => (
    <div data-testid="rich-text-editor">{value ?? ""}</div>
  ),
}));

describe("ShortAnswerQuestion", () => {
  it("uses the rich text editor for regular short-answer questions", () => {
    render(
      <ShortAnswerQuestion
        question={{
          question_id: "short-1",
          order: 0,
          score: 10,
          type: "short_answer",
          title: "请解释事务隔离级别",
          content: { text: "<p>请解释事务隔离级别。</p>" },
          options: null,
        }}
        answer={{ html: "<p>已作答</p>" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编写 SQL" })).not.toBeInTheDocument();
  });

  it("shows a lightweight sql assist only for database-related short answers", async () => {
    const user = userEvent.setup();

    render(
      <ShortAnswerQuestion
        question={{
          question_id: "short-1b",
          order: 0,
          score: 10,
          type: "short_answer",
          title: "请查询学生信息",
          content: { text: "<p>已知数据库中有一张 student 表，请写出查询逻辑。</p>" },
          options: null,
        }}
        answer={{ html: "<p>先筛选数据</p>" }}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "编写 SQL" }));

    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回普通作答" })).toBeInTheDocument();
  });

  it("does not auto-switch to SQL editor even when the question declares sql language", () => {
    render(
      <ShortAnswerQuestion
        question={{
          question_id: "short-sql-1",
          order: 0,
          score: 10,
          type: "short_answer",
          title: "编写 SQL",
          content: {
            text: "<p>请编写 SQL 查询语句。</p>",
            language: "sql",
            starter_code: "SELECT *\nFROM students;",
            sql_hints: ["先写 SELECT", "再补 WHERE 条件"],
          },
          options: null,
        }}
        answer={{}}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编写 SQL" })).toBeInTheDocument();
  });

  it("does not auto-switch to SQL editor when the prompt looks like a sql question", () => {
    render(
      <ShortAnswerQuestion
        question={{
          question_id: "short-sql-2",
          order: 1,
          score: 10,
          type: "short_answer",
          title: "请写出查询语句",
          content: { text: "<p>使用 SQL 查询所有成绩大于 90 分的学生。</p>" },
          options: null,
        }}
        answer={{ html: "<p>SELECT * FROM scores</p>" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编写 SQL" })).toBeInTheDocument();
  });
});
