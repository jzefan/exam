export interface BackendTaskListItem {
  id: string;
  source_type: string;
  source_business_id: string | null;
  status: string;
  question_type: "short_answer" | "code";
  question_content: string;
  final_score: number | null;
  result_source: "manual" | "arbiter" | "average" | null;
  arbitration_required: boolean;
  manual_override: boolean;
  updated_at: string;
}

export interface GradingInboxQuestionItem {
  question_key: string;
  question_id: string;
  question_label: string;
  question_type: "short_answer" | "code";
  question_content: string;
  max_score: number;
  knowledge_tags: string[];
  pending_count: number;
  completed_count: number;
  candidate_count: number;
  latest_updated_at: string;
}

export interface GradingInboxExamGroup {
  exam_id: string | null;
  exam_label: string;
  exam_date: string;
  questions: GradingInboxQuestionItem[];
}

export interface GradingInboxResponse {
  exams: GradingInboxExamGroup[];
}

export interface GradingExportExam {
  exam_id: string;
  exam_label: string;
  exam_date: string;
  question_count: number;
  candidate_count: number;
}

export interface GradingExportExamListResponse {
  exams: GradingExportExam[];
}

export interface GradingQuestionCandidate {
  task_id: string;
  candidate_name: string;
  candidate_code: string | null;
  student_id: string | null;
  status: string;
  score: number | null;
  arbitration_required: boolean;
  manual_override: boolean;
  viewed: boolean;
}

export interface GradingQuestionDetailResponse {
  exam_id: string | null;
  exam_label: string;
  exam_date: string;
  question_key: string;
  question_id: string;
  question_label: string;
  question_type: "short_answer" | "code";
  question_content: string;
  max_score: number;
  knowledge_tags: string[];
  candidates: GradingQuestionCandidate[];
}

// 按考生阅卷：一名考生在某场考试下的「按题 task」单元（前端聚合，无新增后端接口）
export interface CandidateTaskCell {
  questionId: string;
  questionLabel: string;
  questionContent: string;
  questionType: "short_answer" | "code";
  maxScore: number;
  task: GradingQuestionCandidate; // 含 task_id / status / viewed / score
}

export interface CandidateGroup {
  candidateKey: string; // candidate_code ?? candidate_name
  candidateName: string;
  candidateCode: string | null;
  studentId: string | null; // 原始考生 UUID，用于整卷视图取数
  cells: CandidateTaskCell[];
  pendingCount: number;
  completedCount: number;
}

export interface GradingExportQuestion {
  question_id: string;
  question_label: string;
  question_type: "short_answer" | "code" | string;
  question_type_label: string;
  max_score: number;
}

export interface GradingExportStudentScore {
  candidate_name: string;
  candidate_code: string | null;
  objective_score: number;
  subjective_score: number;
  scores: Record<string, number | null>;
  type_totals: Record<string, number>;
  total_score: number;
}

export interface GradingExportScoreResponse {
  exam_id: string;
  exam_label: string;
  exam_date: string;
  questions: GradingExportQuestion[];
  students: GradingExportStudentScore[];
}

export interface GradingDetailExportQuestion {
  question_id: string;
  question_label: string;
  question_type: string;
  question_type_label: string;
  question_content: string;
  order: number;
  max_score: number;
  standard_answer: string;
  analysis: string;
  rubric_definition: Record<string, unknown>;
  scoring_points: unknown[];
  dimension_weights: Record<string, number>;
  deduction_rules: unknown[];
  fatal_error_rules: unknown[];
}

export interface GradingDetailExportAnswer {
  question_id: string;
  question_label: string;
  question_type: string;
  question_type_label: string;
  max_score: number;
  answer_text: string;
  score_awarded: number | null;
  is_correct: boolean | null;
  grading_status: string;
  dimension_scores: Record<string, number>;
  dimension_comments: Record<string, string>;
  deduction_reasons: string[];
  strengths: string[];
  improvement_suggestions: string[];
  risk_flags: string[];
  feedback_text: string;
  teacher_comment: string;
  score_source: string;
  manual_score_reason: string;
  programming_language: string;
  custom_input: string;
  model_label: string;
  prompt_template_version: string;
  role_binding_version: number | null;
  scoring_evidence: Record<string, unknown>;
  execution_evidence: Record<string, unknown>;
  answer_quality_flags: string[];
}

export interface GradingDetailExportStudent {
  student_id: string;
  candidate_name: string;
  candidate_code: string | null;
  submitted_at: string | null;
  objective_score: number | null;
  subjective_score: number | null;
  total_score: number | null;
  recorded_total_score: number | null;
  score_difference: number | null;
  score_consistent: boolean;
  account_flags: string[];
  teacher_comment: string;
  answers: GradingDetailExportAnswer[];
}

export interface GradingDetailExportResponse {
  exam_id: string;
  exam_label: string;
  generated_at: string;
  questions: GradingDetailExportQuestion[];
  students: GradingDetailExportStudent[];
}

export interface GradingCandidateModelComment {
  stage: "primary" | "review" | "arbiter";
  model_label: string;
  score: number;
  summary: string;
  process: string[];
  risk_flags: string[];
}

export interface GradingFeedbackDimension {
  name: string;
  score: number;
  max_score: number | null;
  comment: string;
}

// 汇总（终评 snapshot）结构化反馈，与答卷详情页一致
export interface GradingCandidateFeedback {
  dimensions: GradingFeedbackDimension[];
  strengths: string[];
  deductions: string[];
  suggestions: string[];
  risk_flags: string[];
  evidence_lines: string[];
}

export interface GradingCandidateDetailResponse {
  task_id: string;
  candidate_name: string;
  candidate_code: string | null;
  status: string;
  viewed: boolean;
  evaluation_note?: string | null;
  score_reuse?: {
    mode: string;
    similarity: number;
    source_task_id: string;
  } | null;
  suggested_score: number | null;
  max_score: number;
  question_type: "short_answer" | "code";
  student_answer_raw: string;
  attachment_refs: Array<{
    name: string;
    url: string;
  }>;
  knowledge_tags: string[];
  student_feedback?: string | null;
  teacher_feedback_reply?: string | null;
  feedback_created_at?: string | null;
  models: GradingCandidateModelComment[];
  follow_ups: Array<{
    prompt: string;
    models: GradingCandidateModelComment[];
  }>;
  feedback?: GradingCandidateFeedback | null;
}

export interface GradingPromptFollowUpModel {
  stage: "primary" | "review" | "arbiter";
  model_label: string;
  score: number;
  summary: string;
  process: string[];
  risk_flags: string[];
}

export interface GradingPromptFollowUpResponse {
  prompt: string;
  models: GradingPromptFollowUpModel[];
}

export interface GradingConfirmResponse {
  status: string;
  grading_status: "pending_ai" | "ai_scored" | "reviewed";
}

export interface ExamCandidateScore {
  candidate_key: string;
  objective_score: number | null;
  subjective_score: number | null;
  total_score: number | null;
}

export interface ExamCandidateScoresResponse {
  candidates: ExamCandidateScore[];
}

function getAuthHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败: ${response.status}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}
