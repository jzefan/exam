import {
  buildQuestionReplacementKnowledgePointIds,
  buildQuestionReplacementPrompt,
  getQuestionPlainText,
} from "@/components/questions/question-replacement-utils";
import type { IQuestion } from "@/types";

const QUESTION_TYPE_LABELS: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export function buildExamAIReplacementKnowledgePointIds(
  question: IQuestion,
  courseKnowledgePointId?: string | null,
): string[] {
  return buildQuestionReplacementKnowledgePointIds(
    question,
    courseKnowledgePointId,
  );
}

export function buildExamAIReplacementPrompt(
  question: IQuestion,
  extraPrompt = "",
): string {
  return buildQuestionReplacementPrompt(question, { extraPrompt });
}

/** 生成"只重判答案与解析"的 AI 提示词：保持题干/选项/题型不变。 */
export function buildExamAnswerAnalysisPrompt(question: IQuestion): string {
  const typeLabel = QUESTION_TYPE_LABELS[question.type] ?? question.type;
  const content = getQuestionPlainText(question).slice(0, 500);
  const optionsStr = question.options
    ? JSON.stringify(question.options)
    : "（无）";
  const perOption =
    question.type === "choice"
      ? "\n- analysis 必须逐项说明每个选项为什么正确或为什么错误。"
      : "";
  return `请只重新判断 answer 与 analysis，不要改变题干、选项或题型。
题型：${typeLabel}
题干：${content}
选项：${optionsStr}${perOption}

只返回符合原题型格式的答案与解析。`.trim();
}
