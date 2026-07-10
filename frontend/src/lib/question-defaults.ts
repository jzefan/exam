import type { QuestionDisplayType } from "@/types";

/**
 * 按题型的默认分值：
 * - 判断题、单选题 → 1 分
 * - 多选题、填空题 → 2 分
 * - 简答题 → 5 分
 * - 论述题、编程题 → 10 分
 */
export const DEFAULT_SCORES: Record<QuestionDisplayType, number> = {
  single_choice: 1,
  multi_choice: 2,
  true_false: 1,
  fill_in: 2,
  short_answer: 5,
  essay: 10,
  code: 10,
};

/**
 * 根据题型获取默认分值。
 *
 * 对于后端 `choice` 类型，需传入 `isMulti` 区分单选/多选。
 * 对于前端 UI 类型（`single_choice` / `multi_choice`），直接传入即可。
 */
export function getDefaultScore(type: string, isMulti?: boolean): number {
  switch (type) {
    case "single_choice":
      return DEFAULT_SCORES.single_choice;
    case "multi_choice":
      return DEFAULT_SCORES.multi_choice;
    case "choice":
      return isMulti ? DEFAULT_SCORES.multi_choice : DEFAULT_SCORES.single_choice;
    case "true_false":
      return DEFAULT_SCORES.true_false;
    case "fill_in":
      return DEFAULT_SCORES.fill_in;
    case "short_answer":
      return DEFAULT_SCORES.short_answer;
    case "essay":
      return DEFAULT_SCORES.essay;
    case "code":
      return DEFAULT_SCORES.code;
    default:
      return 10;
  }
}
