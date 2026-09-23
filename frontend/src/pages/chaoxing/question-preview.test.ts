import { describe, expect, it } from "vitest";
import {
  getQuestionAnswerText,
  getQuestionDisplayType,
  getQuestionDisplayTypeLabel,
} from "@/components/questions/question-preview-utils";
import { buildQuestionPreview } from "./question-preview";

const base = {
  id: "q1",
  question_type: "简答题",
  content: "说明循环的作用",
  reference_answer: "重复执行语句",
  max_score: 5,
};

describe("学习通题目 → 题库统一展示", () => {
  it("按题库口径给出题型，多选语义不丢", () => {
    expect(getQuestionDisplayType(buildQuestionPreview({ ...base, question_type: "名词解释题" }))).toBe("short_answer");
    expect(getQuestionDisplayTypeLabel(buildQuestionPreview({ ...base, question_type: "多选题" }))).toBe("多选题");
    expect(getQuestionDisplayTypeLabel(buildQuestionPreview({ ...base, question_type: "单选题" }))).toBe("单选题");
    expect(getQuestionDisplayType(buildQuestionPreview({ ...base, question_type: "编程题" }))).toBe("code");
  });

  it("未识别的题型照原样保留，不猜成某个题库题型", () => {
    const unknown = buildQuestionPreview({ ...base, question_type: "其他" });
    expect(getQuestionDisplayType(unknown)).toBeNull();
    expect(getQuestionDisplayTypeLabel(unknown)).toBe("题目");
    expect(unknown.type).toBe("其他");
  });

  it("参考答案进统一答案区，满分取源站满分", () => {
    const preview = buildQuestionPreview(base);
    expect(getQuestionAnswerText(preview)).toBe("重复执行语句");
    expect(preview.score).toBe(5);
  });
});
