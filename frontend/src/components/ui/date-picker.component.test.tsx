import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";

function ControlledDatePicker() {
  const [value, setValue] = useState(new Date(2026, 5, 4, 9, 0, 0, 0));

  return (
    <DatePicker
      value={value}
      onChange={(next) => {
        if (next) setValue(next);
      }}
      includeTime
    />
  );
}

describe("DatePicker time input wheel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves once on the first wheel event and throttles burst events", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    render(<ControlledDatePicker />);
    fireEvent.click(screen.getByRole("button", { name: /2026-06-04 09:00/ }));

    const input = screen.getByLabelText("时间，可手动输入或滚动调整（每 5 分钟）");
    fireEvent.wheel(input, { deltaY: 1 });
    expect(screen.getByRole("button", { name: /2026-06-04 08:55/ })).toBeInTheDocument();

    now += 50;
    fireEvent.wheel(input, { deltaY: 1 });
    expect(screen.getByRole("button", { name: /2026-06-04 08:55/ })).toBeInTheDocument();

    now += 121;
    fireEvent.wheel(input, { deltaY: 1 });
    expect(screen.getByRole("button", { name: /2026-06-04 08:50/ })).toBeInTheDocument();
  });
});
