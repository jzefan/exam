import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { LatexText } from "./latex-text";

describe("LatexText", () => {
  it("does not warn when unicode text appears inside math mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<LatexText>{"$学生$"}</LatexText>);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
