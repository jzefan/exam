/**
 * Helpers for the inline (click-to-edit) question editor.
 *
 * The list view lets a teacher click the stem or the reference answer and edit
 * it in place. That is only safe when nothing but plain paragraphs is involved:
 * rich content (images, tables, formulas, styled spans) would be flattened by a
 * text round trip, so those keep using the full edit dialog.
 */

import type { IQuestion } from "@/types";
import { getQuestionAnswerText, normalizeQuestionType } from "./question-preview-utils";

/** Anything richer than a paragraph: images, tables, lists, code, styling. */
const RICH_MARKUP = /<(?!\/?(?:p|br)\b)[a-z][^>]*>|<img|<table|<pre|<code|<ul|<ol|<svg|<math/i;

export function canInlineEditStem(question: IQuestion): boolean {
  const html = typeof question.content?.html === "string" ? question.content.html : "";
  if (!html) {
    return true;
  }
  return !RICH_MARKUP.test(html);
}

/** Plain text shown in the inline stem editor. */
export function stemInlineText(question: IQuestion): string {
  const html = typeof question.content?.html === "string" ? question.content.html : "";
  if (html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
  }
  const text = question.content?.text;
  const plain = typeof text === "string" ? text : (question.title ?? "");
  return plain.trim();
}

/** Rebuild a minimal html body from the edited plain text. */
export function stemHtmlFromText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}

/**
 * The answer as editable text.
 *
 * - fill_in: one blank per line ("甲\n乙")
 * - short_answer / essay: one scoring point per line
 * - choice: letters ("A、C")
 * - true_false: 正确 / 错误
 * - code: the reference implementation
 */
export function answerInlineText(question: IQuestion): string {
  const normalized = normalizeQuestionType(question.type);
  const answer = question.answer ?? {};

  if (normalized === "fill_in") {
    const correct = answer.correct;
    if (Array.isArray(correct)) {
      return correct.map((value) => String(value)).join("\n");
    }
    if (typeof answer.text === "string") {
      return answer.text;
    }
    return correct == null ? "" : String(correct);
  }

  if (normalized === "short_answer" || normalized === "essay") {
    const points = (answer.points ?? answer.key_points) as unknown;
    if (Array.isArray(points) && points.length > 0) {
      return points.map((point) => String(point)).join("\n");
    }
    if (typeof answer.text === "string") {
      return answer.text;
    }
    return answer.correct == null ? "" : String(answer.correct);
  }

  return getQuestionAnswerText(question);
}

export function canInlineEditAnswer(question: IQuestion): boolean {
  // Rich answer bodies (images in short answers) cannot round-trip through text.
  const answerHtml = typeof question.answer?.html === "string" ? question.answer.html : "";
  return !answerHtml.trim();
}

/** Convert the edited text back into the persisted `answer` shape. */
export function answerFromInlineText(
  question: IQuestion,
  text: string,
): Record<string, unknown> {
  const normalized = normalizeQuestionType(question.type);
  const answer: Record<string, unknown> = { ...(question.answer ?? {}) };
  delete answer.html;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalized === "fill_in") {
    answer.correct = lines;
    return answer;
  }

  if (normalized === "short_answer" || normalized === "essay") {
    const hadPoints = Array.isArray(answer.points) || Array.isArray(answer.key_points);
    if (hadPoints) {
      answer.points = lines;
    } else {
      answer.text = text.trim();
    }
    return answer;
  }

  if (normalized === "choice") {
    const letters = text
      .split(/[,,、\s]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    answer.correct = Array.isArray(answer.correct) ? letters : letters.join("");
    return answer;
  }

  if (normalized === "true_false") {
    answer.correct = text.trim().startsWith("正") || text.trim().toLowerCase() === "true";
    return answer;
  }

  if (normalized === "code") {
    answer.code = text.replace(/\n+$/, "");
    return answer;
  }

  answer.text = text.trim();
  return answer;
}
