import { describe, expect, it } from "vitest";

import type { QuestionImportDraft } from "./import-types";
import {
  buildAnswerPayload,
  draftNeedsAnalysis,
  draftNeedsAnswer,
  draftNeedsKnowledge,
  getChoiceAnswerLetters,
  getDraftTypeFilter,
  getDraftTypeLabel,
  isMultiChoiceDraft,
  selectEnhanceTargets,
} from "./import-utils";

function makeDraft(
  overrides: Partial<QuestionImportDraft> & { draft_id: string },
): QuestionImportDraft {
  return {
    raw_text: "",
    title: "题干",
    type: "choice",
    content_text: "题干",
    options: { A: "甲", B: "乙" },
    answer_text: "A",
    analysis: "",
    difficulty: 3,
    segment_source: "ai_full",
    type_confidence: "high",
    boundary_confidence: "high",
    issues: [],
    review_status: "pending",
    review_required: true,
    suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
    ...overrides,
  };
}

describe("selectEnhanceTargets", () => {
  const complete = makeDraft({ draft_id: "complete" });
  const missingAnswer = makeDraft({ draft_id: "missing-answer", answer_text: "  " });
  const missingKnowledge = makeDraft({
    draft_id: "missing-knowledge",
    suggested_knowledge_points: [],
  });
  const missingBoth = makeDraft({
    draft_id: "missing-both",
    answer_text: null,
    suggested_knowledge_points: [],
  });
  const drafts = [complete, missingAnswer, missingKnowledge, missingBoth];

  it("只补齐缺失时按完善方式筛选", () => {
    expect(selectEnhanceTargets(drafts, "answers", "missing").map((d) => d.draft_id)).toEqual([
      "missing-answer",
      "missing-both",
    ]);
    expect(selectEnhanceTargets(drafts, "knowledge", "missing").map((d) => d.draft_id)).toEqual([
      "missing-knowledge",
      "missing-both",
    ]);
    expect(selectEnhanceTargets(drafts, "both", "missing").map((d) => d.draft_id)).toEqual([
      "missing-answer",
      "missing-knowledge",
      "missing-both",
    ]);
  });

  it("全部题目范围下不做筛选", () => {
    expect(selectEnhanceTargets(drafts, "answers", "all")).toHaveLength(4);
    expect(selectEnhanceTargets(drafts, "both", "all")).toHaveLength(4);
  });

  it("识别缺失答案与缺失知识点", () => {
    expect(draftNeedsAnswer(complete)).toBe(false);
    expect(draftNeedsAnswer(missingAnswer)).toBe(true);
    expect(draftNeedsKnowledge(complete)).toBe(false);
    expect(draftNeedsKnowledge(missingKnowledge)).toBe(true);
  });
});

describe("selectEnhanceTargets · 完善题目解析", () => {
  // 两道题的答案与知识点都齐全，只区分解析有无。
  const withAnalysis = makeDraft({ draft_id: "with-analysis", analysis: "已有解析" });
  const withoutAnalysis = makeDraft({ draft_id: "without-analysis", analysis: "  " });
  const drafts = [withAnalysis, withoutAnalysis];

  it("仅补齐缺失时只挑出缺解析的题目", () => {
    expect(
      selectEnhanceTargets(drafts, "analysis", "missing").map((d) => d.draft_id),
    ).toEqual(["without-analysis"]);
  });

  it("全部题目范围下不筛选", () => {
    expect(selectEnhanceTargets(drafts, "analysis", "all")).toHaveLength(2);
  });

  it("识别缺失解析", () => {
    expect(draftNeedsAnalysis(withAnalysis)).toBe(false);
    expect(draftNeedsAnalysis(withoutAnalysis)).toBe(true);
  });
});

describe("选择题单选/多选拆分", () => {
  it("从答案文本解析选项字母", () => {
    expect(getChoiceAnswerLetters("A")).toEqual(["A"]);
    expect(getChoiceAnswerLetters("bd")).toEqual(["B", "D"]);
    expect(getChoiceAnswerLetters("A、C")).toEqual(["A", "C"]);
    expect(getChoiceAnswerLetters("A C")).toEqual(["A", "C"]);
    expect(getChoiceAnswerLetters("")).toEqual([]);
  });

  it("按答案字母数量区分单选与多选", () => {
    const single = makeDraft({ draft_id: "single", answer_text: "A" });
    const multi = makeDraft({ draft_id: "multi", answer_text: "BD" });
    const noAnswer = makeDraft({ draft_id: "no-answer", answer_text: null });

    expect(isMultiChoiceDraft(single)).toBe(false);
    expect(isMultiChoiceDraft(multi)).toBe(true);

    expect(getDraftTypeFilter(single)).toBe("single_choice");
    expect(getDraftTypeFilter(multi)).toBe("multi_choice");
    expect(getDraftTypeFilter(noAnswer)).toBe("single_choice");
    expect(getDraftTypeFilter(makeDraft({ draft_id: "tf", type: "true_false" }))).toBe("true_false");

    expect(getDraftTypeLabel(single)).toBe("单选题");
    expect(getDraftTypeLabel(multi)).toBe("多选题");
    expect(getDraftTypeLabel(makeDraft({ draft_id: "tf", type: "true_false" }))).toBe("判断题");
  });

  it("多选答案提交为数组并标记 multi", () => {
    expect(buildAnswerPayload("choice", "A")).toEqual({ correct: "A" });
    expect(buildAnswerPayload("choice", "BD")).toEqual({ correct: ["B", "D"] });
    expect(buildAnswerPayload("choice", "A、C")).toEqual({ correct: ["A", "C"] });
  });
});
