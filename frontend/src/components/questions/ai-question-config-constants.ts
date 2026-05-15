import type { QuestionType } from "@/types";

export const AI_DIFFICULTY_LABELS: Record<number, string> = {
  1: "容易",
  2: "较易",
  3: "中等",
  4: "较难",
  5: "很难",
};

export const AI_MODEL_OPTIONS = [
  { value: "qwen", label: "通义千问", desc: "qwen-plus / qwen3.5-plus" },
  { value: "deepseek", label: "DeepSeek", desc: "deepseek-v4-pro" },
  { value: "claude", label: "Claude", desc: "Claude Sonnet" },
] as const;

export type AIModelProvider = (typeof AI_MODEL_OPTIONS)[number]["value"];

export const AI_TYPE_LABELS: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};
