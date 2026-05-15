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

export interface GradingQuestionCandidate {
  task_id: string;
  candidate_name: string;
  candidate_code: string | null;
  status: string;
  score: number | null;
  arbitration_required: boolean;
  manual_override: boolean;
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

export interface GradingCandidateModelComment {
  stage: "primary" | "review" | "arbiter";
  model_label: string;
  score: number;
  summary: string;
  process: string[];
  risk_flags: string[];
}

export interface GradingCandidateDetailResponse {
  task_id: string;
  candidate_name: string;
  candidate_code: string | null;
  status: string;
  evaluation_note?: string | null;
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

  return (await response.json()) as T;
}
