import { describe, expect, it } from "vitest";

import type { IQuestion } from "@/types";

import {
  buildEvenScoreAllocation,
  buildQuestionJumpGroups,
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
  {
    id: "q4",
    type: "true_false",
    title: "题目四",
    content: { text: "这是一道判断题" },
    options: null,
    answer: { correct: true },
    analysis: null,
    difficulty: 1,
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
    id: "q5",
    type: "fill_in",
    title: "题目五",
    content: { text: "这是一道填空题" },
    options: null,
    answer: { blanks: ["答案"] },
    analysis: null,
    difficulty: 2,
    score: 8,
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
        {
          question_id: "q2",
          order: 2,
          score_override: 4,
          source_exam_id: "source-exam",
          source_question_id: "q2",
        },
        { question_id: "q1", order: 1, score_override: 6 },
        { question_id: "q3", order: 3, score_override: 20 },
      ],
      mockQuestions,
    );

    const summaries = buildQuestionTypeSummaries(previewItems);

    expect(previewItems.map((item) => item.question.id)).toEqual(["q1", "q2", "q3"]);
    expect(previewItems.map((item) => item.isSourceReused)).toEqual([false, true, false]);
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

  it("orders preview questions by fixed question type sequence and keeps order inside each type", () => {
    const previewItems = buildPaperPreviewItems(
      [
        { question_id: "q3", order: 1, score_override: 20 },
        { question_id: "q5", order: 2, score_override: 8 },
        { question_id: "q1", order: 3, score_override: 6 },
        { question_id: "q4", order: 4, score_override: 5 },
        { question_id: "q2", order: 5, score_override: 4 },
      ],
      mockQuestions,
    );

    expect(previewItems.map((item) => item.question.id)).toEqual([
      "q1",
      "q2",
      "q4",
      "q5",
      "q3",
    ]);
  });

  it("builds compact jump groups by question type with display indexes", () => {
    const previewItems = buildPaperPreviewItems(
      [
        { question_id: "q3", order: 1, score_override: 20 },
        { question_id: "q5", order: 2, score_override: 8 },
        { question_id: "q1", order: 3, score_override: 6 },
        { question_id: "q4", order: 4, score_override: 5 },
        { question_id: "q2", order: 5, score_override: 4 },
      ],
      mockQuestions,
    );
    const summaries = buildQuestionTypeSummaries(previewItems);

    const groups = buildQuestionJumpGroups(previewItems, summaries);

    expect(groups.map((group) => group.summary.type)).toEqual([
      "choice",
      "true_false",
      "fill_in",
      "code",
    ]);
    expect(
      groups.map((group) =>
        group.items.map((item) => ({
          id: item.previewItem.question.id,
          displayIndex: item.displayIndex,
        })),
      ),
    ).toEqual([
      [
        { id: "q1", displayIndex: 1 },
        { id: "q2", displayIndex: 2 },
      ],
      [{ id: "q4", displayIndex: 3 }],
      [{ id: "q5", displayIndex: 4 }],
      [{ id: "q3", displayIndex: 5 }],
    ]);
  });
});
