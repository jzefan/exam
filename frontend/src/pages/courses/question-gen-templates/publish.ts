// 发布：把智能出题生成的题目保存到课程题库（拿到真实题目 ID），再以 seed 形式
// 跳转到「创建考试」或「发布作业」向导预填这些题。复用 lib/exam-seed 的一次性
// sessionStorage 机制（题目 ID 不塞进 URL）。

import type { NavigateFunction } from "react-router-dom";

import { writeExamSeed } from "@/lib/exam-seed";
import type { AIGeneratedQuestionPreview } from "@/components/questions/ai-generated-question-card";
import { saveGeneratedToCourseBank } from "./api";

export type PublishTarget = "exam" | "practice";

function answerText(answer: AIGeneratedQuestionPreview["answer"]): string {
  const raw = answer?.text ?? answer?.correct;
  if (Array.isArray(raw)) return raw.join("");
  return raw == null ? "" : String(raw).trim();
}

/** 生成题目 → 保存到课程题库的入库 payload（与表单/对话保存逻辑一致）。 */
export function buildSavePayload(questions: AIGeneratedQuestionPreview[], courseId: string) {
  return questions.map((q) => ({
    type: q.type,
    title: q.title,
    content: q.content,
    options: q.options,
    answer: q.type === "code" ? { ...q.answer, code: answerText(q.answer) } : q.answer,
    analysis: q.analysis,
    difficulty: q.difficulty,
    score: 10,
    tag_ids: [],
    knowledge_point_ids: [courseId],
  }));
}

/** 代码题缺少参考答案时返回 true（发布/保存前应拦截）。 */
export function hasCodeMissingAnswer(questions: AIGeneratedQuestionPreview[]): boolean {
  return questions.some((q) => q.type === "code" && !answerText(q.answer));
}

/**
 * 发布：保存到课程题库后，带着新建题目的 ID 跳转到考试/作业创建向导。
 * 返回保存入库的题目数量。
 */
export async function publishGenerated(opts: {
  courseId: string;
  courseName?: string;
  questions: AIGeneratedQuestionPreview[];
  target: PublishTarget;
  navigate: NavigateFunction;
}): Promise<number> {
  const result = await saveGeneratedToCourseBank(buildSavePayload(opts.questions, opts.courseId));
  const ids = result.created_question_ids ?? [];
  const seedKey = writeExamSeed({
    category: opts.target,
    question_items: ids.map((question_id, index) => ({ question_id, order: index, score_override: null })),
  });
  const route = opts.target === "exam" ? "/exams/create" : "/exams/practice/create";
  const tab = opts.target === "exam" ? "exams" : "assignments";
  opts.navigate(`${route}?seed_key=${seedKey}`, {
    state: {
      backTo: `/courses/${opts.courseId}/question-skills`,
      backLabel: "返回智能出题",
      successTo: `/courses/${opts.courseId}?tab=${tab}`,
      courseKpId: opts.courseId,
      courseName: opts.courseName,
    },
  });
  return ids.length;
}
