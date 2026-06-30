import type { ExamQuestionFormItem } from "@/pages/exams/components/exam-form-utils";
import {
  buildEvenScoreAllocation,
  type QuestionTypeSummary,
} from "@/pages/exams/components/paper-view-utils";
import type { IPaperDetail } from "@/types";

export function buildPaperScoreItems(
  paper: Pick<IPaperDetail, "questions">,
): ExamQuestionFormItem[] {
  return paper.questions
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({
      question_id: item.question_id,
      order: item.order ?? index,
      score_override: item.score_override ?? item.question?.score ?? 0,
      source_exam_id: null,
      source_question_id: null,
    }));
}

export function arePaperScoreItemsEqual(
  left: ExamQuestionFormItem[],
  right: ExamQuestionFormItem[],
) {
  const comparable = (items: ExamQuestionFormItem[]) =>
    items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        question_id: item.question_id,
        order: item.order,
        score_override: item.score_override,
      }));

  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function applyPaperTypeScoreAllocation(
  items: ExamQuestionFormItem[],
  summary: QuestionTypeSummary,
  totalScore: number,
): ExamQuestionFormItem[] {
  const nextScores = buildEvenScoreAllocation(totalScore, summary.count);
  let matched = 0;
  return items.map((item) => {
    if (!summary.questionIds.includes(item.question_id)) {
      return item;
    }
    const scoreOverride = nextScores[matched] ?? item.score_override;
    matched += 1;
    return {
      ...item,
      score_override: scoreOverride,
    };
  });
}

export function totalPaperScore(items: ExamQuestionFormItem[]) {
  return Number(
    items
      .reduce((sum, item) => sum + (Number(item.score_override) || 0), 0)
      .toFixed(2),
  );
}

export function buildPaperScoreUpdatePayload(items: ExamQuestionFormItem[]) {
  return {
    question_items: items
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((item, index) => ({
        question_id: item.question_id,
        order: index,
        score_override: Number.isFinite(Number(item.score_override))
          ? Number(item.score_override)
          : 0,
      })),
  };
}
