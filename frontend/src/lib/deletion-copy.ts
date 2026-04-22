export function getQuestionDeleteDescription() {
  return "确定要删除这道题目吗？题目会先进入回收状态；如果仍被考试或练习使用，或已有学生作答历史，将不会立即彻底删除。";
}

export function getExamDeleteDescription(targetLabel: string, title: string | undefined) {
  return `确定要删除${targetLabel}「${title ?? ""}」吗？若尚无学生作答记录，将被彻底删除；若已有考生提交，将仅归档隐藏并保留答卷历史。`;
}
