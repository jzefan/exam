import type { QuestionType } from "@/types";

export const questionTypeLabel: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

export function formatStudentDate(iso: string | null): string {
  if (!iso) return "待定";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function renderAnswerSummary(answer: Record<string, unknown>): string {
  if (!answer) return "未作答";

  if (typeof answer.code === "string" && answer.code.trim()) {
    const language = typeof answer.language === "string" ? answer.language : "代码";
    return `${language} · 已提交 ${answer.code.trim().split("\n").length} 行代码`;
  }

  if (typeof answer.html === "string" && answer.html.trim()) {
    return answer.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "未作答";
  }

  if (Array.isArray(answer.selected) && answer.selected.length > 0) {
    return answer.selected.join("、");
  }

  if (typeof answer.value === "boolean") {
    return answer.value ? "正确" : "错误";
  }

  if (Array.isArray(answer.blanks) && answer.blanks.length > 0) {
    return answer.blanks.map((item) => String(item)).join("；");
  }

  return "未作答";
}

export function renderStandardAnswer(answer: Record<string, unknown>): string {
  if (!answer) return "暂无";
  if (Array.isArray(answer.points) && answer.points.length > 0) {
    return answer.points.map((item) => String(item)).join("；");
  }
  if (Array.isArray(answer.required_patterns) && answer.required_patterns.length > 0) {
    return answer.required_patterns.map((item) => String(item)).join("；");
  }
  if (Array.isArray(answer.correct)) {
    return answer.correct.join("、");
  }
  if (typeof answer.correct === "string") {
    return answer.correct;
  }
  if (typeof answer.correct === "boolean") {
    return answer.correct ? "正确" : "错误";
  }
  if (Array.isArray(answer.blanks)) {
    return answer.blanks.map((item) => String(item)).join("；");
  }
  return "暂无";
}
