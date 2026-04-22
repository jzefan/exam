import { normalizeQuestionType } from "@/components/questions/question-preview-utils";
import type { IQuestion, QuestionType } from "@/types";

import type { ExamQuestionFormItem } from "./exam-form-utils";

export const questionTypeLabels: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export type PaperPreviewItem = {
  question: IQuestion;
  order: number;
  scoreOverride: number | null;
};

export type QuestionTypeSummary = {
  type: QuestionType;
  count: number;
  totalScore: number;
  questionIds: string[];
};

export function buildPaperPreviewItems(
  questionItems: ExamQuestionFormItem[],
  questions: IQuestion[],
): PaperPreviewItem[] {
  const questionMap = new Map(questions.map((question) => [question.id, question]));

  return [...questionItems]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const question = questionMap.get(item.question_id);
      if (!question) {
        return null;
      }

      return {
        question,
        order: item.order,
        scoreOverride: item.score_override,
      };
    })
    .filter((item): item is PaperPreviewItem => Boolean(item));
}

export function buildQuestionTypeSummaries(items: PaperPreviewItem[]): QuestionTypeSummary[] {
  const grouped = new Map<QuestionType, QuestionTypeSummary>();

  for (const item of items) {
    const normalizedType = normalizeQuestionType(item.question.type);
    if (!normalizedType) {
      continue;
    }

    const existing = grouped.get(normalizedType);
    if (existing) {
      existing.count += 1;
      existing.totalScore = Number((existing.totalScore + (Number(item.scoreOverride) || 0)).toFixed(2));
      existing.questionIds.push(item.question.id);
      continue;
    }

    grouped.set(normalizedType, {
      type: normalizedType,
      count: 1,
      totalScore: Number((Number(item.scoreOverride) || 0).toFixed(2)),
      questionIds: [item.question.id],
    });
  }

  return (Object.keys(questionTypeLabels) as QuestionType[])
    .map((type) => grouped.get(type))
    .filter((item): item is QuestionTypeSummary => Boolean(item));
}

export function buildEvenScoreAllocation(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total <= 0 || count <= 0) {
    return [];
  }

  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  return Array.from({ length: count }, (_, index) => {
    const cents = baseCents + (index === count - 1 ? remainder : 0);
    return Number((cents / 100).toFixed(2));
  });
}
