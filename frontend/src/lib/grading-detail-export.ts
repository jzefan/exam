import {
  apiRequest,
  type GradingDetailExportQuestion,
  type GradingDetailExportResponse,
} from "@/pages/grading/api";

export type GradingDetailExportFormat = "xlsx" | "html";

type SpreadsheetCell = string | number | boolean | null | undefined;

interface ExportSheet {
  name: string;
  rows: SpreadsheetCell[][];
  widths: number[];
}

const TERM_LABELS: Record<string, string> = {
  dimensions: "评分维度",
  dimension: "评分维度",
  key: "指标",
  weight: "权重",
  score: "得分",
  max_score: "满分",
  point: "评分要点",
  points: "评分要点",
  rule: "规则",
  rules: "规则",
  summary: "参考说明",
  analysis: "解析",
  answer: "答案",
  correct: "正确答案",
  evidence: "评分依据",
  knowledge_points: "知识点",
  coverage: "要点覆盖度",
  correctness: "正确性",
  equivalent: "答案等价性",
  test_correctness: "测试正确性",
  functional_completeness: "功能完整度",
  edge_cases: "边界与异常处理",
  code_quality: "代码质量",
  answer_point_coverage: "要点覆盖",
  argument_accuracy: "观点准确性",
  argument_depth: "论证深度",
  structure_expression: "结构与表达",
  accuracy: "准确性",
  logic_completeness: "逻辑完整性",
  expression_quality: "表达规范性",
  source: "来源",
  version: "版本",
  label: "名称",
  criteria: "评分说明",
  reference_code: "参考代码",
  reference_answer: "参考答案",
  sample_answer: "示例答案",
  system_default: "系统默认",
  execution_env: "执行环境",
  test_summary: "测试汇总",
  compile_result: "编译结果",
  runtime_result: "运行结果",
  runtime_logs: "运行日志",
  resource_limit_summary: "资源限制",
  passed: "通过",
  failed: "未通过",
  total: "总数",
  stdout: "标准输出",
  stderr: "错误输出",
  exit_code: "退出码",
};

function translateTerm(value: string): string {
  return TERM_LABELS[value] ?? value;
}

function safeSpreadsheetText(value: SpreadsheetCell): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStructuredText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function referenceAnswerValue(value: unknown): { value: unknown; key?: string } {
  const parsed = parseStructuredText(value);
  if (!isRecord(parsed)) return { value: parsed };
  for (const key of ["reference_code", "reference_answer", "sample_answer", "code", "answer", "correct", "text", "content", "summary"]) {
    if (parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== "") {
      return { value: parsed[key], key };
    }
  }
  return { value: parsed };
}

function humanReadableText(value: unknown, depth = 0): string {
  const parsed = parseStructuredText(value);
  if (parsed === null || parsed === undefined || parsed === "") return "";
  if (typeof parsed === "boolean") return parsed ? "是" : "否";
  if (typeof parsed === "number") return formatNumber(parsed);
  if (typeof parsed === "string") return parsed;
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => `${index + 1}. ${humanReadableText(item, depth + 1)}`).join("\n");
  }
  return Object.entries(parsed)
    .map(([key, item]) => {
      const text = humanReadableText(item, depth + 1);
      const separator = isRecord(item) || Array.isArray(item) ? "\n" : "";
      const indent = separator ? text.split("\n").map((line) => `  ${line}`).join("\n") : text;
      return `${translateTerm(key)}：${separator}${indent}`;
    })
    .join("\n");
}

function referenceAnswerText(value: unknown): string {
  return safeSpreadsheetText(humanReadableText(referenceAnswerValue(value).value));
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function joinItems(items: string[]): string {
  return safeSpreadsheetText(items.filter(Boolean).join("；"));
}

function dimensionMaxScore(question: GradingDetailExportQuestion, dimension: string): number | "" {
  const rubricDimension = rubricDimensions(question.rubric_definition).find((item) => {
    if (!isRecord(item)) return false;
    const key = item.key ?? item["指标"];
    return String(key ?? "") === dimension;
  });
  if (isRecord(rubricDimension)) {
    const explicitMax = rubricDimension.max_score ?? rubricDimension["满分"];
    if (typeof explicitMax === "number" && Number.isFinite(explicitMax)) {
      return Math.round(explicitMax * 100) / 100;
    }
    const rubricWeight = rubricDimension.weight ?? rubricDimension["权重"];
    if (typeof rubricWeight === "number" && Number.isFinite(rubricWeight)) {
      return Math.round(question.max_score * rubricWeight * 100) / 100;
    }
  }
  const weight = question.dimension_weights[dimension];
  return typeof weight === "number" && Number.isFinite(weight)
    ? Math.round(question.max_score * weight * 100) / 100
    : "";
}

function detailRows(payload: GradingDetailExportResponse): SpreadsheetCell[][] {
  return [
    ["题号", "题型", "考生姓名", "学号/账号", "作答内容", "编程语言", "自定义输入", "得分", "满分", "客观题判定", "批改状态", "得分来源", "人工调分原因", "批改模型", "提示词版本", "评分依据", "执行证据", "数据提示", "自动反馈", "教师评语"],
    ...payload.students.flatMap((student) => student.answers.map((answer) => [
      answer.question_label,
      answer.question_type_label,
      safeSpreadsheetText(student.candidate_name),
      safeSpreadsheetText(student.candidate_code),
      safeSpreadsheetText(answer.answer_text),
      safeSpreadsheetText(answer.programming_language),
      safeSpreadsheetText(answer.custom_input),
      answer.score_awarded,
      answer.max_score,
      isSubjectiveQuestion(answer) || answer.is_correct === null ? "" : answer.is_correct ? "正确" : "错误",
      safeSpreadsheetText(answer.grading_status),
      safeSpreadsheetText(answer.score_source),
      safeSpreadsheetText(answer.manual_score_reason),
      safeSpreadsheetText(answer.model_label),
      safeSpreadsheetText(answer.prompt_template_version),
      safeSpreadsheetText(humanReadableText(answer.scoring_evidence)),
      safeSpreadsheetText(humanReadableText(answer.execution_evidence)),
      joinItems(answer.answer_quality_flags),
      safeSpreadsheetText(answer.feedback_text),
      safeSpreadsheetText(answer.teacher_comment || student.teacher_comment),
    ])),
  ];
}

function dimensionRows(payload: GradingDetailExportResponse): SpreadsheetCell[][] {
  const questionsById = new Map(payload.questions.map((question) => [question.question_id, question]));
  const rows: SpreadsheetCell[][] = [["题号", "考生姓名", "学号/账号", "评分维度", "维度得分", "维度满分", "维度评语", "维度合计", "题目最终分", "差额", "得分来源", "人工调分原因"]];
  for (const student of payload.students) {
    for (const answer of student.answers) {
      const question = questionsById.get(answer.question_id);
      const dimensionTotal = Object.values(answer.dimension_scores).reduce((sum, score) => sum + score, 0);
      const difference = typeof answer.score_awarded === "number"
        ? Math.round((answer.score_awarded - dimensionTotal) * 100) / 100
        : "";
      for (const [dimension, score] of Object.entries(answer.dimension_scores)) {
        rows.push([
          answer.question_label,
          safeSpreadsheetText(student.candidate_name),
          safeSpreadsheetText(student.candidate_code),
          safeSpreadsheetText(translateTerm(dimension)),
          score,
          question ? dimensionMaxScore(question, dimension) : "",
          safeSpreadsheetText(answer.dimension_comments[dimension]),
          dimensionTotal,
          answer.score_awarded,
          difference,
          safeSpreadsheetText(answer.score_source),
          safeSpreadsheetText(answer.manual_score_reason),
        ]);
      }
    }
  }
  return rows;
}

function calculatedStudentTotal(student: DetailStudent): number | null {
  const scores = student.answers
    .map((answer) => answer.score_awarded)
    .filter((score): score is number => typeof score === "number");
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) * 100) / 100 : null;
}

