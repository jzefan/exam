// AI 评分维度英文键 → 中文展示名（与后端默认评分量规标签一致；未知键回退原文）。
// 用于阅卷中心与答卷详情页的「AI 评分详情」维度展示。
const DIMENSION_LABELS: Record<string, string> = {
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
};

export function dimensionLabel(name: string): string {
  return DIMENSION_LABELS[name] ?? name;
}
