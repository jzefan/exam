import { describe, expect, it } from "vitest";

import type { ExamQuestionFormItem } from "@/pages/exams/components/exam-form-utils";
import type { QuestionTypeSummary } from "@/pages/exams/components/paper-view-utils";
import type { IPaperDetail } from "@/types";

import {
  applyPaperTypeScoreAllocation,
  buildPaperScoreItems,
  buildPaperScoreUpdatePayload,
  totalPaperScore,
} from "./paper-detail-score";

function paperWithScores(): IPaperDetail {
  return {
    questions: [
      {
        question_id: "q2",
        order: 1,
        score_override: 8,
        question: { id: "q2", score: 4 },
      },
      {
        question_id: "q1",
        order: 0,
        score_override: null,
        question: { id: "q1", score: 5 },
      },
    ],
  } as IPaperDetail;
}

describe("paper detail score helpers", () => {
  it("builds score drafts from paper overrides and question defaults", () => {
    const items = buildPaperScoreItems(paperWithScores());

    expect(items).toMatchObject([
      { question_id: "q1", order: 0, score_override: 5 },
      { question_id: "q2", order: 1, score_override: 8 },
    ]);
    expect(totalPaperScore(items)).toBe(13);
  });

  it("evenly allocates a question type total to matching questions only", () => {
    const items: ExamQuestionFormItem[] = [
      { question_id: "q1", order: 0, score_override: 1 },
      { question_id: "q2", order: 1, score_override: 1 },
      { question_id: "q3", order: 2, score_override: 10 },
    ];
    const summary: QuestionTypeSummary = {
      type: "choice",
      count: 2,
      totalScore: 2,
      questionIds: ["q1", "q2"],
    };

    expect(applyPaperTypeScoreAllocation(items, summary, 15)).toMatchObject([
      { question_id: "q1", score_override: 7.5 },
      { question_id: "q2", score_override: 7.5 },
      { question_id: "q3", score_override: 10 },
    ]);
  });

  it("builds an ordered PATCH payload for paper score updates", () => {
    const items: ExamQuestionFormItem[] = [
      { question_id: "q2", order: 1, score_override: 8 },
      { question_id: "q1", order: 0, score_override: 5 },
    ];

    expect(buildPaperScoreUpdatePayload(items)).toEqual({
      question_items: [
        { question_id: "q1", order: 0, score_override: 5 },
        { question_id: "q2", order: 1, score_override: 8 },
      ],
    });
  });
});
