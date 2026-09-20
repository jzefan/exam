import type { IQuestion, QuestionDisplayType, QuestionType } from "@/types";
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

export const questionTypeFullLabel: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export const questionDisplayTypeFullLabel: Record<QuestionDisplayType, string> = {
  single_choice: "单选题",
  multi_choice: "多选题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export const questionDisplayTypeShortLabel: Record<QuestionDisplayType, string> = {
  single_choice: "单选",
  multi_choice: "多选",
  true_false: "判断",
  fill_in: "填空",
  short_answer: "简答",
  essay: "论述",
  code: "编程",
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
  3: { label: "中等", variant: "outline" },
  4: { label: "较难", variant: "warning" },
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

/**
 * 题型判定只依赖这几个字段。
 *
 * 考试作答页拿到的是 `IExamQuestionForStudent`（没有 `answer`，因为作答时还没交卷），
 * 用结构化最小集可以让同一套判定在题库页和作答页复用，不必造假字段或做类型断言。
 */
export type QuestionTypeSource = {
  type: string | null | undefined;
  content?: Record<string, unknown> | null;
  answer?: Record<string, unknown> | null;
};

export function isMultiChoice(question: QuestionTypeSource): boolean {
  return (
    normalizeQuestionType(question.type) === "choice" &&
    (question.content?.multi === true || Array.isArray(question.answer?.correct))
  );
}

export function getQuestionDisplayType(
  question: QuestionTypeSource,
): QuestionDisplayType | null {
  const normalizedType = normalizeQuestionType(question.type);
  if (!normalizedType) {
    return null;
  }
  if (normalizedType === "choice") {
    return isMultiChoice(question) ? "multi_choice" : "single_choice";
  }
  return normalizedType;
}

export function getQuestionDisplayTypeLabel(question: IQuestion): string {
  const displayType = getQuestionDisplayType(question);
  return displayType ? questionDisplayTypeFullLabel[displayType] : "题目";
}

/**
 * 归一化正确答案对应的选项键集合。
 *
 * 约定上单选题是 `"A"`、多选题是 `["A","B"]`，但历史数据与导入数据里也出现过
 * `"ABC"`、`"A、B"` 这类合并写法。这里统一拆成单个选项键，保证「正确答案标在选项上」
 * 的展示方式在任何存量数据下都不会丢答案。
 */
export function normalizeCorrectOptionKeys(
  raw: unknown,
  optionKeys: Set<string>,
): Set<string> {
  const normalized = new Set<string>();
  const addKey = (value: unknown) => {
    const key = String(value ?? "").trim();
    if (!key) return;
    normalized.add(key);
    const upper = key.toUpperCase();
    if (upper !== key) normalized.add(upper);
  };

  if (Array.isArray(raw)) {
    raw.forEach(addKey);
    return normalized;
  }
  if (typeof raw !== "string") {
    if (raw != null) addKey(raw);
    return normalized;
  }

  const text = raw.trim();
  if (!text) return normalized;

  const parts = text.split(/[\s,，、;；/|]+/).filter(Boolean);
  if (parts.length > 1) {
    parts.forEach(addKey);
    return normalized;
  }

  // 合并写法（如 "ABC"）：只有当每个字符都是真实存在的选项键时才拆分，避免误拆。
  const chars = [...text];
  if (chars.length > 1 && chars.every((char) => optionKeys.has(char))) {
    chars.forEach(addKey);
    return normalized;
  }

  addKey(text);
  return normalized;
}

/**
 * 判断题目的正确答案能否内联标记到选项上。
 *
 * `markChoiceAnswer` 会隐藏独立的「参考答案」区。若答案匹配不上任何选项键
 * （例如答案写成了「以上都对」，或与选项键大小写/形式不一致），答案就会彻底看不见。
 * 因此调用方只在能标出至少一个选项时才启用内联标记。
 */
export function canMarkChoiceAnswerInline(question: IQuestion): boolean {
  if (normalizeQuestionType(question.type) !== "choice" || !question.options) {
    return false;
  }
  const optionKeys = new Set(Object.keys(question.options));
  if (optionKeys.size === 0) {
    return false;
  }
  for (const key of normalizeCorrectOptionKeys(
    question.answer?.correct,
    optionKeys,
  )) {
    if (optionKeys.has(key)) {
      return true;
    }
  }
  return false;
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

  if (normalizedType === "code") {
    if (typeof answer.code === "string") return answer.code;
    if (typeof answer.text === "string") return answer.text;
    if (answer.correct != null) return String(answer.correct);
    return "-";
  }

  if (typeof answer.text === "string") return answer.text;
  if (answer.correct != null) return String(answer.correct);
  return "-";
}
