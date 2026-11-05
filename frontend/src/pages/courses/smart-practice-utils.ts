import type { ChoiceDisplayType, IQuestion, QuestionType } from "@/types";
import { getQuestionDisplayType } from "@/components/questions/question-preview-utils";

export const ALL_DIFFICULTIES = 0;

/** 「整个课程」伪知识点：章节配比里可以直接按整门课出题。 */
export const SMART_PRACTICE_WHOLE_COURSE_ID = "__whole_course__";

/**
 * 题型配比里允许出现的键：单选/多选按展示题型单独计数，
 * 其余沿用数据模型的粗粒度题型（判断/填空/简答/论述/编程）。
 */
export type SmartPracticeTypeKey = QuestionType | ChoiceDisplayType;

export type SmartPracticeKnowledgeOption = {
  id: string;
  name: string;
  path: string;
};

export type SmartPracticeChapterTarget = {
  knowledgePointId: string;
  /** 该章节的取题范围：节点本身 + 子知识点；缺省退化为只取该节点。 */
  scopeIds?: string[];
  /** 章节题量；缺省时表示只给比例（weight）。 */
  count?: number;
  /** 章节比例（权重），与其它章节一起归一化。 */
  weight?: number;
  /** 该章节内每种题型的题量（显式配比）。 */
  typeCounts?: Partial<Record<SmartPracticeTypeKey, number>>;
};

export type SmartPracticeTypeTarget = {
  type: SmartPracticeTypeKey;
  /** 该题型下每个章节的题量（显式配比）。 */
  chapterCounts: Array<{
    knowledgePointId: string;
    scopeIds?: string[];
    count: number;
  }>;
};

export type SmartPracticeTypeWeight = {
  type: SmartPracticeTypeKey;
  weight: number;
};

export type SmartPracticeIntent = {
  count: number;
  difficulty: number;
  /** 教师在「知识点」下拉里选中的那个节点。 */
  knowledgePointId: string | null;
  /**
   * 知识点取题范围：选中节点 + 其全部子知识点。
   * 缺省时退化为「只取 knowledgePointId 一个节点」。
   */
  knowledgePointIds?: string[];
  searchTerms: string[];
  typeDistribution?: Partial<Record<SmartPracticeTypeKey, number>>;
  requireAllTypes?: boolean;
  /** 按章节出题：count 表示该章节题量，weight 表示比例（二选一）。 */
  chapters?: SmartPracticeChapterTarget[];
  /** 题型比例：与 chapters 配合，决定每个章节内部怎么拆题型。 */
  typeWeights?: SmartPracticeTypeWeight[];
  /** 按题型出题：每个题型的题量再拆到各章节。 */
  typeGroups?: SmartPracticeTypeTarget[];
};

