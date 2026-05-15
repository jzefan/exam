import type { IQuestion, QuestionType } from "@/types";
import type { BadgeProps } from "@/components/ui/badge";

const QUESTION_TYPE_ALIASES: Record<string, QuestionType> = {
  choice: "choice",
  "选择题": "choice",
  "单选题": "choice",
  "单选": "choice",
  "多选题": "choice",
  "多选": "choice",
  true_false: "true_false",
  truefalse: "true_false",
  boolean: "true_false",
  judge: "true_false",
  judgement: "true_false",
  judgment: "true_false",
  "判断题": "true_false",
  判断: "true_false",
  fill_in: "fill_in",
  fillin: "fill_in",
  fill: "fill_in",
  blank: "fill_in",
  "填空题": "fill_in",
  填空: "fill_in",
  short_answer: "short_answer",
  shortanswer: "short_answer",
  "简答题": "short_answer",
  简答: "short_answer",
  essay: "essay",
  "论述题": "essay",
  论述: "essay",
  code: "code",
  coding: "code",
  programming: "code",
  "编程题": "code",
  编程: "code",
};

export const questionTypeChar: Record<QuestionType, string> = {
  choice: "选",
  true_false: "判",
  fill_in: "填",
  short_answer: "简",
  essay: "论",
  code: "编",
};

export const questionTypeColorClass: Record<QuestionType, string> = {
  choice: "bg-blue-500 text-white",
  true_false: "bg-teal-500 text-white",
  fill_in: "bg-purple-500 text-white",
  short_answer: "bg-orange-500 text-white",
  essay: "bg-pink-500 text-white",
  code: "bg-emerald-500 text-white",
};

export const questionDifficultyConfig: Record<number, { label: string; variant: BadgeProps["variant"] }> = {
  1: { label: "容易", variant: "success" },
  2: { label: "较易", variant: "secondary" },
  3: { label: "一般", variant: "outline" },
  4: { label: "难", variant: "warning" },
  5: { label: "很难", variant: "destructive" },
};

export function normalizeQuestionType(type: string | null | undefined): QuestionType | null {
  if (!type) {
    return null;
  }

  return QUESTION_TYPE_ALIASES[type.trim().toLowerCase()] ?? QUESTION_TYPE_ALIASES[type.trim()] ?? null;
}

export function getQuestionTitle(question: IQuestion): string {
  if (typeof question.content?.text === "string" && question.content.text.trim()) {
    return question.content.text;
  }
  return question.title;
}

export function getQuestionContentHtml(question: IQuestion): string | null {
  if (typeof question.content?.html === "string" && question.content.html.trim()) {
    return question.content.html;
  }
  return null;
}

export function isMultiChoice(question: IQuestion): boolean {
  return normalizeQuestionType(question.type) === "choice" && Array.isArray(question.answer?.correct);
}

export function getQuestionAnswerText(question: IQuestion): string {
  const answer = question.answer;
  const normalizedType = normalizeQuestionType(question.type);

  if (normalizedType === "choice") {
    const correct = answer.correct;
    if (Array.isArray(correct)) {
      return [...correct].sort().join("、") || "-";
    }
    return String(correct ?? "-");
  }

  if (normalizedType === "true_false") {
    return answer.correct === true ? "正确" : "错误";
  }

  if (normalizedType === "fill_in") {
    const correct = answer.correct;
    if (Array.isArray(correct)) {
      return correct.map((value, index) => `空${index + 1}: ${value}`).join("；") || "-";
    }
    if (correct != null) return String(correct);
    if (typeof answer.text === "string") return answer.text;
    return "-";
  }

  if (normalizedType === "short_answer" || normalizedType === "essay") {
    const points = (answer.points ?? answer.key_points) as string[] | undefined;
    if (Array.isArray(points) && points.length > 0) {
      return points.join("；");
    }
    if (answer.correct != null) return String(answer.correct);
    if (typeof answer.text === "string") return answer.text;
    return "-";
  }

  if (typeof answer.text === "string") return answer.text;
  if (answer.correct != null) return String(answer.correct);
  return "-";
}