function studentScoreRows(payload: GradingDetailExportResponse): SpreadsheetCell[][] {
  const groups = groupQuestions(payload.questions);
  const maximum = payload.questions.reduce((sum, question) => sum + question.max_score, 0);
  return [
    ["姓名", "学号", "提交时间", "状态", "账号标记", ...groups.map((group) => `${group.label}得分`), "总分", "试卷总分"],
    ...payload.students.map((student) => {
      const calculated = calculatedStudentTotal(student);
      return [
        safeSpreadsheetText(student.candidate_name),
        safeSpreadsheetText(student.candidate_code),
        formatDateTime(student.submitted_at),
        studentExportStatus(student),
        joinItems(student.account_flags),
        ...groups.map((group) => studentScoreForGroup(student, group)),
        calculated,
        maximum,
      ];
    }),
  ];
}

function feedbackRows(payload: GradingDetailExportResponse): SpreadsheetCell[][] {
  return [
    ["考生姓名", "学号/账号", "题号", "优点", "扣分说明", "改进建议", "风险提示", "教师评语"],
    ...payload.students.flatMap((student) => student.answers
      .filter((answer) => answer.strengths.length > 0 || answer.deduction_reasons.length > 0 || answer.improvement_suggestions.length > 0 || answer.risk_flags.length > 0 || Boolean(answer.teacher_comment || student.teacher_comment))
      .map((answer) => [
        safeSpreadsheetText(student.candidate_name),
        safeSpreadsheetText(student.candidate_code),
        answer.question_label,
        joinItems(answer.strengths),
        joinItems(answer.deduction_reasons),
        joinItems(answer.improvement_suggestions),
        joinItems(answer.risk_flags),
        safeSpreadsheetText(answer.teacher_comment || student.teacher_comment),
      ])),
  ];
}

export function buildGradingDetailExportSheets(payload: GradingDetailExportResponse): ExportSheet[] {
  return [
    {
      name: "考试概览",
      widths: [18, 82],
      rows: [
        ["项目", "内容"],
        ["考试名称", safeSpreadsheetText(payload.exam_label)],
        ["导出时间", formatDateTime(payload.generated_at)],
        ["已提交考生", payload.students.length],
        ["题目数量", payload.questions.length],
        ["说明", "本文件包括评分标准、逐题答题与批改、维度得分分析及个性化反馈。"],
        ["隐私提示", "请仅在课程教学与成绩管理场景中使用，并妥善保管。"],
      ],
    },
    {
      name: "评分标准",
      widths: [10, 12, 38, 10, 42, 38, 36, 36, 24, 36, 36],
      rows: [
        ["题号", "题型", "题目", "满分", "参考答案", "解析", "评分量表", "评分要点", "维度权重", "扣分规则", "致命错误规则"],
        ...payload.questions.map((question) => [
          question.question_label,
          question.question_type_label,
          safeSpreadsheetText(question.question_content),
          question.max_score,
          referenceAnswerText(question.standard_answer),
          safeSpreadsheetText(question.analysis),
          safeSpreadsheetText(humanReadableText(question.rubric_definition)),
          safeSpreadsheetText(humanReadableText(question.scoring_points)),
          safeSpreadsheetText(humanReadableText(question.dimension_weights)),
          safeSpreadsheetText(humanReadableText(question.deduction_rules)),
          safeSpreadsheetText(humanReadableText(question.fatal_error_rules)),
        ]),
      ],
    },
    { name: "学生分数表", widths: [16, 16, 22, 12, 16, ...groupQuestions(payload.questions).map(() => 16), 14, 14], rows: studentScoreRows(payload) },
    { name: "逐题答题与批改", widths: [10, 12, 16, 16, 48, 14, 24, 10, 10, 12, 14, 14, 28, 18, 20, 40, 42, 36, 42, 34], rows: detailRows(payload) },
    { name: "维度得分分析", widths: [10, 16, 16, 22, 12, 12, 42, 12, 12, 12, 14, 30], rows: dimensionRows(payload) },
    { name: "个性化反馈", widths: [16, 16, 10, 34, 42, 42, 30, 36], rows: feedbackRows(payload) },
  ];
}

function spreadsheetRowHeight(row: SpreadsheetCell[], widths: number[], header = false): number {
  if (header) return 24;
  const lines = row.reduce<number>((highest, cell, index) => {
    const text = String(cell ?? "");
    const width = Math.max(8, widths[index] ?? 18);
    const visualLines = text.split("\n").reduce<number>((count, line) => {
      const visualLength = [...line].reduce<number>((length, char) => length + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0);
      return count + Math.max(1, Math.ceil(visualLength / width));
    }, 0);
    return Math.max(highest, visualLines);
  }, 1);
  return Math.min(96, Math.max(22, lines * 17 + 5));
}

function appendSheet(
  XLSX: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  sheet: ExportSheet,
) {
  const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
  worksheet["!cols"] = sheet.widths.map((wch) => ({ wch }));
  worksheet["!rows"] = sheet.rows.map((row, index) => ({ hpt: spreadsheetRowHeight(row, sheet.widths, index === 0) }));
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: sheet.widths.length - 1, r: Math.max(0, sheet.rows.length - 1) } }) };

  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sheet.widths.length; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address] as (import("xlsx").CellObject & { s?: Record<string, unknown> }) | undefined;
      if (!cell) continue;
      cell.s = {
        font: { name: "Microsoft YaHei", sz: rowIndex === 0 ? 11 : 10, bold: rowIndex === 0, color: { rgb: rowIndex === 0 ? "FFFFFF" : "1F2937" } },
        fill: { fgColor: { rgb: rowIndex === 0 ? "1D4ED8" : rowIndex % 2 === 0 ? "F8FAFC" : "FFFFFF" } },
        alignment: { vertical: "top", wrapText: true },
        border: { bottom: { style: "thin", color: { rgb: "DCE5F3" } } },
      };
    }
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
}

