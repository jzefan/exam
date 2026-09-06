import type { IQuestion, QuestionType } from "@/types";

export const ALL_KNOWLEDGE_POINTS = "__all_knowledge_points__";
export const ALL_DIFFICULTIES = 0;

export type SmartPracticeKnowledgeOption = {
  id: string;
  name: string;
  path: string;
};

export type SmartPracticeIntent = {
  count: number;
  difficulty: number;
  knowledgePointId: string | null;
  searchTerms: string[];
};

export type SmartPracticeChatIntent = {
  count: number;
  difficulty: number;
  knowledgePointId: string | null;
};

export type SmartPracticeQuestionContext = {
  type: string;
  title: string;
  content?: unknown;
  options?: unknown;
  answer?: unknown;
  analysis?: unknown;
  difficulty?: number;
};

const DIFFICULTY_PATTERNS: Array<[RegExp, number]> = [
  [/(?:很难|极难|高难)/, 5],
  [/(?:较难|偏难|困难)/, 4],
  [/(?:中等|适中|综合难度)/, 3],
  [/(?:较易|偏易)/, 2],
  [/(?:容易|简单|基础)/, 1],
];

const STOP_WORDS = new Set([
  "请从",
  "这些",
  "题目",
  "选取",
  "选择",
  "生成",
  "一份",
  "练习",
  "围绕",
  "关于",
  "本节",
  "本章",
  "课程",
  "知识点",
  "容易",
  "简单",
  "基础",
  "较易",
  "中等",
  "适中",
  "较难",
  "困难",
  "很难",
  "综合",
]);

function extractSearchTerms(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .replace(/[0-9]+\s*(?:道|题)/g, " ")
        .split(/[\s，。；、：:（）()“”"'《》【】[\]—-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !STOP_WORDS.has(term)),
    ),
  ).slice(0, 8);
}

export function parseSmartPracticePrompt(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
  defaults: Omit<SmartPracticeIntent, "searchTerms">,
): SmartPracticeIntent {
  const countMatch = prompt.match(/(\d{1,3})\s*(?:道|题)/);
  const parsedCount = countMatch ? Number(countMatch[1]) : defaults.count;
  const difficulty = /(?:综合难度|难度均衡|混合难度)/.test(prompt)
    ? ALL_DIFFICULTIES
    : (DIFFICULTY_PATTERNS.find(([pattern]) => pattern.test(prompt))?.[1] ??
      defaults.difficulty);
  const matchedKnowledge = [...knowledgeOptions]
    .sort((left, right) => right.name.length - left.name.length)
    .find(
      (option) =>
        prompt.includes(option.name) ||
        (option.path.length > option.name.length && prompt.includes(option.path)),
    );

  return {
    count: Math.max(1, Math.min(200, parsedCount)),
    difficulty,
    knowledgePointId:
      matchedKnowledge?.id ?? defaults.knowledgePointId,
    searchTerms: extractSearchTerms(prompt),
  };
}

export function parseSmartPracticeChatPrompt(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
  previous: SmartPracticeChatIntent,
): SmartPracticeChatIntent {
  const promptWithoutOrdinalQuestions = prompt.replace(
    /第\s*\d{1,2}\s*(?:道)?题/g,
    "",
  );
  const absoluteCountMatches = [
    ...promptWithoutOrdinalQuestions.matchAll(/(\d{1,2})\s*(?:道|题)/g),
  ];
  const lastAbsoluteCount = absoluteCountMatches.at(-1)?.[1];
  const relativeDecrease = prompt.match(
    /(?:减少|少|删掉|去掉)\s*(\d{1,2})\s*(?:道|题)?/,
  );
  const relativeIncrease = prompt.match(
    /(?:增加|新增|多|再加|加上)\s*(\d{1,2})\s*(?:道|题)?/,
  );

  let count = lastAbsoluteCount ? Number(lastAbsoluteCount) : previous.count;
  if (relativeDecrease) count = previous.count - Number(relativeDecrease[1]);
  if (relativeIncrease) count = previous.count + Number(relativeIncrease[1]);

  const parsed = parseSmartPracticePrompt(
    promptWithoutOrdinalQuestions,
    knowledgeOptions,
    {
      count,
      difficulty: previous.difficulty,
      knowledgePointId: previous.knowledgePointId,
    },
  );
  let difficulty = parsed.difficulty || 3;
  if (!DIFFICULTY_PATTERNS.some(([pattern]) => pattern.test(prompt))) {
    if (/(?:更难|难一点|提高难度)/.test(prompt)) {
      difficulty = Math.min(5, Math.max(1, previous.difficulty || 3) + 1);
    } else if (/(?:更简单|简单一点|容易一点|降低难度)/.test(prompt)) {
      difficulty = Math.max(1, (previous.difficulty || 3) - 1);
    }
  }

  return {
    count: Math.max(1, Math.min(50, count)),
    difficulty,
    knowledgePointId: parsed.knowledgePointId,
  };
}

