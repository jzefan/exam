import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChoiceQuestion } from "./choice-question";
import { TrueFalseQuestion } from "./true-false-question";

describe("student question selection states", () => {
  it("uses shadcn semantic selected colors for choice options", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ChoiceQuestion
        question={{
          question_id: "q-1",
          order: 0,
          score: 5,
          type: "choice",
          title: "单选题",
          content: { text: "<p>请选择正确答案</p>" },
          options: { A: "选项 A", B: "选项 B" },
        }}
        answer={{ selected: ["B"] }}
        onChange={onChange}
      />,
    );

    const selectedOption = screen.getByRole("button", { name: /B\s+选项 B/i });
    expect(selectedOption).toHaveAttribute("aria-pressed", "true");
    expect(selectedOption.className).toContain("bg-secondary");
    expect(selectedOption.className).toContain("text-secondary-foreground");
    expect(selectedOption.className).toContain("border-primary/50");
    expect(screen.getByText("B").className).toContain("text-primary-foreground");

    await user.click(screen.getByRole("button", { name: /A\s+选项 A/i }));
    expect(onChange).toHaveBeenCalledWith({ selected: ["A"] });
  });

  it("uses shadcn semantic selected colors for true false options", () => {
    render(
      <TrueFalseQuestion
        question={{
          question_id: "q-2",
          order: 0,
          score: 2,
          type: "true_false",
          title: "判断题",
          content: { text: "<p>这是判断题</p>" },
          options: null,
        }}
        answer={{ value: false }}
        onChange={vi.fn()}
      />,
    );

    const selectedOption = screen.getByRole("button", { name: /B\s+错误/i });
    expect(selectedOption).toHaveAttribute("aria-pressed", "true");
    expect(selectedOption.className).toContain("bg-secondary");
    expect(selectedOption.className).toContain("text-secondary-foreground");
    expect(screen.getByText("B").className).toContain("bg-primary");
    expect(screen.getByText("B").className).toContain("text-primary-foreground");
  });
});