function escapeHtml(value: SpreadsheetCell): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LONG_CELL_PREVIEW_LENGTH = 140;

function htmlWithBreaks(value: SpreadsheetCell): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function renderHtmlCell(value: SpreadsheetCell): string {
  const text = String(value ?? "");
  if (!text.trim()) return '<td class="is-empty">—</td>';
  const lineCount = text.split("\n").length;
  if (text.length <= LONG_CELL_PREVIEW_LENGTH && lineCount <= 3) {
    return `<td><div class="cell-text">${htmlWithBreaks(value)}</div></td>`;
  }

  const preview = text.replace(/\s+/g, " ").trim();
  const previewText = preview.length > LONG_CELL_PREVIEW_LENGTH
    ? `${preview.slice(0, LONG_CELL_PREVIEW_LENGTH)}…`
    : preview;
  return `<td class="has-long-content"><details class="cell-details"><summary><span class="cell-preview">${escapeHtml(previewText)}</span><span class="expand-label">查看全文</span></summary><div class="cell-full">${htmlWithBreaks(value)}</div></details></td>`;
}

function renderHtmlDataTable(
  header: SpreadsheetCell[],
  body: SpreadsheetCell[][],
  widths: number[],
): string {
  const columns = widths
    .map((width) => `<col style="width:${Math.min(32, Math.max(8, Math.round(width * 0.72)))}ch">`)
    .join("");
  return `<div class="table-wrap"><table><colgroup>${columns}</colgroup><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${header.map((_, columnIndex) => renderHtmlCell(row[columnIndex])).join("")}</tr>`).join("")}</tbody></table></div>`;
}

type DetailQuestion = GradingDetailExportResponse["questions"][number];
type DetailStudent = GradingDetailExportResponse["students"][number];
type DetailAnswer = DetailStudent["answers"][number];

interface QuestionTypeGroup {
  key: string;
  label: string;
  order: number;
  questions: DetailQuestion[];
}

const QUESTION_TYPE_ORDER: Record<string, number> = {
  true_false: 0,
  single_choice: 1,
  multi_choice: 2,
  fill_in: 3,
  essay: 4,
  code: 5,
};

function questionTypeGroup(question: DetailQuestion): Omit<QuestionTypeGroup, "questions"> {
  if (question.question_type === "choice") {
    const key = question.question_type_label.includes("多") ? "multi_choice" : "single_choice";
    return { key, label: key === "multi_choice" ? "多选题" : "单选题", order: QUESTION_TYPE_ORDER[key] };
  }
  if (question.question_type === "short_answer" || question.question_type === "essay") {
    return { key: "essay", label: "论述题", order: QUESTION_TYPE_ORDER.essay };
  }
  const labels: Record<string, string> = {
    true_false: "判断题",
    fill_in: "填空题",
    code: "编程题",
  };
  return {
    key: question.question_type,
    label: labels[question.question_type] ?? question.question_type_label,
    order: QUESTION_TYPE_ORDER[question.question_type] ?? 99,
  };
}

function groupQuestions(questions: DetailQuestion[]): QuestionTypeGroup[] {
  const groups = new Map<string, QuestionTypeGroup>();
  for (const question of [...questions].sort((left, right) => left.order - right.order)) {
    const type = questionTypeGroup(question);
    const group = groups.get(type.key) ?? { ...type, questions: [] };
    group.questions.push(question);
    groups.set(type.key, group);
  }
  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function isSubjectiveQuestion(question: Pick<DetailQuestion, "question_type">): boolean {
  return ["short_answer", "essay", "code"].includes(question.question_type);
}

function safeAnchorPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-") || "item";
}

function questionAnchor(question: DetailQuestion): string {
  return `question-${safeAnchorPart(question.question_id)}`;
}

function answersForQuestion(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): Array<{ student: DetailStudent; answer: DetailAnswer }> {
  return payload.students.flatMap((student) => {
    const answer = student.answers.find((item) => item.question_id === question.question_id);
    return answer ? [{ student, answer }] : [];
  });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function renderExpandableText(value: SpreadsheetCell, emptyText = "暂无"): string {
  const text = String(value ?? "").trim();
  if (!text) return `<span class="empty-text">${escapeHtml(emptyText)}</span>`;
  if (text.length <= LONG_CELL_PREVIEW_LENGTH && text.split("\n").length <= 3) {
    return `<div class="content-text">${htmlWithBreaks(text)}</div>`;
  }
  const preview = text.replace(/\s+/g, " ").slice(0, LONG_CELL_PREVIEW_LENGTH);
  return `<details class="text-details"><summary><span>${escapeHtml(preview)}…</span><b>查看全文</b></summary><div class="text-full">${htmlWithBreaks(text)}</div></details>`;
}

function renderHumanReadableValue(value: unknown, key?: string): string {
  const parsed = parseStructuredText(value);
  if (parsed === null || parsed === undefined || parsed === "") {
    return '<span class="empty-text">暂无</span>';
  }
  if (typeof parsed === "boolean") return `<span>${parsed ? "是" : "否"}</span>`;
  if (typeof parsed === "number") {
    return `<span>${key === "weight" ? formatPercent(parsed) : formatNumber(parsed)}</span>`;
  }
  if (typeof parsed === "string") {
    if (key?.includes("code")) {
      return `<pre class="reference-code"><code>${escapeHtml(parsed)}</code></pre>`;
    }
    return renderExpandableText(key === "source" ? translateTerm(parsed) : parsed);
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return '<span class="empty-text">暂无</span>';
    return `<ol class="readable-list">${parsed.map((item) => `<li>${renderHumanReadableValue(item)}</li>`).join("")}</ol>`;
  }
  return `<dl class="structured-fields">${Object.entries(parsed).map(([field, item]) => `<div><dt>${escapeHtml(translateTerm(field))}</dt><dd>${renderHumanReadableValue(item, field)}</dd></div>`).join("")}</dl>`;
}

function renderReferenceAnswer(value: unknown): string {
  const reference = referenceAnswerValue(value);
  const text = typeof reference.value === "string" ? reference.value : "";
  const looksLikeCode = /(?:CREATE|SELECT|INSERT|UPDATE|DELETE|USE|function|class|def|#include)\b|[{};]\s*(?:\n|$)/i.test(text);
  return renderHumanReadableValue(
    reference.value,
    reference.key ?? (looksLikeCode ? "reference_code" : undefined),
  );
}

function rubricDimensions(value: unknown): unknown[] {
  const parsed = parseStructuredText(value);
  if (!isRecord(parsed)) return [];
  const dimensions = parsed.dimensions ?? parsed["评分维度"];
  return Array.isArray(dimensions) ? dimensions : [];
}

function renderRubricDimension(value: unknown, index: number): string {
  const dimension = isRecord(value) ? value : {};
  const rawKey = String(dimension.key ?? dimension["指标"] ?? "");
  const title = String(
    dimension.label
      ?? dimension["名称"]
      ?? (rawKey ? translateTerm(rawKey) : `评分维度 ${index + 1}`),
  );
  const weight = dimension.weight ?? dimension["权重"];
  const maxScore = dimension.max_score ?? dimension["满分"];
  const criteria = dimension.criteria ?? dimension["评分说明"];
  const ignored = new Set(["key", "指标", "label", "名称", "weight", "权重", "max_score", "满分", "criteria", "评分说明"]);
  const extraFields = Object.entries(dimension).filter(([key]) => !ignored.has(key));
  return `<article class="rubric-dimension"><header><strong>${escapeHtml(title)}</strong><div>${typeof weight === "number" ? `<span>权重 ${formatPercent(weight)}</span>` : ""}${typeof maxScore === "number" ? `<span>满分 ${formatNumber(maxScore)} 分</span>` : ""}</div></header>${criteria ? `<p>${htmlWithBreaks(String(criteria))}</p>` : ""}${extraFields.length ? `<dl class="structured-fields compact">${extraFields.map(([key, item]) => `<div><dt>${escapeHtml(translateTerm(key))}</dt><dd>${renderHumanReadableValue(item, key)}</dd></div>`).join("")}</dl>` : ""}</article>`;
}

function renderRubricDefinition(value: unknown): string {
  const parsed = parseStructuredText(value);
  const dimensions = rubricDimensions(parsed);
  if (!isRecord(parsed)) return renderHumanReadableValue(parsed);
  const metadata = Object.entries(parsed).filter(([key]) => !["dimensions", "评分维度"].includes(key));
  return `${metadata.length ? `<dl class="rubric-meta">${metadata.map(([key, item]) => `<div><dt>${escapeHtml(translateTerm(key))}</dt><dd>${renderHumanReadableValue(item, key)}</dd></div>`).join("")}</dl>` : ""}${dimensions.length ? `<div class="rubric-dimensions">${dimensions.map(renderRubricDimension).join("")}</div>` : metadata.length ? "" : '<p class="empty-panel">暂无评分量表。</p>'}`;
}

function renderRubricBlock(title: string, value: unknown, content?: string): string {
  const parsed = parseStructuredText(value);
  const empty = parsed === null || parsed === undefined || parsed === ""
    || (Array.isArray(parsed) && parsed.length === 0)
    || (isRecord(parsed) && Object.keys(parsed).length === 0);
  if (empty) return "";
  return `<div class="rubric-block"><h5>${escapeHtml(title)}</h5>${content ?? renderHumanReadableValue(parsed)}</div>`;
}

function renderQuestionOverview(question: DetailQuestion): string {
  return `<div class="question-overview"><div><span class="field-label">题目</span>${renderExpandableText(question.question_content)}</div><div><span class="field-label">参考答案</span>${renderReferenceAnswer(question.standard_answer)}</div>${question.analysis ? `<div><span class="field-label">解析</span>${renderExpandableText(question.analysis)}</div>` : ""}</div>`;
}

function renderScoringStandard(question: DetailQuestion): string {
  const anchor = `${questionAnchor(question)}-rubric`;
  const blocks = [
    renderRubricBlock("评分量表", question.rubric_definition, renderRubricDefinition(question.rubric_definition)),
    renderRubricBlock("评分要点", question.scoring_points),
    renderRubricBlock("维度权重", question.dimension_weights),
    renderRubricBlock("扣分规则", question.deduction_rules),
    renderRubricBlock("致命错误规则", question.fatal_error_rules),
  ].join("");
  return `<section id="${anchor}" class="question-detail"><h4>评分标准</h4><div class="rubric-layout">${blocks || '<p class="empty-panel">暂无评分标准。</p>'}</div></section>`;
}

function renderDimensionAnalysis(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  const entries = answersForQuestion(payload, question);
  const dimensions = new Set<string>(Object.keys(question.dimension_weights));
  entries.forEach(({ answer }) => Object.keys(answer.dimension_scores).forEach((dimension) => dimensions.add(dimension)));
  const rows = [...dimensions].map((dimension) => {
    const scores = entries
      .map(({ answer }) => answer.dimension_scores[dimension])
      .filter((score): score is number => typeof score === "number");
    const comments = entries
      .map(({ student, answer }) => answer.dimension_comments[dimension]
        ? `${student.candidate_name}：${answer.dimension_comments[dimension]}`
        : "")
      .filter(Boolean);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    const weight = question.dimension_weights[dimension];
    return [
      translateTerm(dimension),
      typeof weight === "number" ? formatPercent(weight) : "",
      average === null ? "" : formatNumber(average),
      dimensionMaxScore(question, dimension),
      scores.length,
      comments.join("\n"),
    ];
  });
  const detailRows = entries.flatMap(({ student, answer }) => {
    const dimensionTotal = Object.values(answer.dimension_scores).reduce((sum, score) => sum + score, 0);
    const difference = typeof answer.score_awarded === "number"
      ? Math.round((answer.score_awarded - dimensionTotal) * 100) / 100
      : null;
    return Object.entries(answer.dimension_scores).map(([dimension, score]) => [
      student.candidate_name,
      student.candidate_code,
      translateTerm(dimension),
      score,
      dimensionMaxScore(question, dimension),
      answer.dimension_comments[dimension],
      dimensionTotal,
      answer.score_awarded,
      difference,
      answer.score_source,
      answer.manual_score_reason,
    ]);
  });
  return `<section id="${questionAnchor(question)}-dimensions" class="question-detail"><h4>维度分析</h4><h5 class="table-subtitle">总体统计</h5>${rows.length ? renderHtmlDataTable(
    ["评分维度", "权重", "平均得分", "维度满分", "已评分人数", "维度评语"],
    rows,
    [20, 10, 12, 12, 12, 48],
  ) : '<p class="empty-panel">暂无维度评分数据。</p>'}<h5 class="table-subtitle detail-subtitle">逐人明细</h5>${detailRows.length ? renderHtmlDataTable(
    ["考生", "学号/账号", "评分维度", "维度得分", "维度满分", "维度评语", "维度合计", "题目最终分", "差额", "得分来源", "人工调分原因"],
    detailRows,
    [15, 15, 18, 10, 10, 34, 11, 11, 10, 14, 28],
  ) : '<p class="empty-panel">暂无逐人维度明细。</p>'}</section>`;
}

function renderExecutionEvidence(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  if (question.question_type !== "code") return "";
  const rows = answersForQuestion(payload, question).map(({ student, answer }) => [
    student.candidate_name,
    student.candidate_code,
    answer.programming_language,
    answer.custom_input,
    Object.keys(answer.execution_evidence).length
      ? humanReadableText(answer.execution_evidence)
      : "未记录可复现的编译、运行或测试证据",
    Object.keys(answer.scoring_evidence).length ? humanReadableText(answer.scoring_evidence) : "",
    answer.model_label,
    answer.prompt_template_version,
    answer.role_binding_version === null ? "" : answer.role_binding_version,
    answer.score_source,
    joinItems(answer.answer_quality_flags),
  ]);
  return `<section id="${questionAnchor(question)}-evidence" class="question-detail"><h4>执行与评分证据</h4>${rows.length ? renderHtmlDataTable(
    ["考生", "学号/账号", "编程语言", "自定义输入", "执行证据", "评分依据", "批改模型", "提示词版本", "角色版本", "得分来源", "数据提示"],
    rows,
    [15, 15, 12, 20, 42, 36, 18, 20, 10, 14, 32],
  ) : '<p class="empty-panel">暂无编程题作答。</p>'}</section>`;
}

function renderPersonalizedFeedback(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  const rows = answersForQuestion(payload, question)
    .filter(({ student, answer }) => Boolean(
      answer.strengths.length
      || answer.deduction_reasons.length
      || answer.improvement_suggestions.length
      || answer.risk_flags.length
      || answer.feedback_text
      || answer.teacher_comment
      || student.teacher_comment,
    ))
    .map(({ student, answer }) => [
      student.candidate_name,
      student.candidate_code,
      joinItems(answer.strengths),
      joinItems(answer.deduction_reasons),
      joinItems(answer.improvement_suggestions),
      joinItems(answer.risk_flags),
      answer.feedback_text,
      answer.teacher_comment || student.teacher_comment,
    ]);
  return `<section id="${questionAnchor(question)}-feedback" class="question-detail"><h4>个性化反馈</h4>${rows.length ? renderHtmlDataTable(
    ["考生", "学号/账号", "优点", "扣分说明", "改进建议", "风险提示", "自动反馈", "教师评语"],
    rows,
    [16, 16, 30, 34, 34, 24, 36, 34],
  ) : '<p class="empty-panel">暂无个性化反馈。</p>'}</section>`;
}

function renderCandidateAnswers(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  const subjective = isSubjectiveQuestion(question);
  const rows = answersForQuestion(payload, question).map(({ student, answer }) => [
    student.candidate_name,
    student.candidate_code,
    answer.answer_text,
    answer.score_awarded,
    answer.max_score,
    ...(subjective ? [] : [answer.is_correct === null ? "" : answer.is_correct ? "正确" : "错误"]),
    answer.grading_status,
    answer.score_source,
  ]);
  return `<section id="${questionAnchor(question)}-answers" class="question-detail"><h4>考生答案与分数</h4>${rows.length ? renderHtmlDataTable(
    ["考生", "学号/账号", "答案", "得分", "满分", ...(subjective ? [] : ["判定"]), "批改状态", "得分来源"],
    rows,
    [16, 16, 54, 10, 10, ...(subjective ? [] : [12]), 14, 14],
  ) : '<p class="empty-panel">暂无考生作答。</p>'}</section>`;
}

function topInsights(items: string[], limit = 3): Array<{ text: string; count: number }> {
  const counts = new Map<string, number>();
  items.map((item) => item.trim()).filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function renderInsightList(title: string, insights: Array<{ text: string; count: number }>): string {
  if (!insights.length) return "";
  return `<div class="insight-column"><h5>${escapeHtml(title)}</h5><ul>${insights.map((item) => `<li>${escapeHtml(item.text)}<span>${item.count} 人</span></li>`).join("")}</ul></div>`;
}

function renderQuestionSummary(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  const entries = answersForQuestion(payload, question);
  const answered = entries.filter(({ answer }) => answer.answer_text.trim());
  const scored = entries.filter(({ answer }) => typeof answer.score_awarded === "number");
  const scores = scored.map(({ answer }) => answer.score_awarded as number);
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  const highest = scores.length ? Math.max(...scores) : null;
  const lowest = scores.length ? Math.min(...scores) : null;
  const judged = entries.filter(({ answer }) => answer.is_correct !== null);
  const correct = judged.filter(({ answer }) => answer.is_correct).length;
  const subjective = isSubjectiveQuestion(question);
  const metrics = [
    ["作答人数", `${answered.length}/${entries.length}`],
    ["已评分人数", `${scored.length}/${entries.length}`],
    ["平均分", average === null ? "—" : `${formatNumber(average)}/${formatNumber(question.max_score)}`],
    ["平均得分率", average === null || question.max_score <= 0 ? "—" : formatPercent(average / question.max_score)],
    ["最高分", highest === null ? "—" : formatNumber(highest)],
    ["最低分", lowest === null ? "—" : formatNumber(lowest)],
    ...(subjective || !judged.length ? [] : [["正确率", formatPercent(correct / judged.length)]]),
  ];
  const insightColumns = subjective ? [
    renderInsightList("主要优点", topInsights(entries.flatMap(({ answer }) => answer.strengths))),
    renderInsightList("常见扣分原因", topInsights(entries.flatMap(({ answer }) => answer.deduction_reasons))),
    renderInsightList("共性改进建议", topInsights(entries.flatMap(({ answer }) => answer.improvement_suggestions))),
  ].join("") : "";
  return `<section id="${questionAnchor(question)}-summary" class="question-detail summary-panel"><h4>所有考生总结分析</h4><dl class="summary-metrics">${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${insightColumns ? `<div class="insight-grid">${insightColumns}</div>` : '<p class="summary-note">当前数据仅提供统计汇总；暂无可归纳的结构化反馈。</p>'}</section>`;
}

function renderQuestion(
  payload: GradingDetailExportResponse,
  question: DetailQuestion,
): string {
  const subjective = isSubjectiveQuestion(question);
  return `<article id="${questionAnchor(question)}" class="question-block"><header class="question-heading"><div><span class="question-kicker">${escapeHtml(question.question_type_label)}</span><h3>${escapeHtml(question.question_label)}</h3></div><span class="score-badge">满分 ${formatNumber(question.max_score)} 分</span></header>${renderQuestionOverview(question)}${subjective ? renderScoringStandard(question) + renderDimensionAnalysis(payload, question) + renderExecutionEvidence(payload, question) + renderPersonalizedFeedback(payload, question) : ""}${renderCandidateAnswers(payload, question)}${renderQuestionSummary(payload, question)}</article>`;
}

function renderTypeGroup(
  payload: GradingDetailExportResponse,
  group: QuestionTypeGroup,
  index: number,
): string {
  const totalScore = group.questions.reduce((sum, question) => sum + question.max_score, 0);
  return `<section id="type-${safeAnchorPart(group.key)}" class="type-section"><header class="type-heading"><span>题型 ${String(index + 1).padStart(2, "0")}</span><div><h2>${escapeHtml(group.label)}</h2><p>${group.questions.length} 道题 · 共 ${formatNumber(totalScore)} 分</p></div></header>${group.questions.map((question) => renderQuestion(payload, question)).join("")}</section>`;
}

function renderHtmlToc(groups: QuestionTypeGroup[]): string {
  const typeTree = groups.map((group) => `<li><details class="toc-type-group" open><summary class="toc-type"><span class="toc-type-name">${escapeHtml(group.label)}</span><span class="toc-count">${group.questions.length}</span></summary><ol>${group.questions.map((question, questionIndex) => {
    const anchor = questionAnchor(question);
    const subjectiveItems = isSubjectiveQuestion(question)
      ? `<li><a href="#${anchor}-rubric">评分标准</a></li><li><a href="#${anchor}-dimensions">维度分析</a></li>${question.question_type === "code" ? `<li><a href="#${anchor}-evidence">执行与评分证据</a></li>` : ""}<li><a href="#${anchor}-feedback">个性化反馈</a></li>`
      : "";
    return `<li><a class="toc-question" href="#${anchor}">第 ${questionIndex + 1} 题</a><ol class="toc-details">${subjectiveItems}<li><a href="#${anchor}-answers">考生答案与分数</a></li><li><a href="#${anchor}-summary">所有考生总结分析</a></li></ol></li>`;
  }).join("")}</ol></details></li>`).join("");
  return `<aside class="toc" aria-label="报告目录"><div class="toc-brand">阅卷报告</div><div class="toc-title">内容目录</div><nav><a class="toc-overview" href="#exam-overview">考试概览</a><a class="toc-overview" href="#student-score-table">学生分数表</a><div class="toc-root">题型</div><ol class="toc-tree">${typeTree}</ol></nav><p>长文本默认收起；点击“查看全文”可展开。</p></aside>`;
}

function renderExamOverview(payload: GradingDetailExportResponse, groups: QuestionTypeGroup[]): string {
  const totalScore = payload.questions.reduce((sum, question) => sum + question.max_score, 0);
  const suspectedAccounts = payload.students.filter((student) => student.account_flags.length > 0).length;
  const manualAnswers = payload.students.flatMap((student) => student.answers)
    .filter((answer) => answer.score_source === "人工调整").length;
  const codeAnswers = payload.students.flatMap((student) => student.answers)
    .filter((answer) => answer.question_type === "code" && answer.answer_text.trim());
  const codeWithoutEvidence = codeAnswers.filter((answer) => Object.keys(answer.execution_evidence).length === 0).length;
  const notes = [
    "报告总分按逐题最终分实时重算。",
    ...(manualAnswers ? [`人工调分 ${manualAnswers} 份；机器维度分与最终分分开保留，并展示差额。`] : []),
    ...(suspectedAccounts ? [`检测到 ${suspectedAccounts} 个疑似测试账号，已标记但未自动剔除。`] : []),
    ...(codeWithoutEvidence ? [`${codeWithoutEvidence} 份编程题作答缺少可复现的编译、运行或测试证据。`] : []),
    "报告包含姓名、学号等个人信息，请仅用于授权的教学与成绩管理场景。",
  ];
  return `<section id="exam-overview" class="overview-section"><div class="section-heading"><span class="section-number">01</span><h2>考试概览</h2></div><dl class="overview-list"><div><dt>考试名称</dt><dd>${escapeHtml(payload.exam_label)}</dd></div><div><dt>导出时间</dt><dd>${escapeHtml(formatDateTime(payload.generated_at))}</dd></div><div><dt>考生人数</dt><dd>${payload.students.length}</dd></div><div><dt>题目数量</dt><dd>${payload.questions.length}</dd></div><div><dt>试卷总分</dt><dd>${formatNumber(totalScore)}</dd></div><div><dt>题型分布</dt><dd>${groups.map((group) => `${escapeHtml(group.label)} ${group.questions.length} 题`).join(" · ") || "暂无题目"}</dd></div></dl><div class="quality-note"><strong>数据口径与质量提示</strong><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div></section>`;
}

function studentExportStatus(student: DetailStudent): string {
  if (!student.submitted_at) return "未提交";
  const statuses = student.answers.map((answer) => answer.grading_status).filter(Boolean);
  if (statuses.some((status) => status.includes("待"))) return "待批改";
  if (statuses.some((status) => status.includes("中") || status.includes("进行"))) return "批改中";
  return statuses.length ? "已完成" : "已提交";
}

function studentScoreForGroup(student: DetailStudent, group: QuestionTypeGroup): string {
  const questionIds = new Set(group.questions.map((question) => question.question_id));
  const answers = student.answers.filter((answer) => questionIds.has(answer.question_id));
  const scores = answers
    .map((answer) => answer.score_awarded)
    .filter((score): score is number => typeof score === "number");
  if (!scores.length) return "—";
  const earned = scores.reduce((sum, score) => sum + score, 0);
  const maximum = group.questions.reduce((sum, question) => sum + question.max_score, 0);
  return `${formatNumber(earned)} / ${formatNumber(maximum)}`;
}

function renderStudentScoreTable(payload: GradingDetailExportResponse, groups: QuestionTypeGroup[]): string {
  const maximum = payload.questions.reduce((sum, question) => sum + question.max_score, 0);
  const hasAccountFlags = payload.students.some((student) => student.account_flags.length > 0);
  const header = ["姓名", "学号", "提交时间", "状态", ...(hasAccountFlags ? ["账号标记"] : []), ...groups.map((group) => `${group.label}得分`), "总分"];
  const rows = payload.students.map((student) => {
    const total = calculatedStudentTotal(student);
    return [
      student.candidate_name,
      student.candidate_code ?? "",
      formatDateTime(student.submitted_at),
      studentExportStatus(student),
      ...(hasAccountFlags ? [joinItems(student.account_flags)] : []),
      ...groups.map((group) => studentScoreForGroup(student, group)),
      total === null ? "—" : `${formatNumber(total)} / ${formatNumber(maximum)}`,
    ];
  });
  const widths = [16, 16, 22, 12, ...(hasAccountFlags ? [16] : []), ...groups.map(() => 15), 15];
  return `<section id="student-score-table" class="overview-section score-table-section"><div class="section-heading"><span class="section-number">02</span><div><h2>学生分数表</h2><p>按题型汇总每位考生的得分</p></div></div>${rows.length ? renderHtmlDataTable(header, rows, widths) : '<p class="empty-panel">暂无已提交考生。</p>'}</section>`;
}

export function buildGradingDetailExportHtml(payload: GradingDetailExportResponse): string {
  const groups = groupQuestions(payload.questions);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(payload.exam_label)}｜答题与批改明细</title><style>
:root{color-scheme:light;--ink:#17223a;--muted:#62708a;--paper:#fbfcfe;--canvas:#eef2f7;--line:#dce4ee;--navy:#17355e;--blue:#315a91;--blue-pale:#edf3fa;--accent:#bc864d}*{box-sizing:border-box;scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.55 "PingFang SC","Microsoft YaHei",sans-serif}.report-shell{max-width:1680px;margin:0 auto;padding:clamp(16px,3vw,40px);display:grid;grid-template-columns:260px minmax(0,1fr);gap:clamp(22px,3vw,48px);align-items:start}.toc{position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto;padding:10px 8px 12px 0;border-top:3px solid var(--accent)}.toc-brand{margin-top:14px;color:var(--blue);font-size:11px;font-weight:800;letter-spacing:.16em}.toc-title{margin:4px 0 14px;font:700 22px/1.25 "Songti SC","STSong",serif;letter-spacing:.03em}.toc a{color:var(--ink);text-decoration:none}.toc-overview,.toc-root{display:block;padding:7px 8px;font-weight:800}.toc-overview:hover,.toc a:hover{color:var(--blue)}.toc-root{margin-top:4px;color:var(--muted);font-size:12px;letter-spacing:.08em}.toc ol{margin:0;padding:0;list-style:none}.toc-tree>li{margin:3px 0 8px}.toc-type-group{margin:0}.toc-type{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:7px;padding:7px 8px;border-left:2px solid var(--accent);cursor:pointer;font-weight:800;list-style:none;transition:color .16s ease,background-color .16s ease}.toc-type::-webkit-details-marker{display:none}.toc-type::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s ease}.toc-type-group[open]>.toc-type::before{transform:rotate(45deg)}.toc-type:hover{background:var(--blue-pale);color:var(--blue)}.toc-type:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.toc-count{color:var(--muted);font-size:11px}.toc-type-group>ol{margin:3px 0 0 10px;border-left:1px solid var(--line)}.toc-question{display:block;padding:5px 9px;font-size:13px;font-weight:700}.toc-details{margin:0 0 6px 13px!important;border-left:0!important}.toc-details a{display:block;padding:3px 8px;color:var(--muted);font-size:12px;line-height:1.35}.toc p{margin:18px 8px 0;color:var(--muted);font-size:12px;line-height:1.65}.report-main{min-width:0}.hero{padding:30px 34px;background:var(--navy);color:#f8f4ec;border-bottom:5px solid var(--accent)}.hero-eyebrow{margin-bottom:8px;color:#f0cda3;font-size:11px;font-weight:800;letter-spacing:.14em}.hero h1{max-width:900px;margin:0;font:700 28px/1.3 "Songti SC","STSong",serif;letter-spacing:.02em}.hero-meta{display:flex;flex-wrap:wrap;gap:7px 16px;margin:16px 0 0;color:#dbe6f6;font-size:13px}.hero-meta span+span{padding-left:16px;border-left:1px solid #9bb0ce}.overview-section,.type-section{margin-top:22px;scroll-margin-top:18px}.overview-section{border:1px solid var(--line);background:var(--paper)}.section-heading{display:flex;align-items:baseline;gap:12px;padding:17px 20px 14px;border-bottom:1px solid var(--line)}.section-heading p{margin:2px 0 0;color:var(--muted);font-size:12px}.section-number{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.12em}.section-heading h2,.type-heading h2{margin:0;font:700 21px/1.3 "Songti SC","STSong",serif}.overview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0}.overview-list>div{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px 18px;border-bottom:1px solid var(--line)}.overview-list>div:nth-child(odd){border-right:1px solid var(--line)}.overview-list dt{color:var(--muted)}.overview-list dd{margin:0;font-weight:700}.quality-note{margin:14px 18px 18px;padding:11px 13px;border-left:3px solid var(--accent);background:#f7f3ed;color:#4a3c2d}.quality-note strong{font-size:12px}.quality-note ul{margin:5px 0 0;padding-left:19px;color:#5d5145;font-size:12px}.quality-note li+li{margin-top:3px}.score-table-section .table-wrap{max-height:min(64vh,620px);border:0}.type-section{padding-top:8px}.type-heading{display:flex;align-items:flex-start;gap:14px;padding:12px 0 10px;border-bottom:2px solid var(--navy)}.type-heading>span{padding-top:5px;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.12em}.type-heading p{margin:2px 0 0;color:var(--muted);font-size:12px}.question-block{margin:18px 0 30px;padding:0 18px 20px;border:1px solid var(--line);background:var(--paper);scroll-margin-top:18px}.question-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 -18px;padding:14px 18px;border-bottom:1px solid var(--line);background:#f5f8fc}.question-kicker{display:block;color:var(--blue);font-size:11px;font-weight:800}.question-heading h3{margin:2px 0 0;font:700 19px/1.25 "Songti SC","STSong",serif}.score-badge{flex:none;color:var(--navy);font-size:12px;font-weight:800}.question-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;border-bottom:1px solid var(--line)}.question-overview>div{min-width:0;padding:14px 0}.question-overview>div:nth-child(odd){padding-right:18px;border-right:1px solid var(--line)}.question-overview>div:nth-child(even){padding-left:18px}.question-overview>div:last-child:nth-child(odd){grid-column:1/-1;border-right:0}.field-label{display:block;margin-bottom:5px;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.06em}.content-text{white-space:pre-wrap}.empty-text{color:#9ba7b7}.reference-code{max-height:240px;margin:0;overflow:auto;padding:12px 14px;border:1px solid #cad6e5;border-radius:6px;background:#101827;color:#e8eef8;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap}.structured-fields{display:grid;gap:8px;margin:0}.structured-fields>div{display:grid;grid-template-columns:minmax(90px,140px) minmax(0,1fr);gap:12px;align-items:start}.structured-fields dt{color:var(--muted);font-size:12px;font-weight:700}.structured-fields dd{min-width:0;margin:0}.structured-fields.compact{margin-top:10px;padding-top:9px;border-top:1px dashed var(--line)}.readable-list{display:grid;gap:7px;margin:0;padding-left:22px}.readable-list>li{padding-left:3px}.text-details summary{display:flex;gap:9px;cursor:pointer;list-style:none}.text-details summary::-webkit-details-marker{display:none}.text-details summary span{display:-webkit-box;flex:1;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.text-details summary b{flex:none;color:var(--blue);font-size:12px}.text-details[open] summary{display:none}.text-full{white-space:pre-wrap}.question-detail{padding-top:17px;scroll-margin-top:18px}.question-detail h4{margin:0 0 9px;font-size:14px}.table-subtitle{margin:0 0 7px;color:var(--muted);font-size:12px}.detail-subtitle{margin-top:13px}.rubric-layout{display:grid;gap:10px}.rubric-block{padding:12px 14px;border:1px solid var(--line);background:#fff}.rubric-block>h5{margin:0 0 10px;color:var(--navy);font-size:12px}.rubric-meta{display:flex;flex-wrap:wrap;gap:7px 18px;margin:0 0 10px}.rubric-meta>div{display:flex;gap:5px;color:var(--muted);font-size:11px}.rubric-meta dt{font-weight:800}.rubric-meta dd{margin:0}.rubric-meta .content-text{white-space:normal}.rubric-dimensions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.rubric-dimension{padding:11px 12px;border-left:3px solid var(--accent);background:var(--blue-pale)}.rubric-dimension header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.rubric-dimension header>div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px}.rubric-dimension header span{padding:2px 6px;border:1px solid #c9d7e8;border-radius:999px;background:#fff;color:var(--blue);font-size:10px;font-weight:800;white-space:nowrap}.rubric-dimension p{margin:8px 0 0;color:#33425b;line-height:1.5}.table-wrap{max-height:min(58vh,560px);overflow:auto;border:1px solid var(--line)}.table-wrap::-webkit-scrollbar,.toc::-webkit-scrollbar,.reference-code::-webkit-scrollbar{width:9px;height:9px}.table-wrap::-webkit-scrollbar-thumb,.toc::-webkit-scrollbar-thumb,.reference-code::-webkit-scrollbar-thumb{background:#bac6d5;border:2px solid transparent;border-radius:9px;background-clip:padding-box}table{width:100%;min-width:760px;border-collapse:separate;border-spacing:0;table-layout:fixed}th,td{padding:8px 10px;text-align:left;vertical-align:top;border-right:1px solid var(--line);border-bottom:1px solid var(--line);word-break:break-word;line-height:1.4}th:last-child,td:last-child{border-right:0}th{position:sticky;top:0;z-index:1;background:var(--blue);color:#f8fbff;font-size:12px;font-weight:800}tbody tr:nth-child(even) td{background:#f5f8fc}tbody tr:hover td{background:#edf3fa}.cell-text{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3}.is-empty{color:#9ba7b7;text-align:center}.has-long-content{padding:0}.cell-details summary{display:flex;align-items:flex-start;gap:8px;min-height:50px;padding:8px 10px;cursor:pointer;list-style:none}.cell-details summary::-webkit-details-marker{display:none}.cell-preview{display:-webkit-box;flex:1;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.expand-label{flex:none;color:var(--blue);font-size:12px;font-weight:700;white-space:nowrap}.cell-details[open] .expand-label{display:none}.cell-full{padding:0 10px 10px;border-top:1px dashed #cbd7e5;white-space:pre-wrap;color:#2c3950}.cell-details[open] summary{min-height:auto;background:#edf3fa}.cell-details:not([open]) .cell-full{display:none}.empty-panel{margin:0;padding:12px 14px;background:#f5f8fc;color:var(--muted)}.summary-panel{padding-bottom:2px}.summary-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin:0;border:1px solid var(--line)}.summary-metrics>div{padding:10px 12px;border-right:1px solid var(--line)}.summary-metrics dt{color:var(--muted);font-size:11px}.summary-metrics dd{margin:3px 0 0;color:var(--navy);font-size:17px;font-weight:800}.insight-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:13px}.insight-column h5{margin:0 0 7px;font-size:12px}.insight-column ul{margin:0;padding:0;list-style:none}.insight-column li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}.insight-column li span{flex:none;color:var(--muted);font-size:11px}.summary-note{margin:11px 0 0;color:var(--muted)}@media (max-width:980px){.report-shell{display:block;padding:16px}.toc{position:relative;top:auto;max-height:360px;margin:0 0 18px;padding:13px 15px;border:1px solid var(--line);border-top:3px solid var(--accent);background:var(--paper)}.hero{padding:24px}.overview-list,.question-overview,.insight-grid{grid-template-columns:1fr}.overview-list>div:nth-child(odd),.question-overview>div:nth-child(odd){padding-right:0;border-right:0}.question-overview>div:nth-child(even){padding-left:0}.hero-meta span+span{padding-left:0;border-left:0}}@media print{body{background:#fff;font-size:10px}.report-shell{display:block;max-width:none;padding:0}.toc{display:none}.hero{padding:18px 22px;border-bottom-width:3px}.hero h1{font-size:24px}.question-block{break-inside:avoid;margin-top:12px}.table-wrap,.reference-code{max-height:none;overflow:visible}table{min-width:0;font-size:9px}th{position:static}th,td{padding:5px 6px}.cell-text,.cell-preview{display:block;overflow:visible}.cell-details summary,.text-details summary{display:none}.cell-details .cell-full,.text-details .text-full{display:block!important;padding:5px 6px;border:0}.cell-details,.text-details{display:block}}
</style></head><body><div class="report-shell">${renderHtmlToc(groups)}<main class="report-main"><header class="hero"><div class="hero-eyebrow">逐题答题 · 批改明细</div><h1>${escapeHtml(payload.exam_label)}</h1><div class="hero-meta"><span>导出时间：${escapeHtml(formatDateTime(payload.generated_at))}</span><span>已提交考生：${payload.students.length}</span><span>题目数量：${payload.questions.length}</span></div></header>${renderExamOverview(payload, groups)}${renderStudentScoreTable(payload, groups)}${groups.map((group, index) => renderTypeGroup(payload, group, index)).join("")}</main></div></body></html>`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "考试";
}

function downloadHtml(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportExamGradingDetails(examId: string, format: GradingDetailExportFormat = "xlsx") {
  const payload = await apiRequest<GradingDetailExportResponse>(`/grading/export/exams/${examId}/details`);
  const fileBaseName = `${sanitizeFileName(payload.exam_label)}-答题与批改明细-${new Date().toISOString().slice(0, 10)}`;
  if (format === "html") {
    downloadHtml(buildGradingDetailExportHtml(payload), `${fileBaseName}.html`);
    return;
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  buildGradingDetailExportSheets(payload).forEach((sheet) => appendSheet(XLSX, workbook, sheet));
  XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
}
