import type { ExamCategory, QuestionType } from "@/types";
import { getStudentLocale, tStudent } from "./i18n";

export interface IWrongAnswer {
  id: string;
  question_id: string;
  question_title: string;
  question_type: QuestionType;
  exam_id?: string | null;
  exam_title: string;
  exam_category?: ExamCategory;
  wrong_count: number;
  last_wrong_at: string;
  mastered_at: string | null;
  mastered: boolean;
  tags: string[];
  remedial_practice_count?: number;
}

export type WrongAnswerTabKey = "to_review" | "mastered";

/** 历史错题没有关联考试（`last_exam_id` 为空）时使用的分组键。 */
export const WRONG_ANSWER_LEGACY_EXAM_KEY = "legacy";

export function readWrongAnswerTab(value: string | null): WrongAnswerTabKey {
  return value === "mastered" ? "mastered" : "to_review";
}

export function getWrongAnswerCategoryLabel(
  category: ExamCategory | undefined,
  locale = getStudentLocale(),
): string {
  return category === "practice"
    ? tStudent("wrong_answers_category_practice", undefined, locale)
    : tStudent("wrong_answers_category_exam", undefined, locale);
}

/** 分组跳转地址，沿用当前的未掌握/已掌握筛选。 */
export function buildWrongAnswerExamHref(examId: string | null, tab: WrongAnswerTabKey): string {
  const key = examId ?? WRONG_ANSWER_LEGACY_EXAM_KEY;
  return `/wrong-answers/exam/${key}${tab === "mastered" ? "?tab=mastered" : ""}`;
}

/** 错题回顾列表地址，保留当前的未掌握/已掌握筛选。 */
export function buildWrongAnswerListHref(tab: WrongAnswerTabKey): string {
  return `/wrong-answers${tab === "mastered" ? "?tab=mastered" : ""}`;
}

export interface IWrongAnswerExamGroup {
  examId: string | null;
  title: string;
  category: ExamCategory | undefined;
  questionCount: number;
  lastAt: string;
  remedialPracticeCount: number;
}

/**
 * 按所属考试/练习归组：没有错题的考试/练习不会出现，因为它本来就不在错题集合里。
 */
export function buildWrongAnswerExamGroups(
  items: IWrongAnswer[],
  tab: WrongAnswerTabKey,
): IWrongAnswerExamGroup[] {
  const groups = new Map<string, IWrongAnswerExamGroup>();

  for (const item of items) {
    const key = item.exam_id ?? WRONG_ANSWER_LEGACY_EXAM_KEY;
    const at = tab === "mastered" && item.mastered_at ? item.mastered_at : item.last_wrong_at;
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        examId: item.exam_id ?? null,
        title: item.exam_title,
        category: item.exam_category,
        questionCount: 1,
        lastAt: at,
        remedialPracticeCount: item.remedial_practice_count ?? 0,
      });
      continue;
    }

    group.questionCount += 1;
    // 后端对同一来源的每道错题都带上同样的计数，取最大值避免受条目顺序影响。
    group.remedialPracticeCount = Math.max(
      group.remedialPracticeCount,
      item.remedial_practice_count ?? 0,
    );
    if (new Date(at).getTime() > new Date(group.lastAt).getTime()) {
      group.lastAt = at;
    }
  }

  return [...groups.values()].sort(
    (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
  );
}

/* ------------------------------------------------------------------ */
/*  错题强化练习                                                       */
/* ------------------------------------------------------------------ */

export interface IRemedialPracticeGroup {
  key: string;
  knowledge_point_id: string | null;
  name: string;
  path: string | null;
  wrong_question_count: number;
  suggested_count: number;
}

export interface IRemedialPracticeSummary {
  id: string;
  title: string;
  question_count: number;
  duration_minutes: number;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  score: number | null;
  total_score: number;
}

export interface IRemedialPracticeAnalysis {
  source_exam_id: string | null;
  source_title: string;
  source_category: ExamCategory;
  wrong_question_count: number;
  default_total_count: number;
  max_total_count: number;
  groups: IRemedialPracticeGroup[];
  practices: IRemedialPracticeSummary[];
}

export type RemedialPracticeStatus = "not_started" | "in_progress" | "submitted";

export function getRemedialPracticeStatus(
  practice: IRemedialPracticeSummary,
): RemedialPracticeStatus {
  if (practice.submitted_at) return "submitted";
  if (practice.started_at) return "in_progress";
  return "not_started";
}

/** 错题分组键：有考试/练习用它的 id，历史错题用 legacy。 */
export function getWrongAnswerSourceKey(examId: string | null): string {
  return examId ?? WRONG_ANSWER_LEGACY_EXAM_KEY;
}

/**
 * 把总题数按各组错题数占比分配（最大余数法），与后端 `allocate_by_weight` 一致。
 * 分组只参与前 `maxGroups` 个（按错题数降序），避免一次生成覆盖过多知识点。
 */
export function distributePracticeCounts(
  groups: IRemedialPracticeGroup[],
  total: number,
  maxGroups = 10,
): Record<string, number> {
  const ranked = [...groups]
    .sort((a, b) => b.wrong_question_count - a.wrong_question_count || a.key.localeCompare(b.key))
    .slice(0, maxGroups)
    .filter((group) => group.wrong_question_count > 0);
  if (total <= 0 || ranked.length === 0) return {};

  const weightSum = ranked.reduce((sum, group) => sum + group.wrong_question_count, 0);
  const raw = ranked.map((group) => (total * group.wrong_question_count) / weightSum);
  const counts = raw.map((value) => Math.floor(value));
  let remainder = total - counts.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - counts[index], weight: ranked[index].wrong_question_count }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || b.weight - a.weight || ranked[a.index].key.localeCompare(ranked[b.index].key),
    );
  for (const item of order) {
    if (remainder <= 0) break;
    counts[item.index] += 1;
    remainder -= 1;
  }

  const result: Record<string, number> = {};
  ranked.forEach((group, index) => {
    if (counts[index] > 0) result[group.key] = counts[index];
  });
  return result;
}

/** 进入某场强化练习（做题或看结果）时带上来源，便于做完回到错题本。 */
export function buildRemedialPracticeHref(
  sourceKey: string,
  practiceId: string,
  view: "take" | "result",
): string {
  const params = new URLSearchParams({ from: "wrong-answers", source: sourceKey });
  return `/my-exams/${practiceId}/${view}?${params.toString()}`;
}

/** 做题页/结果页的返回地址：从错题本进来的回错题本，否则维持原行为。 */
export function resolveStudentReturnHref(
  search: URLSearchParams | string,
  fallback = "/my-exams",
): string {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.get("from") !== "wrong-answers") return fallback;
  const source = params.get("source");
  return source ? `/wrong-answers/exam/${source}` : "/wrong-answers";
}
