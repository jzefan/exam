import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionNav } from "./question-nav";

const questions = [
  {
    question_id: "q-1",
    order: 0,
    score: 2,
    type: "essay",
    title: "题目 1",
    content: {},
    options: null,
  },
  {
    question_id: "q-2",
    order: 1,
    score: 2,
    type: "choice",
    title: "题目 2",
    content: {},
    options: { A: "A", B: "B" },
  },
  {
    question_id: "q-3",
    order: 2,
    score: 2,
    type: "choice",
    title: "题目 3",
    content: {},
    options: { A: "A", B: "B" },
  },
] as const;

describe("QuestionNav", () => {
  it("uses semantic colors for current and answered states", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    render(
      <QuestionNav
        questions={[...questions]}
        answers={{ "q-1": { html: "已答" }, "q-2": { selected: ["A"] } }}
        currentIndex={1}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );

    const currentButton = screen.getByRole("button", { name: "2" });
    const answeredButton = screen.getByRole("button", { name: "1" });

    expect(currentButton).toHaveAttribute("aria-current", "step");
    expect(currentButton.className).toContain("bg-primary");
    expect(currentButton.className).toContain("text-primary-foreground");
    expect(answeredButton.className).toContain("bg-secondary");
    expect(answeredButton.className).toContain("text-foreground");
    expect(answeredButton.className).toContain("ring-inset");

    await user.click(screen.getByRole("button", { name: "3" }));
    expect(onNavigate).toHaveBeenCalledWith(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});
