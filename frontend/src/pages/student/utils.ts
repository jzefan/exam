import type { QuestionType } from "@/types";
import {
  getStudentDateLocale,
  getStudentLocale,
  getStudentQuestionTypeLabel,
  tStudent,
} from "./i18n";

export type StudentExamStatus = "upcoming" | "ongoing" | "completed" | "closed";

export interface StudentExamLike {
  status: StudentExamStatus;
  start_time: string | null;
  end_time: string | null;
  participated: boolean;
  started_at?: string | null;
  submitted_at: string | null;
}

export const questionTypeLabel: Record<QuestionType, string> = {
  choice: getStudentQuestionTypeLabel("choice"),
  true_false: getStudentQuestionTypeLabel("true_false"),
  fill_in: getStudentQuestionTypeLabel("fill_in"),
  short_answer: getStudentQuestionTypeLabel("short_answer"),
  essay: getStudentQuestionTypeLabel("essay"),
  code: getStudentQuestionTypeLabel("code"),
};

export function formatStudentDate(iso: string | null): string {
  const locale = getStudentLocale();
  if (!iso) return tStudent("common_tbd", undefined, locale);
  return new Date(iso).toLocaleString(getStudentDateLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getEffectiveStudentExamStatus(
  exam: StudentExamLike,
  now = new Date(),
): StudentExamStatus {
  if (exam.submitted_at) {
    return "completed";
  }

  const nowMs = now.getTime();
  const startMs = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
  const endMs = exam.end_time ? new Date(exam.end_time).getTime() : Number.NaN;

  if (!Number.isNaN(startMs) && nowMs >= startMs) {
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return "closed";
    }
    return "ongoing";
  }

  return exam.status === "closed" ? "closed" : "upcoming";
}

export function renderAnswerSummary(answer: Record<string, unknown>): string {
  const locale = getStudentLocale();
  if (!answer) return tStudent("common_not_answered", undefined, locale);

  if (typeof answer.code === "string" && answer.code.trim()) {
    const language = typeof answer.language === "string" ? answer.language : tStudent("common_code", undefined, locale);
    return tStudent("common_submitted_lines", { language, count: answer.code.trim().split("\n").length }, locale);
  }

  if (typeof answer.html === "string" && answer.html.trim()) {
    return answer.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || tStudent("common_not_answered", undefined, locale);
  }

  if (Array.isArray(answer.selected) && answer.selected.length > 0) {
    return answer.selected.join("、");
  }

  if (typeof answer.value === "boolean") {
    return answer.value
      ? tStudent("common_correct", undefined, locale)
      : tStudent("common_incorrect", undefined, locale);
  }

  if (Array.isArray(answer.blanks) && answer.blanks.length > 0) {
    return answer.blanks.map((item) => String(item)).join("；");
  }

  return tStudent("common_not_answered", undefined, locale);
}

export function renderStandardAnswer(answer: Record<string, unknown>): string {
  const locale = getStudentLocale();
  if (!answer) return tStudent("common_none", undefined, locale);
  if (Array.isArray(answer.points) && answer.points.length > 0) {
    return answer.points.map((item) => String(item)).join("；");
  }
  if (Array.isArray(answer.required_patterns) && answer.required_patterns.length > 0) {
    return answer.required_patterns.map((item) => String(item)).join("；");
  }
  if (Array.isArray(answer.correct)) {
    return answer.correct.join("、");
  }
  if (typeof answer.correct === "string") {
    return answer.correct;
  }
  if (typeof answer.correct === "boolean") {
    return answer.correct
      ? tStudent("common_correct", undefined, locale)
      : tStudent("common_incorrect", undefined, locale);
  }
  if (Array.isArray(answer.blanks)) {
    return answer.blanks.map((item) => String(item)).join("；");
  }
  return tStudent("common_none", undefined, locale);
}
