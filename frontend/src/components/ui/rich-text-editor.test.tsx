import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "./rich-text-editor";

describe("RichTextEditor · 表格", () => {
  it("带 <table> 的题干不会被解析丢掉", async () => {
    const { container } = render(
      <RichTextEditor
        value={
          '<p>路由器 B 的路由表如下</p><table><tbody><tr><th>目的网络</th><th>距离</th></tr><tr><td>N1</td><td>7</td></tr></tbody></table>'
        }
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".tiptap table")).not.toBeNull();
    });
    const table = container.querySelector(".tiptap table");
    expect(table?.textContent).toContain("目的网络");
    expect(table?.textContent).toContain("N1");
  });

  it("从工具栏插入表格后，onChange 输出里带表格结构", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor value="<p>题干</p>" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".tiptap")).not.toBeNull();
    });

    await user.click(screen.getByTitle("表格"));
    await user.click(await screen.findByText("插入 3×3 表格"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("<table");
  });
});
