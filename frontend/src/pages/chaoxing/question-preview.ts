import type { IQuestion, QuestionType } from "@/types";
import { normalizeQuestionType } from "@/components/questions/question-preview-utils";

/**
 * The fields both a freshly read answer sheet and a saved item expose. Only these
 * are needed to display a question, so one adapter serves 「查看答卷」 and
 * 「AI 评分」 instead of two hand-rolled layouts.
 */
export interface PreviewSource {
  id: string;
  question_type: string;
  content: string;
  reference_answer: string;
  max_score: number | null;
}

/**
 * Present a provider question through the question bank's own preview card.
 *
 * 学习通 ships plain text and no metadata, so the fields the card reads
 * are filled from what was actually read and everything else stays empty — a
 * question without difficulty or knowledge points must not look like it has them.
 * Pages render this with `hideMeta hideSourceBadge hideScoreAndDifficulty` and put
 * the full score in `trailing`, since the provider score is the real one.
 */
export function buildQuestionPreview(source: PreviewSource): IQuestion {
  const reference = source.reference_answer ?? "";
  const choice = /选择|单选|多选/.test(source.question_type ?? "");
  const lines = source.content.split(/\r?\n/);
  const optionLines = choice ? lines.map(line => /^\s*([A-H])[.．、:：)]\s*(.+?)\s*$/.exec(line)) : [];
  const firstOption = optionLines.findIndex(Boolean);
  const parsedOptions = firstOption >= 0 && optionLines.slice(firstOption).every(Boolean)
    ? optionLines.slice(firstOption) as RegExpExecArray[]
    : [];
  const options = parsedOptions.length >= 2
    ? Object.fromEntries(parsedOptions.map(match => [match[1], match[2]]))
    : null;
  const stem = options ? lines.slice(0, firstOption).join("\n").trim() : source.content;
  return {
    id: source.id,
    // 归一化失败时保留原始题型串：卡片会照原样显示，不会猜成某个题库题型。
    type: (normalizeQuestionType(source.question_type) ?? source.question_type) as QuestionType,
    title: stem,
    // `multi` 让 "多选题" 在卡片上显示为多选题而不是单选题。
    content: { text: stem, multi: /多选/.test(source.question_type ?? "") },
    options,
    // 参考答案在题库里是结构化字段；这里只有纯文本，两种写法都填上，
    // 使选择题/填空题/简答题/编程题的答案区都能落到同一段文字。
    answer: { text: reference, correct: reference },
    analysis: null,
    difficulty: 3,
    score: source.max_score ?? 0,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "",
    created_by_name: "",
    created_at: "",
    updated_at: "",
  };
}
