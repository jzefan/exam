import type { IQuestion, QuestionType } from "@/types";
import type { BadgeProps } from "@/components/ui/badge";

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
  return question.type === "choice" && Array.isArray(question.answer?.correct);
}

export function getQuestionAnswerText(question: IQuestion): string {
  const answer = question.answer;

  if (question.type === "choice") {
    const correct = answer.correct;
    if (Array.isArray(correct)) {
      return [...correct].sort().join("、") || "-";
    }
    return String(correct ?? "-");
  }

  if (question.type === "true_false") {
    return answer.correct === true ? "正确" : "错误";
  }

  if (question.type === "fill_in") {
    const correct = answer.correct;
    if (Array.isArray(correct)) {
      return correct.map((value, index) => `空${index + 1}: ${value}`).join("；") || "-";
    }
    return String(correct ?? "-");
  }

  if (question.type === "short_answer" || question.type === "essay") {
    const points = (answer.points ?? answer.key_points) as string[] | undefined;
    if (Array.isArray(points) && points.length > 0) {
      return points.join("；");
    }
    return String(answer.correct ?? "-");
  }

  return "";
}
