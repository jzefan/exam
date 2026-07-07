import {
  isMultiChoice,
  normalizeQuestionType,
} from "@/components/questions/question-preview-utils";
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

const questionTypeDisplayOrder: Record<QuestionType, number> = {
  choice: 0,
  true_false: 1,
  fill_in: 2,
  short_answer: 3,
  essay: 4,
  code: 5,
};

export const splitChoiceTypeLabels = {
  single_choice: "单选题",
  multi_choice: "多选题",
} as const;

export const splitQuestionTypeDisplayOrder: Record<string, number> = {
  single_choice: 0,
  multi_choice: 1,
  true_false: 2,
  fill_in: 3,
  short_answer: 4,
  essay: 5,
  code: 6,
};

export type PaperPreviewItem = {
  question: IQuestion;
  order: number;
  scoreOverride: number | null;
  sourceExamId: string | null;
  sourceQuestionId: string | null;
  isSourceReused: boolean;
};

export function getPaperQuestionAnchorId(questionId: string) {
  return `paper-question-${questionId}`;
}

export type QuestionTypeSummary = {
  type: QuestionType;
  key?: string;
  label?: string;
  count: number;
  totalScore: number;
  questionIds: string[];
};

export type QuestionJumpItem = {
  previewItem: PaperPreviewItem;
  displayIndex: number;
};

export type QuestionJumpGroup = {
  summary: QuestionTypeSummary;
  items: QuestionJumpItem[];
};

export function getQuestionTypeGroupKey(question: IQuestion): string | null {
  const normalizedType = normalizeQuestionType(question.type);
  if (!normalizedType) {
    return null;
  }
  if (normalizedType === "choice") {
    return isMultiChoice(question) ? "multi_choice" : "single_choice";
  }
  return normalizedType;
}

export function getQuestionTypeGroupLabel(summary: QuestionTypeSummary): string {
  return summary.label ?? questionTypeLabels[summary.type] ?? "题目";
}

export function buildPaperPreviewItems(
  questionItems: ExamQuestionFormItem[],
  questions: IQuestion[],
): PaperPreviewItem[] {
  const questionMap = new Map(questions.map((question) => [question.id, question]));

  return [...questionItems]
    .map((item) => {
      const question = questionMap.get(item.question_id);
      if (!question) {
        return null;
      }

      return {
        question,
        order: item.order,
        scoreOverride: item.score_override,
        sourceExamId: item.source_exam_id ?? null,
        sourceQuestionId: item.source_question_id ?? null,
        isSourceReused: Boolean(
          item.source_exam_id &&
          item.source_question_id &&
          item.source_question_id === question.id,
        ),
      };
    })
    .filter((item): item is PaperPreviewItem => Boolean(item))
    .sort((a, b) => {
      const aType = normalizeQuestionType(a.question.type);
      const bType = normalizeQuestionType(b.question.type);
      const aTypeOrder = aType === null ? Number.MAX_SAFE_INTEGER : questionTypeDisplayOrder[aType];
      const bTypeOrder = bType === null ? Number.MAX_SAFE_INTEGER : questionTypeDisplayOrder[bType];

      if (aTypeOrder !== bTypeOrder) {
        return aTypeOrder - bTypeOrder;
      }

      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return a.question.id.localeCompare(b.question.id);
    });
}

export function buildQuestionTypeSummaries(
  items: PaperPreviewItem[],
  options: { splitChoice?: boolean } = {},
): QuestionTypeSummary[] {
  const grouped = new Map<string, QuestionTypeSummary>();

  for (const item of items) {
    const normalizedType = normalizeQuestionType(item.question.type);
    if (!normalizedType) {
      continue;
    }

    const key = options.splitChoice
      ? getQuestionTypeGroupKey(item.question)
      : normalizedType;
    if (!key) {
      continue;
    }
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalScore = Number((existing.totalScore + (Number(item.scoreOverride) || 0)).toFixed(2));
      existing.questionIds.push(item.question.id);
      continue;
    }

    grouped.set(key, {
      type: normalizedType,
      ...(options.splitChoice
        ? {
            key,
            label:
              key === "single_choice"
                ? splitChoiceTypeLabels.single_choice
                : key === "multi_choice"
                  ? splitChoiceTypeLabels.multi_choice
                  : questionTypeLabels[normalizedType],
          }
        : {}),
      count: 1,
      totalScore: Number((Number(item.scoreOverride) || 0).toFixed(2)),
      questionIds: [item.question.id],
    });
  }

  if (options.splitChoice) {
    return Array.from(grouped.values()).sort(
      (left, right) =>
        (splitQuestionTypeDisplayOrder[left.key ?? left.type] ?? Number.MAX_SAFE_INTEGER) -
        (splitQuestionTypeDisplayOrder[right.key ?? right.type] ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return (Object.keys(questionTypeLabels) as QuestionType[])
    .map((type) => grouped.get(type))
    .filter((item): item is QuestionTypeSummary => Boolean(item));
}

export function buildQuestionJumpGroups(
  items: PaperPreviewItem[],
  summaries: QuestionTypeSummary[],
): QuestionJumpGroup[] {
  const itemByQuestionId = new Map(
    items.map((item, index) => [
      item.question.id,
      {
        previewItem: item,
        displayIndex: index + 1,
      },
    ]),
  );

  return summaries
    .map((summary) => ({
      summary,
      items: summary.questionIds
        .map((questionId) => itemByQuestionId.get(questionId))
        .filter((item): item is QuestionJumpItem => Boolean(item)),
    }))
    .filter((group) => group.items.length > 0);
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
