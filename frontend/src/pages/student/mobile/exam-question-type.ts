import type { IExamQuestionForStudent } from "@/types";
import {
  getQuestionDisplayType,
  questionDisplayTypeShortLabel,
} from "@/components/questions/question-preview-utils";
import { inferStudentAnswerLanguage } from "@/pages/student/utils";

/**
 * SQL 的短标签。SQL 在库里不是独立的 question_type（见下方说明），
 * 所以短标签表里没有它，在这里补一个。
 */
export const SQL_QUESTION_TYPE_LABEL = "SQL";

/**
 * 题型字符串本身就写明「多选」的情况（导入数据/历史数据里出现过 `multi_choice`、
 * `多选题`）。这类写法会被 `normalizeQuestionType` 归并成 `choice`，再靠
 * `content.multi` 区分单双选 —— 而导入数据往往没有这个字段，只看 content 会把
 * 多选题显示成单选，所以原始字符串先认一遍。
 */
const EXPLICIT_MULTI_CHOICE_TYPE = /多选|multiple_choice|multi_choice/i;

/**
 * 作答页题号行前面的题型名，**取短标签**（2 字）：
 * 单选 / 多选 / 判断 / 填空 / 简答 / 论述 / 编程 / SQL。
 *
 * 用短标签而非「单选题」这种全称，是因为这一行还要放题号、保存态、倒计时，
 * 375 宽下全称会把题号挤到截断。
 *
 * 两点跟题型枚举不完全对齐的地方：
 *
 * 1. **单选与多选**在库里都是 `choice`，靠 `content.multi`（或答案数组）区分，
 *    所以题库页那套 `getQuestionDisplayType` 判定直接复用。
 * 2. **SQL 不是独立的 question_type**。后端 `_VALID_QUESTION_TYPES` 只有
 *    `choice / true_false / fill_in / short_answer / essay / code`；SQL 题实际存成
 *    `short_answer`（题目要求写查询语句）或 `code`，语言信息落在题干/内容文本里。
 *    这里复用判分侧同一套 `inferStudentAnswerLanguage` 推断，避免出现两套口径 ——
 *    题号行说「简答」、判分却按 SQL 标准评分，是学生会直接看到的矛盾。
 */
export function getExamQuestionTypeLabel(question: IExamQuestionForStudent): string {
  const rawType = String(question.type ?? "").trim();
  const displayType = getQuestionDisplayType(question);

  // 题型字符串自带「多选」语义时优先认它。`multi_choice` 这类写法不在别名表里
  // （normalizeQuestionType 返回 null），而 `多选题` 会被归并成 choice 再靠
  // content.multi 判断 —— 两种情况下只看 content 都可能把多选题显示成单选。
  if (
    EXPLICIT_MULTI_CHOICE_TYPE.test(rawType) &&
    (displayType === "single_choice" || displayType === null)
  ) {
    return questionDisplayTypeShortLabel.multi_choice;
  }

  if (!displayType) {
    return "";
  }

  if (displayType === "code" || displayType === "short_answer") {
    const language = inferStudentAnswerLanguage(question.title, question.content, null);
    if (language === "sql") {
      return SQL_QUESTION_TYPE_LABEL;
    }
  }

  return questionDisplayTypeShortLabel[displayType];
}
