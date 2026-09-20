import { describe, expect, it } from "vitest";

import type { IQuestion } from "@/types";

import {
  canMarkChoiceAnswerInline,
  normalizeCorrectOptionKeys,
} from "./question-preview-utils";

function choiceQuestion(
  correct: unknown,
  options: Record<string, string> | null = {
    A: "甲",
    B: "乙",
    C: "丙",
    D: "丁",
  },
): IQuestion {
  return {
    id: "q-1",
    type: "choice",
    title: "标题",
    content: { text: "题干" },
    options,
    answer: { correct },
    analysis: null,
    difficulty: 3,
    score: 5,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "",
    created_by_name: "",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  } as IQuestion;
}

describe("normalizeCorrectOptionKeys", () => {
  const keys = new Set(["A", "B", "C", "D"]);

  it("keeps array answers untouched", () => {
    expect([...normalizeCorrectOptionKeys(["A", "C"], keys)].sort()).toEqual([
      "A",
      "C",
    ]);
  });

  it("splits merged strings and separator-joined answers", () => {
    expect([...normalizeCorrectOptionKeys("AC", keys)].sort()).toEqual(["A", "C"]);
    expect([...normalizeCorrectOptionKeys("A、C", keys)].sort()).toEqual(["A", "C"]);
  });

  it("does not split text that is not made of option keys", () => {
    const normalized = normalizeCorrectOptionKeys("以上都对", keys);
    expect(normalized.has("以上都对")).toBe(true);
    expect([...normalized].some((key) => keys.has(key))).toBe(false);
  });
});

describe("canMarkChoiceAnswerInline", () => {
  it("accepts single and merged choice answers", () => {
    expect(canMarkChoiceAnswerInline(choiceQuestion("A"))).toBe(true);
    expect(canMarkChoiceAnswerInline(choiceQuestion(["A", "C"]))).toBe(true);
    expect(canMarkChoiceAnswerInline(choiceQuestion("AC"))).toBe(true);
  });

  it("rejects answers that match no option key, so the answer block is kept", () => {
    expect(canMarkChoiceAnswerInline(choiceQuestion("以上都对"))).toBe(false);
    expect(
      canMarkChoiceAnswerInline(choiceQuestion("以上都对", { 甲: "甲", 乙: "乙" })),
    ).toBe(false);
  });

  it("rejects non-choice questions and questions without options", () => {
    expect(
      canMarkChoiceAnswerInline({ ...choiceQuestion("A"), type: "true_false" }),
    ).toBe(false);
    expect(canMarkChoiceAnswerInline(choiceQuestion("A", null))).toBe(false);
    expect(canMarkChoiceAnswerInline(choiceQuestion("A", {}))).toBe(false);
  });

  it("rejects empty answers", () => {
    expect(canMarkChoiceAnswerInline(choiceQuestion(""))).toBe(false);
    expect(canMarkChoiceAnswerInline(choiceQuestion(null))).toBe(false);
  });
});
