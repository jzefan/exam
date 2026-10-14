import { describe, expect, it } from "vitest";

import type { QuestionImportDraft } from "./import-types";
import {
  allImportableDraftsHaveKnowledge,
  buildAnswerPayload,
  buildImportableQuestions,
  draftNeedsAnalysis,
  draftNeedsAnswer,
  draftNeedsKnowledge,
  getChoiceAnswerLetters,
  getDraftTypeFilter,
  getDraftTypeLabel,
  isMultiChoiceDraft,
  parseJsonKnowledgePointNames,
  parseJsonQuestions,
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

  it("JSON 题库原文标注了知识点的题目不算缺知识点", () => {
    // JSON 题库带的 knowledge_point_names 入库时会按名称匹配，不必再调模型。
    const recognizedOnly = makeDraft({
      draft_id: "recognized-only",
      segment_source: "client-json",
      suggested_knowledge_points: [],
      recognized_knowledge_points: ["地址解析协议 ARP"],
    });
    expect(draftNeedsKnowledge(recognizedOnly)).toBe(false);
    expect(
      selectEnhanceTargets([recognizedOnly, missingKnowledge], "knowledge", "missing")
        .map((d) => d.draft_id),
    ).toEqual(["missing-knowledge"]);

    // 文档识别出的名称只是线索，仍然算缺失。
    const recognizedHint = makeDraft({
      draft_id: "recognized-hint",
      segment_source: "ai_full",
      suggested_knowledge_points: [],
      recognized_knowledge_points: ["人工智能信息技术基础"],
    });
    expect(draftNeedsKnowledge(recognizedHint)).toBe(true);
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

describe("JSON 导入的 difficulty / analysis / knowledge_point_names", () => {
  const json = JSON.stringify({
    questions: [
      {
        type: "choice",
        title: "ARPANET 采用的核心交换技术是（ ）。",
        content: { text: "ARPANET 采用的核心交换技术是（ ）。", multi: false },
        options: { A: "电路交换", B: "分组交换" },
        answer: { correct: "B" },
        analysis: "分组交换是 ARPANET 的核心技术。",
        difficulty: 2,
        score: 1,
        knowledge_point_names: ["互联网的核心部分", "1.3.2 协议与划分层次", "互联网的核心部分"],
      },
    ],
  });

  it("把 difficulty、analysis、knowledge_point_names 带进草稿", () => {
    const { drafts } = parseJsonQuestions(json);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].difficulty).toBe(2);
    expect(drafts[0].analysis).toBe("分组交换是 ARPANET 的核心技术。");
    expect(drafts[0].recognized_knowledge_points).toEqual([
      "互联网的核心部分",
      "1.3.2 协议与划分层次",
    ]);
  });

  it("入库载荷带上标注的知识点名称，便于后端按名称匹配", () => {
    const { drafts } = parseJsonQuestions(json);
    const [question] = buildImportableQuestions(
      drafts.map((draft) => ({ ...draft, review_status: "approved" as const })),
      null,
    );
    expect(question.recognized_knowledge_points).toEqual([
      "互联网的核心部分",
      "1.3.2 协议与划分层次",
    ]);
    expect(question.difficulty).toBe(2);
    expect(question.analysis).toBe("分组交换是 ARPANET 的核心技术。");
  });

  it("字符串形式的知识点名称按中文标点拆分并去重", () => {
    expect(parseJsonKnowledgePointNames("第一章 概述、协议；协议")).toEqual([
      "第一章 概述",
      "协议",
    ]);
    expect(parseJsonKnowledgePointNames(["甲", "乙", "丙", "丁"])).toEqual([
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
    expect(parseJsonKnowledgePointNames(undefined)).toEqual([]);
    expect(parseJsonKnowledgePointNames([{ name: "对象" }, 3])).toEqual(["3"]);
  });
});

describe("allImportableDraftsHaveKnowledge · 是否跳过后台知识点匹配", () => {
  const withKp = makeDraft({
    draft_id: "with-kp",
    review_status: "approved",
    suggested_knowledge_points: [{ id: "kp-1", name: "知识点" }],
  });
  const withoutKp = makeDraft({
    draft_id: "without-kp",
    review_status: "approved",
    suggested_knowledge_points: [],
  });

  it("待导入题目都已关联知识点时返回 true", () => {
    expect(allImportableDraftsHaveKnowledge([withKp])).toBe(true);
  });

  it("有一道没关联知识点就返回 false，仍要排后台匹配", () => {
    expect(allImportableDraftsHaveKnowledge([withKp, withoutKp])).toBe(false);
  });

  it("忽略不参与导入的草稿（跳过 / 有阻塞问题）", () => {
    const skipped = makeDraft({
      draft_id: "skipped",
      review_status: "skipped",
      suggested_knowledge_points: [],
    });
    const blocked = makeDraft({
      draft_id: "blocked",
      review_status: "approved",
      issues: ["选择题选项不完整"],
      suggested_knowledge_points: [],
    });
    expect(allImportableDraftsHaveKnowledge([withKp, skipped, blocked])).toBe(true);
  });

  it("没有可导入题目时返回 false", () => {
    expect(allImportableDraftsHaveKnowledge([])).toBe(false);
  });
});
