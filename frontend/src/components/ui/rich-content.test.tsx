import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichContent } from "./rich-content";

describe("RichContent", () => {
  it("opens image preview in a constrained dialog instead of expanding inline", () => {
    render(<RichContent html={'<p>题干</p><img src="/example.png" alt="示例图" />'} />);

    fireEvent.click(screen.getByRole("button", { name: "预览图片：示例图" }));

    const preview = screen.getByRole("dialog", { name: "图片预览" });
    const image = within(preview).getByAltText("示例图");

    expect(preview).toHaveClass("fixed", "inset-0");
    expect(image).toHaveClass("max-h-[90vh]", "max-w-[90vw]", "object-contain");
  });
});
