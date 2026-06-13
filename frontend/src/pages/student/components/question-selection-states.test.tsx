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

  it("allows long mobile choice text to wrap inside the option card", () => {
    const longText = "对象可以直接调用类的方法，而不需要实例化对象；这段文字很长也必须留在卡片内部自动换行";

    render(
      <ChoiceQuestion
        question={{
          question_id: "q-long",
          order: 0,
          score: 5,
          type: "choice",
          title: "单选题",
          content: { text: "<p>请选择错误说法</p>" },
          options: { A: longText },
        }}
        answer={{ selected: [] }}
        onChange={vi.fn()}
      />,
    );

    const option = screen.getByRole("button", { name: new RegExp(longText) });
    const text = screen.getByText(longText);

    expect(option.className).toContain("min-w-0");
    expect(option.className).toContain("max-w-full");
    expect(text.className).toContain("min-w-0");
    expect(text.className).toContain("break-words");
  });

  it("stretches short choice options to full width for consistent sizing", () => {
    render(
      <ChoiceQuestion
        question={{
          question_id: "q-short",
          order: 0,
          score: 2,
          type: "choice",
          title: "单选题",
          content: { text: "<p>请选择</p>" },
          options: { A: "对", B: "错", C: "不确定" },
        }}
        answer={{ selected: [] }}
        onChange={vi.fn()}
      />,
    );

    for (const key of ["A", "B", "C"]) {
      const option = screen.getByRole("button", {
        name: new RegExp(`${key}\\s`),
      });
      expect(option.className).toContain("w-full");
    }
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
