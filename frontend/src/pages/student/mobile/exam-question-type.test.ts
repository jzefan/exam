import { describe, expect, it } from "vitest";

import { getExamQuestionTypeLabel, SQL_QUESTION_TYPE_LABEL } from "./exam-question-type";
import type { IExamQuestionForStudent, QuestionType } from "@/types";

function question(
  overrides: Partial<IExamQuestionForStudent> & Pick<IExamQuestionForStudent, "type">,
): IExamQuestionForStudent {
  return {
    question_id: "q-1",
    order: 1,
    score: 2,
    title: "题干",
    content: { text: "<p>题干</p>" },
    options: null,
    ...overrides,
  };
}

describe("getExamQuestionTypeLabel", () => {
  it("短标签：单选 / 多选（库里都是 choice）", () => {
    expect(getExamQuestionTypeLabel(question({ type: "choice" }))).toBe("单选");
    expect(
      getExamQuestionTypeLabel(question({ type: "choice", content: { multi: true } })),
    ).toBe("多选");
  });

  it.each([
    ["true_false", "判断"],
    ["fill_in", "填空"],
    ["essay", "论述"],
    ["code", "编程"],
  ] as const)("把 %s 显示为 %s", (type, label) => {
    expect(getExamQuestionTypeLabel(question({ type }))).toBe(label);
  });

  it("普通简答题显示为简答", () => {
    expect(
      getExamQuestionTypeLabel(
        question({
          type: "short_answer",
          title: "请解释快速排序的分治思想",
          content: { text: "<p>请解释快速排序的分治思想。</p>" },
        }),
      ),
    ).toBe("简答");
  });

  it("题干带 SQL 线索的简答题显示为 SQL（库里 SQL 题就存成 short_answer）", () => {
    expect(
      getExamQuestionTypeLabel(
        question({
          type: "short_answer",
          title: "请编写 SQL 查询语句",
          content: { text: "<p>请使用 SQL 查询所有分数大于 90 的学生。</p>" },
        }),
      ),
    ).toBe(SQL_QUESTION_TYPE_LABEL);
  });

  it("代码题里的 SQL 也显示为 SQL", () => {
    expect(
      getExamQuestionTypeLabel(
        question({
          type: "code",
          title: "写一条查询语句统计各班级平均分",
          content: { text: "<p>使用 SQL 完成统计。</p>", language: "sql" },
        }),
      ),
    ).toBe(SQL_QUESTION_TYPE_LABEL);
  });

  it("全部题型都是 2 字（SQL 除外，它是缩写）", () => {
    const labels = [
      getExamQuestionTypeLabel(question({ type: "choice" })),
      getExamQuestionTypeLabel(question({ type: "choice", content: { multi: true } })),
      getExamQuestionTypeLabel(question({ type: "true_false" })),
      getExamQuestionTypeLabel(question({ type: "fill_in" })),
      getExamQuestionTypeLabel(question({ type: "short_answer" })),
      getExamQuestionTypeLabel(question({ type: "essay" })),
      getExamQuestionTypeLabel(question({ type: "code" })),
    ];

    expect(labels).toEqual(["单选", "多选", "判断", "填空", "简答", "论述", "编程"]);
    labels.forEach((label) => expect(label).toHaveLength(2));
    expect(SQL_QUESTION_TYPE_LABEL).toBe("SQL");
  });

  it("题型不认识时返回空串，不猜一个默认值", () => {
    expect(
      getExamQuestionTypeLabel(question({ type: "unknown_kind" as QuestionType })),
    ).toBe("");
  });

  it("原始题型字符串写明多选时不依赖 content.multi", () => {
    // 导入数据常把题型写成 multi_choice / 多选题，且不带 content.multi 字段
    expect(getExamQuestionTypeLabel(question({ type: "multi_choice" as QuestionType }))).toBe(
      "多选",
    );
    expect(getExamQuestionTypeLabel(question({ type: "多选题" as QuestionType }))).toBe("多选");
  });
});
