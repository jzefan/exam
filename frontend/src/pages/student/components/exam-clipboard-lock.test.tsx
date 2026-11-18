import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

import { ExamClipboardLock } from "./exam-clipboard-lock";
import { FillInQuestion } from "./fill-in-question";

function AnswerField() {
  const [value, setValue] = useState("");
  return (
    <ExamClipboardLock>
      <input aria-label="答案" value={value} onChange={(event) => setValue(event.target.value)} />
    </ExamClipboardLock>
  );
}

function dispatchCancelable(target: HTMLElement, type: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("ExamClipboardLock", () => {
  it("blocks copy, paste, and clipboard shortcuts while typing still works", async () => {
    const user = userEvent.setup();
    render(<AnswerField />);
    const input = screen.getByLabelText("答案");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    input.dispatchEvent(paste);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    input.dispatchEvent(copy);
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    input.dispatchEvent(cut);
    expect(paste.defaultPrevented).toBe(true);
    expect(copy.defaultPrevented).toBe(true);
    expect(cut.defaultPrevented).toBe(true);
    expect(dispatchCancelable(input, "keydown", { key: "v", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatchCancelable(input, "keydown", { key: "c", metaKey: true }).defaultPrevented).toBe(true);
    expect(dispatchCancelable(input, "keydown", { key: "a" }).defaultPrevented).toBe(false);

    await user.type(input, "手打");
    expect(input).toHaveValue("手打");
  });

  it("keeps fill-in answers editable and rejects a pasted blank", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FillInQuestion
        question={{
          question_id: "fill-1",
          order: 0,
          score: 5,
          type: "fill_in",
          title: "填空",
          content: { text: "答案是____。" },
          options: null,
        }}
        answer={{}}
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("填写第 1 空");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    await user.type(input, "叶绿体");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText("不可复制、粘贴")).toBeInTheDocument();
  });
});
