import { describe, expect, it } from "vitest";

import type { IQuestion } from "@/types";

import {
  buildEvenScoreAllocation,
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
} from "./paper-view-utils";

const mockQuestions: IQuestion[] = [
  {
    id: "q1",
    type: "choice",
    title: "题目一",
    content: { text: "1 + 1 = ?" },
    options: { A: "1", B: "2" },
    answer: { correct: "B" },
    analysis: null,
    difficulty: 2,
    score: 5,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "u1",
    created_by_name: "Teacher",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
  },
  {
    id: "q2",
    type: "choice",
    title: "题目二",
    content: { text: "2 + 2 = ?" },
    options: { A: "3", B: "4" },
    answer: { correct: "B" },
    analysis: null,
    difficulty: 2,
    score: 5,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "u1",
    created_by_name: "Teacher",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
  },
  {
    id: "q3",
    type: "code",
    title: "题目三",
    content: { text: "写一个函数" },
    options: null,
    answer: { code: "print('hi')" },
    analysis: null,
    difficulty: 3,
    score: 20,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "u1",
    created_by_name: "Teacher",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
  },
];

describe("paper view utils", () => {
  it("distributes type total evenly and leaves remainder on the last question", () => {
    expect(buildEvenScoreAllocation(10, 3)).toEqual([3.33, 3.33, 3.34]);
  });

  it("builds question type summaries from preview items", () => {
    const previewItems = buildPaperPreviewItems(
      [
        { question_id: "q2", order: 2, score_override: 4 },
        { question_id: "q1", order: 1, score_override: 6 },
        { question_id: "q3", order: 3, score_override: 20 },
      ],
      mockQuestions,
    );

    const summaries = buildQuestionTypeSummaries(previewItems);

    expect(previewItems.map((item) => item.question.id)).toEqual(["q1", "q2", "q3"]);
    expect(summaries).toEqual([
      {
        type: "choice",
        count: 2,
        totalScore: 10,
        questionIds: ["q1", "q2"],
      },
      {
        type: "code",
        count: 1,
        totalScore: 20,
        questionIds: ["q3"],
      },
    ]);
  });
});
