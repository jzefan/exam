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
  allow_retake?: boolean;
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

  if (exam.status === "closed") {
    return "closed";
  }

  const nowMs = now.getTime();
  const startMs = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
  const endMs = exam.end_time ? new Date(exam.end_time).getTime() : Number.NaN;

  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return "closed";
  }

  if (Number.isNaN(startMs)) {
    return "ongoing";
  }

  if (!Number.isNaN(startMs) && nowMs >= startMs) {
    return "ongoing";
  }

  return "upcoming";
}

export function canStudentRetakeExam(exam: StudentExamLike, now = new Date()): boolean {
  if (!exam.submitted_at || !exam.allow_retake) {
    return false;
  }
  const nowMs = now.getTime();
  const startMs = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
  const endMs = exam.end_time ? new Date(exam.end_time).getTime() : Number.NaN;

  if (!Number.isNaN(startMs) && nowMs < startMs) {
    return false;
  }
  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return false;
  }
  return exam.status !== "closed";
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
  if (Array.isArray(answer.key_points) && answer.key_points.length > 0) {
    return answer.key_points.map((item) => String(item)).join("；");
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
  if (typeof answer.text === "string" && answer.text.trim()) {
    return answer.text.trim();
  }
  if (typeof answer.code === "string" && answer.code.trim()) {
    return answer.code.trim();
  }
  return tStudent("common_none", undefined, locale);
}

function decodeHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function inferStudentAnswerLanguage(
  questionTitle: string,
  questionContent: Record<string, unknown> | null | undefined,
  answer: Record<string, unknown> | null | undefined,
): string | null {
  if (answer && typeof answer.language === "string" && answer.language.trim()) {
    return answer.language.trim().toLowerCase();
  }

  const content = (questionContent ?? {}) as Record<string, unknown>;
  const explicit = [content.language, content.answer_language, content.editor_language].find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (typeof explicit === "string") {
    return explicit.trim().toLowerCase();
  }

  const prompt = `${questionTitle} ${typeof content.text === "string" ? content.text : ""}`.toLowerCase();
  if (
    /\bsql\b/.test(prompt) ||
    prompt.includes("mysql") ||
    prompt.includes("postgresql") ||
    prompt.includes("查询语句") ||
    prompt.includes("sql语句") ||
    prompt.includes("建表语句") ||
    prompt.includes("select ")
  ) {
    return "sql";
  }

  return null;
}

export function getStudentAnswerCodeLanguage(
  questionType: string,
  questionTitle: string,
  questionContent: Record<string, unknown> | null | undefined,
  answer: Record<string, unknown> | null | undefined,
): string | undefined {
  const inferred = inferStudentAnswerLanguage(questionTitle, questionContent, answer);
  if (inferred) {
    return inferred;
  }

  if (questionType === "code") {
    return undefined;
  }

  return undefined;
}

export function renderAnswerAsCode(answer: Record<string, unknown> | null | undefined): string {
  const locale = getStudentLocale();
  if (!answer) return tStudent("common_not_answered", undefined, locale);

  if (typeof answer.code === "string" && answer.code.trim()) {
    return answer.code.trim();
  }

  if (typeof answer.html === "string" && answer.html.trim()) {
    return decodeHtmlToPlainText(answer.html) || tStudent("common_not_answered", undefined, locale);
  }

  if (typeof answer.correct === "string" && answer.correct.trim()) {
    return answer.correct.trim();
  }

  if (Array.isArray(answer.points) && answer.points.length > 0) {
    return answer.points.map((item) => String(item)).join("\n");
  }

  if (Array.isArray(answer.required_patterns) && answer.required_patterns.length > 0) {
    return answer.required_patterns.map((item) => String(item)).join("\n");
  }

  if (Array.isArray(answer.correct) && answer.correct.length > 0) {
    return answer.correct.map((item) => String(item)).join("\n");
  }

  if (Array.isArray(answer.blanks) && answer.blanks.length > 0) {
    return answer.blanks.map((item) => String(item)).join("\n");
  }

  if (typeof answer.value === "string" && answer.value.trim()) {
    return answer.value.trim();
  }

  return tStudent("common_not_answered", undefined, locale);
}
