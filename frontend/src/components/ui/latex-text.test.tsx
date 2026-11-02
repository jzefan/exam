import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { LatexText, decorateQuestionHtml, renderLatexInHtml } from "./latex-text";

describe("LatexText", () => {
  it("does not warn when unicode text appears inside math mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<LatexText>{"$学生$"}</LatexText>);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("decorateQuestionHtml · 题目表格统一标记", () => {
  it("给没有 class 的 table 补上 question-table", () => {
    const html = "<p>题干</p><table><tr><td>1</td></tr></table>";
    expect(decorateQuestionHtml(html)).toContain('<table class="question-table">');
  });

  it("保留已有 class 并追加 question-table", () => {
    const html = '<table class="data" border="1"><tr><td>1</td></tr></table>';
    const decorated = decorateQuestionHtml(html);
    expect(decorated).toContain('class="data question-table"');
    expect(decorated).toContain('border="1"');
  });

  it("没有表格时原样返回（不改动普通 HTML）", () => {
    const html = "<p>只有文字</p>";
    expect(decorateQuestionHtml(html)).toBe(html);
  });

  it("renderLatexInHtml 输出里表格仍然存在且带标记", () => {
    const html = "<p>$x^2$</p><table><tr><th>目的地</th></tr><tr><td>N1</td></tr></table>";
    const rendered = renderLatexInHtml(html);
    expect(rendered).toContain("question-table");
    expect(rendered).toContain("N1");
  });
});
