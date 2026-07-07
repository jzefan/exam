import type { QuestionDisplayType } from "@/types";

export const AI_DIFFICULTY_LABELS: Record<number, string> = {
  1: "容易",
  2: "较易",
  3: "中等",
  4: "较难",
  5: "很难",
};

export const AI_MODEL_OPTIONS = [
  { value: "deepseek", label: "DeepSeek", desc: "deepseek-v4-flash" },
  { value: "qwen", label: "通义千问", desc: "qwen-plus / qwen3.5-plus" },
  { value: "claude", label: "Claude", desc: "Claude Sonnet" },
] as const;

export type AIModelProvider = (typeof AI_MODEL_OPTIONS)[number]["value"];

export type AIQuestionType = QuestionDisplayType;

export const AI_TYPE_LABELS: Record<AIQuestionType, string> = {
  single_choice: "单选题",
  multi_choice: "多选题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export const EMPTY_AI_TYPE_ALLOC: Record<AIQuestionType, number> = {
  single_choice: 0,
  multi_choice: 0,
  true_false: 0,
  fill_in: 0,
  short_answer: 0,
  essay: 0,
  code: 0,
};
