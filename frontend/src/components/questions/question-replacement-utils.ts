import type { IQuestion, IQuestionBank, QuestionType } from "@/types";

export type QuestionReplacementApiRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

export type QuestionReplacementBankTarget = Pick<
  IQuestionBank,
  "id" | "name"
>;

export type QuestionReplacementCandidate = {
  kind: "random" | "ai";
  preview: IQuestion;
  targetBank: QuestionReplacementBankTarget;
  generated?: Record<string, unknown>;
};

export type QuestionReplacementConfirmPayload = {
  originalQuestion: IQuestion;
  replacementQuestion: IQuestion;
  candidate: QuestionReplacementCandidate;
};

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export function getQuestionTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type;
}

export function getQuestionPlainText(question: IQuestion): string {
  const content = question.content as
    | { text?: unknown; html?: unknown }
    | string
    | null
    | undefined;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (content && typeof content === "object") {
    if (typeof content.text === "string" && content.text.trim()) {
      return content.text.trim();
    }
    if (typeof content.html === "string" && content.html.trim()) {
      return content.html.replace(/<[^>]+>/g, " ").trim();
    }
  }
  return question.title ?? "";
}

export function buildQuestionReplacementKnowledgePointIds(
  question: IQuestion,
  fallbackKnowledgePointId?: string | null,
): string[] {
  const ids = (question.knowledge_points ?? [])
    .map((knowledgePoint) => knowledgePoint.id)
    .filter(Boolean);
  if (ids.length > 0) return ids;
  return fallbackKnowledgePointId ? [fallbackKnowledgePointId] : [];
}

function isMultiChoiceQuestion(question: IQuestion): boolean {
  const correct = question.answer?.correct;
  if (Array.isArray(correct)) return true;
  const content = question.content as { multi?: unknown } | null | undefined;
  return content?.multi === true;
}

function getOptionCount(question: IQuestion): number {
  return Object.keys(question.options ?? {}).length;
}

function getFillBlankCount(question: IQuestion): number {
  const correct = question.answer?.correct;
  return Array.isArray(correct) ? correct.length : 1;
}

export function getQuestionStructureSignature(question: IQuestion): string {
  if (question.type === "choice") {
    return `choice:${isMultiChoiceQuestion(question) ? "multi" : "single"}:${getOptionCount(question)}`;
  }
  if (question.type === "fill_in") {
    return `fill_in:${getFillBlankCount(question)}`;
  }
  if (question.type === "code") {
    const content = question.content as
      | { mode?: unknown; language?: unknown }
      | null
      | undefined;
    return `code:${String(content?.mode ?? "program")}:${String(content?.language ?? "")}`;
  }
  return question.type;
}

export function describeQuestionStructure(question: IQuestion): string {
  if (question.type === "choice") {
    return `${isMultiChoiceQuestion(question) ? "多选" : "单选"}，${getOptionCount(question)} 个选项`;
  }
  if (question.type === "fill_in") {
    return `${getFillBlankCount(question)} 个填空`;
  }
  if (question.type === "code") {
    const content = question.content as
      | { mode?: unknown; language?: unknown }
      | null
      | undefined;
    return `${String(content?.mode ?? "program")} 模式${
      content?.language ? `，语言 ${String(content.language)}` : ""
    }`;
  }
  return "保持原题结构";
}

export function buildQuestionReplacementPrompt(
  question: IQuestion,
  options: {
    rootKnowledgePointName?: string | null;
    targetBankName?: string | null;
    extraPrompt?: string;
  } = {},
): string {
  const typeLabel = getQuestionTypeLabel(question.type);
  const kpNames =
    (question.knowledge_points ?? []).map((kp) => kp.name).join("、") ||
    options.rootKnowledgePointName ||
    "（无）";
  const content = getQuestionPlainText(question).slice(0, 500);
  const extra = options.extraPrompt?.trim();
  return `请基于下面的原题，生成一道用于替换它的新题，必须保持在同一课程/主知识点、同一子知识点范围内。
要求：
- 题库：${options.targetBankName || question.question_bank_name || "原题所在题库"}
- 与原题属于同一子知识点：${kpNames}
- 原题题型：${typeLabel}；新题必须保持相同题型与难度。
- 原题难度：${question.difficulty}/5。
- 题目结构：${describeQuestionStructure(question)}；新题结构必须相似。
- 必须限定在上述学科与知识点范围内，不要生成与该范围无关的题目。
- 不要照抄原题，也不要只替换数字形成近似重复题。
- 若为选择题，选项数量和单选/多选结构必须与原题一致。
- 若为编程题，answer.text 必须包含可运行的参考实现或关键解题步骤；answer.code 也可以同步提供，二者不能都为空。
${extra ? `- 教师补充要求：${extra}` : ""}

原题题干：
${content}`.trim();
}

export async function streamGenerateReplacementQuestion({
  question,
  knowledgePointIds,
  examTitle,
  prompt,
}: {
  question: IQuestion;
  knowledgePointIds: string[];
  examTitle?: string;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const token = localStorage.getItem("access_token");
  const response = await fetch("/api/questions/ai-generate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      total_count: 1,
      difficulty: question.difficulty,
      type_distribution: { [question.type]: 1 },
      knowledge_point_ids: knowledgePointIds,
      exam_title: examTitle?.trim() || undefined,
      prompt,
      model: "deepseek",
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error("AI 生成请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let generated: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const event = JSON.parse(
        dataLine.replace(/^data:\s*/, ""),
      ) as Record<string, unknown>;
      if (event.type === "question") {
        generated = event.data as Record<string, unknown>;
      } else if (event.type === "error") {
        throw new Error((event.message as string) || "AI 生成失败");
      }
    }
  }

  if (!generated) {
    throw new Error("AI 未返回题目数据");
  }
  return generated;
}

export function buildQuestionReplacementPreviewQuestion({
  generated,
  originalQuestion,
  targetBank,
  knowledgePoints,
}: {
  generated: Record<string, unknown>;
  originalQuestion: IQuestion;
  targetBank: QuestionReplacementBankTarget;
  knowledgePoints: IQuestion["knowledge_points"];
}): IQuestion {
  const now = new Date().toISOString();
  return {
    id: "question-replacement-preview",
    type: (generated.type as QuestionType | undefined) ?? originalQuestion.type,
    title:
      (generated.title as string | undefined) ||
      ((generated.content as { text?: string } | undefined)?.text?.slice(
        0,
        120,
      ) ??
        originalQuestion.title),
    content:
      (generated.content as IQuestion["content"] | undefined) ?? { text: "" },
    options: (generated.options as IQuestion["options"] | undefined) ?? null,
    answer: (generated.answer as IQuestion["answer"] | undefined) ?? {},
    analysis: (generated.analysis as string | null | undefined) ?? null,
    difficulty:
      (generated.difficulty as number | undefined) ??
      originalQuestion.difficulty,
    score: originalQuestion.score,
    source: "ai_generated",
    usage_count: 0,
    question_bank_id: targetBank.id,
    question_bank_name: targetBank.name,
    tags: [],
    knowledge_points: knowledgePoints,
    edit_lock: null,
    created_by: "",
    created_by_name: "",
    created_at: now,
    updated_at: now,
  };
}
