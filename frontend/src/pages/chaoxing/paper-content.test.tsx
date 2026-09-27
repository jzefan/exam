import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperContent, formulaHtml } from "./paper-content";
import { connectionFetch } from "./api";

vi.mock("./api", () => ({ connectionFetch: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:http://localhost/test-media");
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(connectionFetch).mockResolvedValue({ blob: async () => new Blob(["test"], { type: "image/png" }) } as Response);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("学习通富文本答卷", () => {
  it("支持四种公式定界符，题干中的 HTML 只作为文字显示", () => {
    const { container } = render(<PaperContent text={String.raw`<script>bad()</script> $x^2$ $$y^2$$ \(z^2\) \[a^2\]`} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(4);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>bad()</script>");
    expect(formulaHtml(String.raw`$\href{javascript:alert(1)}{click}$`)).not.toContain('href="javascript:');
  });

  it("获取私有图片、放大预览，并在离开答卷后释放 Blob", async () => {
    const { unmount } = render(<PaperContent text="" blocks={[{ kind: "image", name: "题干图片", asset_id: "asset-1" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "预览图片：题干图片" }));
    expect(screen.getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();
    expect(connectionFetch).toHaveBeenCalledWith("/media/asset-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole("link", { name: "题干图片 · 下载" })).toHaveAttribute("download", "题干图片");
    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览" }));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-media");
  });

  it("附件代码原样显示缩进和符号，不作为 HTML 或公式执行", async () => {
    const code = 'if x < 2:\n    print("<img src=x onerror=bad()>")\n# $value$';
    const { container } = render(<PaperContent text="" blocks={[{ kind: "file", name: "lesson2.py", asset_id: "code", preview: code }]} />);
    await screen.findByRole("link", { name: "lesson2.py · 下载" });
    expect(container.querySelector("pre")?.textContent).toBe(code);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("读取失败的图片保留占位，不显示为空答案", async () => {
    vi.mocked(connectionFetch).mockRejectedValueOnce(new Error("expired"));
    render(<PaperContent text="" blocks={[{ kind: "image", name: "作答截图", asset_id: "missing" }]} />);
    await waitFor(() => expect(screen.getByText(/作答截图 · 未能读取/)).toBeInTheDocument());
    expect(screen.queryByText("未读取到内容")).not.toBeInTheDocument();
  });
});