export type SmartPracticeChatIntent = {
  count: number;
  difficulty: number;
  knowledgePointId: string | null;
  typeDistribution?: Partial<Record<SmartPracticeTypeKey, number>>;
  requireAllTypes?: boolean;
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

const COUNT_UNIT_PATTERN = "(?:道|题|到题)";
const QUESTION_TYPE_WORDS = "(?:单选|多选|选择|判断|填空|简答|论述|编程)\\s*题?";

const PROMPT_TYPE_PATTERNS: Array<[RegExp, SmartPracticeTypeKey]> = [
  [/(?:单选)题?/, "single_choice"],
  [/(?:多选)题?/, "multi_choice"],
  [/(?:选择)题?/, "choice"],
  [/判断题?/, "true_false"],
  [/填空题?/, "fill_in"],
  [/简答题?/, "short_answer"],
  [/论述题?/, "essay"],
  [/编程题?/, "code"],
];

function parsePromptTypeDistribution(
  prompt: string,
): Partial<Record<SmartPracticeTypeKey, number>> {
  const distribution: Partial<Record<SmartPracticeTypeKey, number>> = {};
  for (const [typePattern, questionType] of PROMPT_TYPE_PATTERNS) {
    const typeWord = typePattern.source;
    const countBeforeType = new RegExp(
      `(\\d{1,3})\\s*${COUNT_UNIT_PATTERN}\\s*${typeWord}`,
    ).exec(prompt);
    const countAfterType = new RegExp(
      `${typeWord}\\s*(\\d{1,3})\\s*${COUNT_UNIT_PATTERN}`,
    ).exec(prompt);
    const count = Number(countBeforeType?.[1] ?? countAfterType?.[1] ?? 0);
    if (count > 0) distribution[questionType] = count;
  }
  return distribution;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把总数按权重拆成整数（最大余数法）。 */
export function distributeByWeights(total: number, weights: number[]): number[] {
  const positive = weights.map((weight) => Math.max(0, weight));
  const sum = positive.reduce((acc, weight) => acc + weight, 0);
  if (total <= 0 || sum <= 0) return positive.map(() => 0);
  const raw = positive.map((weight) => (weight / sum) * total);
  const result = raw.map((value) => Math.floor(value));
  let remainder = total - result.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
  for (let cursor = 0; cursor < order.length && remainder > 0; cursor += 1) {
    result[order[cursor].index] += 1;
    remainder -= 1;
  }
  return result;
}

/** 解析「章节名10题」这种章节题量写法。 */
function parsePromptChapterCounts(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
): SmartPracticeChapterTarget[] {
  const targets: SmartPracticeChapterTarget[] = [];
  const seen = new Set<string>();
  for (const option of [...knowledgeOptions].sort(
    (left, right) => right.name.length - left.name.length,
  )) {
    if (seen.has(option.id)) continue;
    const pattern = new RegExp(
      `${escapeRegExp(option.name)}\\s*[:：]?\\s*(\\d{1,3})\\s*(?:道|题)(?!\\s*(?:单选|多选|选择|判断|填空|简答|论述|编程))`,
    );
    const match = pattern.exec(prompt);
    const count = Number(match?.[1] ?? 0);
    if (count > 0) {
      seen.add(option.id);
      targets.push({ knowledgePointId: option.id, count });
    }
  }
  return targets;
}

/** 解析「章节名50%」这种章节比例写法。 */
function parsePromptChapterWeights(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
): SmartPracticeChapterTarget[] {
  const targets: SmartPracticeChapterTarget[] = [];
  const seen = new Set<string>();
  for (const option of [...knowledgeOptions].sort(
    (left, right) => right.name.length - left.name.length,
  )) {
    if (seen.has(option.id)) continue;
    const pattern = new RegExp(
      `${escapeRegExp(option.name)}\\s*[:：]?\\s*(\\d{1,3})\\s*%`,
    );
    const match = pattern.exec(prompt);
    const weight = Number(match?.[1] ?? 0);
    if (weight > 0) {
      seen.add(option.id);
      targets.push({ knowledgePointId: option.id, weight });
    }
  }
  return targets;
}

/** 解析「单选题50%」这种题型比例写法。 */
function parsePromptTypeWeights(prompt: string): SmartPracticeTypeWeight[] {
  const weights: SmartPracticeTypeWeight[] = [];
  for (const [typePattern, type] of PROMPT_TYPE_PATTERNS) {
    const pattern = new RegExp(
      `(?:${typePattern.source})\\s*[:：]?\\s*(\\d{1,3})\\s*%`,
    );
    const match = pattern.exec(prompt);
    const weight = Number(match?.[1] ?? 0);
    if (weight > 0) weights.push({ type, weight });
  }
  return weights;
}

/**
 * Extract the requested practice size, preferring the number after an action
 * such as “选取/生成”. This avoids treating “当前 220 道题” as the target
 * when the teacher asks for “选取 60 道题”. “到题” is accepted as a tolerant
 * fallback for the common typo of “道题”.
 */
function extractRequestedCount(prompt: string): number | null {
  const actionMatch = [
    ...prompt.matchAll(
      new RegExp(
        `(?:选取|选择|生成|出|安排|设置|包含|需要|给我|做)\\s*(?:约|大约|共)?\\s*(\\d{1,3})\\s*${COUNT_UNIT_PATTERN}(?!\\s*${QUESTION_TYPE_WORDS})`,
        "g",
      ),
    ),
  ].at(-1);
  if (actionMatch?.[1]) return Number(actionMatch[1]);

  const countMatches = [
    ...prompt.matchAll(
      new RegExp(`(\\d{1,3})\\s*${COUNT_UNIT_PATTERN}(?!\\s*${QUESTION_TYPE_WORDS})`, "g"),
    ),
  ];
  const lastMatch = countMatches.at(-1);
  return lastMatch?.[1] ? Number(lastMatch[1]) : null;
}

function extractSearchTerms(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .replace(/[0-9]+\s*(?:道|题|到题)/g, " ")
        .split(/[\s，。；、：:（）()“”"'《》【】[\]—-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !STOP_WORDS.has(term)),
    ),
  ).slice(0, 8);
}

function findKnowledgeHits(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
): Array<{ option: SmartPracticeKnowledgeOption; index: number }> {
  const hits: Array<{ option: SmartPracticeKnowledgeOption; index: number }> = [];
  for (const option of [...knowledgeOptions].sort(
    (left, right) => right.name.length - left.name.length,
  )) {
    const index = prompt.indexOf(option.name);
    if (index < 0) continue;
    if (
      hits.some(
        (hit) =>
          index >= hit.index && index < hit.index + hit.option.name.length,
      )
    ) {
      continue;
    }
    hits.push({ option, index });
  }
  return hits.sort((left, right) => left.index - right.index);
}

/**
 * 解析「按章节分配：第一章10道（单选5道、多选2道…）；第二章…」。
 */
function parseChapterPlanPrompt(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
): SmartPracticeChapterTarget[] {
  const hits = findKnowledgeHits(prompt, [
    {
      id: SMART_PRACTICE_WHOLE_COURSE_ID,
      name: "整个课程",
      path: "整个课程",
    },
    ...knowledgeOptions,
  ]);
  const targets: SmartPracticeChapterTarget[] = [];
  hits.forEach((hit, index) => {
    const end = index + 1 < hits.length ? hits[index + 1].index : prompt.length;
    const segment = prompt.slice(hit.index + hit.option.name.length, end);
    const total = Number(segment.match(/(\d{1,3})\s*(?:道|题)/)?.[1] ?? 0);
    if (total <= 0) return;
    const typeCounts: Partial<Record<SmartPracticeTypeKey, number>> = {};
    for (const [typePattern, type] of PROMPT_TYPE_PATTERNS) {
      const match = new RegExp(
        `(?:${typePattern.source})\\s*(\\d{1,3})\\s*(?:道|题)`,
      ).exec(segment);
      const count = Number(match?.[1] ?? 0);
      if (count > 0) typeCounts[type] = count;
    }
    targets.push({
      knowledgePointId: hit.option.id,
      count: total,
      typeCounts: Object.keys(typeCounts).length > 0 ? typeCounts : undefined,
    });
  });
  return targets;
}

/**
 * 解析「按题型分配：单选题10道（第一章3道、第二章5道）；判断题…」。
 */
function parseTypePlanPrompt(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
): SmartPracticeTypeTarget[] {
  const hits: Array<{ type: SmartPracticeTypeKey; index: number; word: string }> = [];
  for (const [typePattern, type] of PROMPT_TYPE_PATTERNS) {
    const match = new RegExp(typePattern.source).exec(prompt);
    if (!match || match.index === undefined) continue;
    hits.push({ type, index: match.index, word: match[0] });
  }
  hits.sort((left, right) => left.index - right.index);
  const targets: SmartPracticeTypeTarget[] = [];
  hits.forEach((hit, index) => {
    const end = index + 1 < hits.length ? hits[index + 1].index : prompt.length;
    const segment = prompt.slice(hit.index + hit.word.length, end);
    const total = Number(segment.match(/(\d{1,3})\s*(?:道|题)/)?.[1] ?? 0);
    if (total <= 0) return;
    const chapterCounts: SmartPracticeTypeTarget["chapterCounts"] = [];
    for (const option of [
      {
        id: SMART_PRACTICE_WHOLE_COURSE_ID,
        name: "整个课程",
        path: "整个课程",
      },
      ...knowledgeOptions,
    ].sort((left, right) => right.name.length - left.name.length)) {
      const match = new RegExp(
        `${escapeRegExp(option.name)}\\s*(\\d{1,3})\\s*(?:道|题)`,
      ).exec(segment);
      const count = Number(match?.[1] ?? 0);
      if (count > 0) {
        chapterCounts.push({ knowledgePointId: option.id, count });
      }
    }
    targets.push({ type: hit.type, chapterCounts });
  });
  return targets;
}

export function parseSmartPracticePrompt(
  prompt: string,
  knowledgeOptions: SmartPracticeKnowledgeOption[],
  defaults: Omit<SmartPracticeIntent, "searchTerms">,
): SmartPracticeIntent {
  const typeDistribution = parsePromptTypeDistribution(prompt);
  const typeCount = Object.values(typeDistribution).reduce(
    (total, count) => total + (count ?? 0),
    0,
  );
  // 按题型给数量时（“单选10道、多选5道…”），总数取各题型之和；
  // 避免把最后一个题型数量误当成整份练习的题量。
  const explicitCount = extractRequestedCount(prompt);
  const chapterCounts = parsePromptChapterCounts(prompt, knowledgeOptions);
  const chapterWeights =
    chapterCounts.length > 0
      ? []
      : parsePromptChapterWeights(prompt, knowledgeOptions);
  const typeWeights = parsePromptTypeWeights(prompt);
  const chapterTotal = chapterCounts.reduce(
    (total, chapter) => total + (chapter.count ?? 0),
    0,
  );
  const parsedCount =
    chapterCounts.length > 0
      ? Math.max(chapterTotal, explicitCount ?? 0)
      : typeCount > 0
        ? Math.max(typeCount, explicitCount ?? 0)
        : (explicitCount ?? defaults.count);
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

  const chapterPlan = /按章节分配/.test(prompt)
    ? parseChapterPlanPrompt(prompt, knowledgeOptions)
    : [];
  const typePlan = /按题型分配/.test(prompt)
    ? parseTypePlanPrompt(prompt, knowledgeOptions)
    : [];

  if (chapterPlan.length > 0) {
    return {
      count: Math.max(
        1,
        Math.min(
          200,
          chapterPlan.reduce((total, chapter) => total + (chapter.count ?? 0), 0),
        ),
      ),
      difficulty,
      knowledgePointId: null,
      searchTerms: extractSearchTerms(prompt),
      chapters: chapterPlan,
      // 兼容「章节题量 + 题型比例」的旧写法。
      typeWeights: typeWeights.length > 0 ? typeWeights : undefined,
      requireAllTypes: /(?:各种|所有|各类)题型|题型都/.test(prompt),
    };
  }
  if (typePlan.length > 0 && typePlan.some((group) => group.chapterCounts.length > 0)) {
    return {
      count: Math.max(
        1,
        Math.min(
          200,
          typePlan.reduce(
            (total, group) =>
              total +
              group.chapterCounts.reduce(
                (sum, chapter) => sum + chapter.count,
                0,
              ),
            0,
          ),
        ),
      ),
      difficulty,
      knowledgePointId: null,
      searchTerms: extractSearchTerms(prompt),
      typeGroups: typePlan,
      requireAllTypes: /(?:各种|所有|各类)题型|题型都/.test(prompt),
    };
  }

  const chapters =
    chapterCounts.length > 0
      ? chapterCounts
      : chapterWeights.length > 0
        ? chapterWeights
        : undefined;

  return {
    count: Math.max(1, Math.min(200, parsedCount)),
    difficulty,
    knowledgePointId: chapters
      ? null
      : (matchedKnowledge?.id ?? defaults.knowledgePointId),
    searchTerms: extractSearchTerms(prompt),
    typeDistribution: typeCount > 0 ? typeDistribution : undefined,
    chapters,
    typeWeights: typeWeights.length > 0 ? typeWeights : undefined,
    requireAllTypes: /(?:各种|所有|各类)题型|题型都/.test(prompt),
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
  const requestedCount = extractRequestedCount(promptWithoutOrdinalQuestions);
  const relativeDecrease = prompt.match(
    /(?:减少|少|删掉|去掉)\s*(\d{1,2})\s*(?:道|题)?/,
  );
  const relativeIncrease = prompt.match(
    /(?:增加|新增|多|再加|加上)\s*(\d{1,2})\s*(?:道|题)?/,
  );

  let count = requestedCount ?? previous.count;
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
    count: Math.max(1, Math.min(200, count)),
    difficulty,
    knowledgePointId: parsed.knowledgePointId,
    typeDistribution:
      Object.values(parsed.typeDistribution ?? {}).reduce(
        (total, item) => total + (item ?? 0),
        0,
      ) === count
        ? parsed.typeDistribution
        : previous.typeDistribution,
    requireAllTypes: parsed.requireAllTypes || previous.requireAllTypes,
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
 * 选中一个知识点时，取题范围是该节点本身加它的所有子知识点。
 *
 * 选项的 `path` 是「根 / 子 / 孙」拼接出来的完整路径（见 detail.tsx 的
 * `flattenCourseKnowledgeNodes`），所以「是不是后代」可以直接用路径前缀判断，
 * 不必再额外传入课程知识树。与后端题目列表筛选（`_course_subtree_cte` 递归子树）
 * 保持同一口径。
 */
export function collectKnowledgeScopeIds(
  knowledgePointId: string | null,
  options: SmartPracticeKnowledgeOption[],
): string[] {
  if (!knowledgePointId) return [];
  const selected = options.find((option) => option.id === knowledgePointId);
  if (!selected) return [knowledgePointId];

  const descendantPrefix = `${selected.path} / `;
  return [
    selected.id,
    ...options
      .filter(
        (option) =>
          option.id !== selected.id &&
          option.path.startsWith(descendantPrefix),
      )
      .map((option) => option.id),
  ];
}

function matchesPracticeType(
  question: IQuestion,
  type: SmartPracticeTypeKey,
): boolean {
  if (type === "single_choice" || type === "multi_choice") {
    return getQuestionDisplayType(question) === type;
  }
  return question.type === type;
}

type ScoredQuestion = {
  question: IQuestion;
  relevance: number;
  tieBreaker: number;
};

function pickQuestions(
  pool: ScoredQuestion[],
  count: number,
  pickedIds: Set<string>,
  type: SmartPracticeTypeKey | null,
): IQuestion[] {
  const result: IQuestion[] = [];
  for (const item of pool) {
    if (result.length >= count) break;
    if (pickedIds.has(item.question.id)) continue;
    if (type && !matchesPracticeType(item.question, type)) continue;
    pickedIds.add(item.question.id);
    result.push(item.question);
  }
  return result;
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
  // 按章节出题：章节可以给题量（count）或比例（weight）。
  const chapterTargets = (intent.chapters ?? [])
    .filter(
      (chapter) =>
        (chapter.count ?? 0) > 0 ||
        (chapter.weight ?? 0) > 0 ||
        Object.values(chapter.typeCounts ?? {}).some((count) => (count ?? 0) > 0),
    )
    .map((chapter) => ({
      scopeIds: new Set(
        chapter.scopeIds !== undefined
          ? chapter.scopeIds
          : [chapter.knowledgePointId],
      ),
      count: chapter.count,
      weight: chapter.weight,
      typeCounts: chapter.typeCounts,
    }));
  // 有章节没限定范围（例如未加载知识树时的「整个课程」）时，不压缩整体候选池。
  const chapterScope =
    chapterTargets.length > 0 &&
    !chapterTargets.some((chapter) => chapter.scopeIds.size === 0)
      ? new Set(chapterTargets.flatMap((chapter) => [...chapter.scopeIds]))
      : null;

  const scopeIds =
    chapterScope ??
    (intent.knowledgePointIds && intent.knowledgePointIds.length > 0
      ? new Set(intent.knowledgePointIds)
      : intent.knowledgePointId
        ? new Set([intent.knowledgePointId])
        : null);
  const eligible = source.filter((question) => {
    const matchesKnowledge =
      !scopeIds ||
      question.knowledge_points.some((point) => scopeIds.has(point.id));
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

  // 按题型出题：每个题型的题量再拆到具体章节（显式题量）。
  if (intent.typeGroups && intent.typeGroups.length > 0) {
    const picked: IQuestion[] = [];
    const pickedIds = new Set<string>();
    for (const group of intent.typeGroups) {
      for (const chapterCount of group.chapterCounts) {
        if (chapterCount.count <= 0) continue;
        const scope = new Set(
          chapterCount.scopeIds !== undefined
            ? chapterCount.scopeIds
            : [chapterCount.knowledgePointId],
        );
        const pool =
          scope.size === 0
            ? scored
            : scored.filter((item) =>
                item.question.knowledge_points.some((point) =>
                  scope.has(point.id),
                ),
              );
        picked.push(
          ...pickQuestions(pool, chapterCount.count, pickedIds, group.type),
        );
      }
    }
    return intent.count > 0 ? picked.slice(0, intent.count) : picked;
  }

  if (chapterTargets.length > 0) {
    const typeWeights = (intent.typeWeights ?? []).filter(
      (weight) => weight.weight > 0,
    );
    const poolFor = (chapter: (typeof chapterTargets)[number]) =>
      chapter.scopeIds.size === 0
        ? scored
        : scored.filter((item) =>
            item.question.knowledge_points.some((point) =>
              chapter.scopeIds.has(point.id),
            ),
          );
    const picked: IQuestion[] = [];
    const pickedIds = new Set<string>();
    const chapterExplicitTotal = (chapter: (typeof chapterTargets)[number]) =>
      Object.values(chapter.typeCounts ?? {}).reduce(
        (sum, count) => sum + Math.max(0, count ?? 0),
        0,
      );
    const hasChapterCounts = chapterTargets.some(
      (chapter) => (chapter.count ?? 0) > 0 || chapterExplicitTotal(chapter) > 0,
    );

    // 题型题量固定、章节按比例：把每个题型的题量按章节比例拆开。
    if (intent.typeDistribution && !hasChapterCounts) {
      for (const [type, requested] of Object.entries(
        intent.typeDistribution,
      ) as Array<[SmartPracticeTypeKey, number | undefined]>) {
        const count = Math.max(0, requested ?? 0);
        if (count === 0) continue;
        const perChapter = distributeByWeights(
          count,
          chapterTargets.map((chapter) => chapter.weight ?? 0),
        );
        chapterTargets.forEach((chapter, index) => {
          const need = perChapter[index] ?? 0;
          if (need === 0) return;
          picked.push(
            ...pickQuestions(poolFor(chapter), need, pickedIds, type),
          );
        });
      }
      return picked.slice(0, intent.count);
    }

    // 章节题量（或总题数 × 章节比例）固定，再按题型比例拆到题型。
    const chapterTotals = hasChapterCounts
      ? chapterTargets.map((chapter) =>
          (chapter.count ?? 0) > 0
            ? Math.max(0, chapter.count ?? 0)
            : chapterExplicitTotal(chapter),
        )
      : distributeByWeights(
          intent.count,
          chapterTargets.map((chapter) => chapter.weight ?? 0),
        );
    chapterTargets.forEach((chapter, index) => {
      const chapterTotal = chapterTotals[index] ?? 0;
      if (chapterTotal === 0) return;
      const pool = poolFor(chapter);
      const explicitCounts = chapter.typeCounts ?? {};
      const hasExplicitCounts = Object.values(explicitCounts).some(
        (count) => (count ?? 0) > 0,
      );
      if (hasExplicitCounts) {
        for (const [type, requested] of Object.entries(explicitCounts) as Array<
          [SmartPracticeTypeKey, number | undefined]
        >) {
          const need = Math.max(0, Math.floor(requested ?? 0));
          if (need === 0) continue;
          picked.push(...pickQuestions(pool, need, pickedIds, type));
        }
        return;
      }
      if (typeWeights.length > 0) {
        const perType = distributeByWeights(
          chapterTotal,
          typeWeights.map((weight) => weight.weight),
        );
        typeWeights.forEach((weight, typeIndex) => {
          const need = perType[typeIndex] ?? 0;
          if (need === 0) return;
          picked.push(
            ...pickQuestions(pool, need, pickedIds, weight.type),
          );
        });
        return;
      }
      picked.push(...pickQuestions(pool, chapterTotal, pickedIds, null));
    });
    return picked.slice(0, intent.count);
  }

  const buckets = new Map<QuestionType, IQuestion[]>();
  // 单选/多选在数据模型里同属 choice，配置里却分开计数，额外按展示题型分桶。
  const displayBuckets = new Map<ChoiceDisplayType, IQuestion[]>();
  for (const item of scored) {
    const type = questionTypeGroup(item.question);
    const bucket = buckets.get(type) ?? [];
    bucket.push(item.question);
    buckets.set(type, bucket);

    const displayType = getQuestionDisplayType(item.question);
    if (displayType === "single_choice" || displayType === "multi_choice") {
      const displayBucket = displayBuckets.get(displayType) ?? [];
      displayBucket.push(item.question);
      displayBuckets.set(displayType, displayBucket);
    }
  }

  const picked: IQuestion[] = [];
  if (intent.typeDistribution) {
    const pickedIds = new Set<string>();
    for (const [type, requested] of Object.entries(intent.typeDistribution) as Array<
      [SmartPracticeTypeKey, number | undefined]
    >) {
      const count = Math.max(0, requested ?? 0);
      if (count === 0) continue;
      const pool =
        type === "single_choice" || type === "multi_choice"
          ? (displayBuckets.get(type) ?? [])
          : (buckets.get(type as QuestionType) ?? []);
      let taken = 0;
      for (const question of pool) {
        if (taken >= count) break;
        if (pickedIds.has(question.id)) continue;
        pickedIds.add(question.id);
        picked.push(question);
        taken += 1;
      }
    }
    return picked.slice(0, intent.count);
  }

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