export function parseSmartPracticeReplacementTarget(
  prompt: string,
  questionCount: number,
): number | null {
  if (!/(?:更换|替换|换掉|换一下|重出|重新出|改写)/.test(prompt)) {
    return null;
  }
  const match = prompt.match(/第\s*(\d{1,2})\s*(?:道)?题/);
  if (!match) return null;
  const questionNumber = Number(match[1]);
  if (questionNumber < 1 || questionNumber > questionCount) return null;
  return questionNumber - 1;
}

export function buildSmartPracticeReplacementPrompt(
  questions: SmartPracticeQuestionContext[],
  targetIndex: number,
  currentPrompt: string,
): string {
  const target = questions[targetIndex];
  const lockedOutline = questions
    .map((question, index) => `${index + 1}. [${question.type}] ${question.title}`)
    .join("\n")
    .slice(0, 700);
  const targetDetail = JSON.stringify({
    type: target?.type,
    title: target?.title,
    content: target?.content,
    options: target?.options,
    answer: target?.answer,
    analysis: target?.analysis,
    difficulty: target?.difficulty,
  }).slice(0, 900);

  return [
    "这是对现有练习的局部编辑，不是重新生成整份练习。",
    `只生成 1 道用于替换第 ${targetIndex + 1} 题的新题；不要输出其它题目。`,
    "新题须保持原题的题型、难度和知识范围，但题干、答案与解析不能是原题的近似改写。",
    `教师要求：${currentPrompt}`,
    `当前完整题单（除第 ${targetIndex + 1} 题外均锁定）：\n${lockedOutline}`,
    `待替换原题：\n${targetDetail}`,
  ].join("\n\n");
}

export function buildSmartPracticeConversationPrompt(
  turns: Array<{
    prompt: string;
    questions: Array<{ type: string; title: string }>;
  }>,
  currentPrompt: string,
): string {
  const recentTurns = turns.slice(-3).map((turn, turnIndex) => {
    const questionSummary = turn.questions
      .slice(0, 12)
      .map(
        (question, questionIndex) =>
          `${questionIndex + 1}. [${question.type}] ${question.title}`,
      )
      .join("\n");
    return [
      `第 ${turnIndex + 1} 轮教师要求：${turn.prompt}`,
      `该轮完整题单：\n${questionSummary || "未生成题目"}`,
    ].join("\n");
  });

  return [
    "你正在与教师持续调整一份练习。请结合对话历史和最新要求，输出调整后的完整题目列表，不要只输出变更部分。",
    ...recentTurns,
    `最新要求：${currentPrompt}`,
  ].join("\n\n").slice(-2000);
}

function questionText(question: IQuestion): string {
  const content =
    typeof question.content?.text === "string"
      ? question.content.text
      : JSON.stringify(question.content ?? {});
  const knowledge = question.knowledge_points.map((item) => item.name).join(" ");
  return `${question.title} ${content} ${knowledge}`.toLowerCase();
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function questionTypeGroup(question: IQuestion): QuestionType {
  return question.type;
}

/**
 * Select a repeatable, type-balanced practice set. Explicit knowledge and
 * difficulty constraints are strict; free-form terms only influence ranking.
 */
export function selectSmartPracticeQuestions(
  source: IQuestion[],
  intent: SmartPracticeIntent,
  variation = 0,
): IQuestion[] {
  const eligible = source.filter((question) => {
    const matchesKnowledge =
      !intent.knowledgePointId ||
      question.knowledge_points.some(
        (point) => point.id === intent.knowledgePointId,
      );
    const matchesDifficulty =
      intent.difficulty === ALL_DIFFICULTIES ||
      question.difficulty === intent.difficulty;
    return matchesKnowledge && matchesDifficulty;
  });

  const scored = eligible
    .map((question) => {
      const text = questionText(question);
      const relevance = intent.searchTerms.reduce(
        (score, term) => score + (text.includes(term.toLowerCase()) ? 1 : 0),
        0,
      );
      return {
        question,
        relevance,
        tieBreaker: stableHash(`${variation}:${question.id}`),
      };
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        left.tieBreaker - right.tieBreaker,
    );

  const buckets = new Map<QuestionType, IQuestion[]>();
  for (const item of scored) {
    const type = questionTypeGroup(item.question);
    const bucket = buckets.get(type) ?? [];
    bucket.push(item.question);
    buckets.set(type, bucket);
  }

  const picked: IQuestion[] = [];
  const orderedTypes = [...buckets.keys()].sort(
    (left, right) =>
      (buckets.get(right)?.length ?? 0) - (buckets.get(left)?.length ?? 0),
  );
  while (picked.length < intent.count) {
    let added = false;
    for (const type of orderedTypes) {
      const next = buckets.get(type)?.shift();
      if (!next) continue;
      picked.push(next);
      added = true;
      if (picked.length >= intent.count) break;
    }
    if (!added) break;
  }

  return picked;
}

export function getQuestionPreviewText(question: IQuestion): string {
  const value =
    question.title ||
    (typeof question.content?.text === "string" ? question.content.text : "");
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "未命名题目";
}
