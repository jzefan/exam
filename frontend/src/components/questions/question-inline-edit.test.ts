import { describe, expect, it } from "vitest";

import type { IQuestion } from "@/types";

import {
  answerFromInlineText,
  answerInlineText,
  canInlineEditAnswer,
  canInlineEditStem,
  stemHtmlFromText,
  stemInlineText,
} from "./question-inline-edit";

function question(partial: Partial<IQuestion>): IQuestion {
  return {
    id: "q1",
    title: "",
    type: "fill_in",
    content: {},
    answer: {},
    ...partial,
  } as unknown as IQuestion;
}

describe("canInlineEditStem", () => {
  it("允许纯段落", () => {
    expect(canInlineEditStem(question({ content: { html: "<p>主机向本地域名服务器查询。</p>" } }))).toBe(true);
  });

  it("拒绝含图片的题干", () => {
    expect(
      canInlineEditStem(question({ content: { html: '<p>如图<img src="/a.png"></p>' } })),
    ).toBe(false);
  });

  it("拒绝含表格/列表/公式的题干", () => {
    for (const html of ["<table><tr><td>a</td></tr></table>", "<ul><li>a</li></ul>", "<span style=\"x\">a</span>"]) {
      expect(canInlineEditStem(question({ content: { html } }))).toBe(false);
    }
  });
});

describe("stemInlineText / stemHtmlFromText", () => {
  it("把段落转成纯文本行", () => {
    expect(stemInlineText(question({ content: { html: "<p>第一段</p><p>第二段</p>" } }))).toBe(
      "第一段\n第二段",
    );
  });

  it("回写时转义并重新包裹段落", () => {
    expect(stemHtmlFromText("a < b\n\n第二段")).toBe("<p>a &lt; b</p><p>第二段</p>");
  });
});

describe("answer 往返", () => {
  it("填空题按行对应每个空", () => {
    const q = question({ type: "fill_in", answer: { correct: ["甲", "乙"] } });
    expect(answerInlineText(q)).toBe("甲\n乙");
    expect(answerFromInlineText(q, "甲\n乙\n丙").correct).toEqual(["甲", "乙", "丙"]);
  });

  it("选择题按字母解析", () => {
    const single = question({ type: "choice", answer: { correct: "A" } });
    expect(answerInlineText(single)).toBe("A");
    expect(answerFromInlineText(single, "B").correct).toBe("B");

    const multi = question({ type: "choice", answer: { correct: ["A", "C"] } });
    expect(answerInlineText(multi)).toBe("A、C");
    expect(answerFromInlineText(multi, "B、D").correct).toEqual(["B", "D"]);
  });

  it("判断题转成布尔值", () => {
    const q = question({ type: "true_false", answer: { correct: true } });
    expect(answerInlineText(q)).toBe("正确");
    expect(answerFromInlineText(q, "错误").correct).toBe(false);
  });

  it("简答题评分点按行往返，并丢掉富文本答案", () => {
    const q = question({
      type: "short_answer",
      answer: { points: ["要点一", "要点二"], html: "<p>旧答案</p>" },
    });
    expect(answerInlineText(q)).toBe("要点一\n要点二");
    const next = answerFromInlineText(q, "要点一\n要点二\n要点三");
    expect(next.points).toEqual(["要点一", "要点二", "要点三"]);
    expect(next.html).toBeUndefined();
  });
});

describe("canInlineEditAnswer", () => {
  it("含图片的答案不允许就地编辑", () => {
    expect(
      canInlineEditAnswer(question({ type: "short_answer", answer: { html: '<p><img src="/a.png"></p>' } })),
    ).toBe(false);
    expect(canInlineEditAnswer(question({ type: "fill_in", answer: { correct: ["甲"] } }))).toBe(true);
  });
});
