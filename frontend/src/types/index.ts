import type { IUserOrgInfo } from "./rbac";

export type UserRole =
  | "platform_admin"
  | "enterprise_admin"
  | "enterprise_user"
  | "school_admin"
  | "teacher"
  | "evaluator"
  | "student"
  | "assessee";

export interface IUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
  persona: "teacher" | "assessor";
  primary_org: IUserOrgInfo | null;
  organizations: IUserOrgInfo[];
  system_domain: "platform" | "exam" | "job_model";
  owner_teacher_id: string | null;
  owner_teacher_name: string | null;
  teacher_ids: string[];
  teacher_names: string[];
  managed_student_count: number;
  created_at: string;
  updated_at: string;
}

export interface ILoginRequest {
  username: string;
  password: string;
}

export interface IRegisterRequest {
  username: string;
  email: string;
  password: string;
  full_name: string;
  persona?: "teacher" | "assessor";
  role?: UserRole;
}

export interface ITokenResponse {
  access_token: string;
  token_type: string;
  user: IUser;
  onboarding_reason?: "first_login" | "returning_after_week" | null;
}

export type QuestionType = "choice" | "true_false" | "fill_in" | "short_answer" | "essay" | "code";

export type QuestionSource = "manual" | "ai_generated" | "imported";
export type CodeLanguage = "python" | "javascript" | "java" | "cpp" | "c" | "go";

export interface ITag {
  id: string;
  name: string;
  type: "knowledge" | "subject" | "purpose" | "custom";
  question_count: number;
  created_at: string;
}

export interface IKnowledgePoint {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  owner_id?: string;
  visibility?: "private" | "platform";
  created_at: string;
  direction_id?: string | null;
  tags?: string[];
  difficulty?: string | null;
  question_count?: number;
}

export interface IQuestionBank {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  owner_username?: string | null;
  owner_full_name?: string | null;
  visibility: "private" | "platform";
  question_count: number;
  created_at: string;
}

export type ExamStatus = "draft" | "upcoming" | "ongoing" | "completed" | "closed";
export type ExamGradingStatus = "pending_ai" | "ai_scored" | "reviewed";
export type ExamCategory = "exam" | "practice";
export type PaperSourceType = "manual" | "import" | "ai_generated";

export interface IExam {
  id: string;
  category: ExamCategory;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  total_score: number;
  status: ExamStatus;
  position_id: string | null;
  position_name: string | null;
  max_switch_count: number;
  allow_retake: boolean;
  show_result: boolean;
  notes_template: string | null;
  course_kp_id: string | null;
  total_questions: number;
  total_students: number;
  submitted_count: number;
  has_student_history: boolean;
  has_gradable_questions?: boolean;
  knowledge_points: IKnowledgePoint[];
  participated?: boolean | null;
  started_at?: string | null;
  submitted_at?: string | null;
  score?: number | null;
  grading_status?: ExamGradingStatus | null;
  objective_score?: number | null;
  subjective_score?: number | null;
  ai_scored_at?: string | null;
  reviewed_at?: string | null;
  owner_id: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface IPaperQuestion {
  question_id: string;
  order: number;
  score_override: number | null;
  question: IQuestion | null;
}

export interface IPaperQuestionKnowledgeSuggestion {
  id: string;
  paper_id: string;
  question_id: string;
  suggested_name: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface IPaper {
  id: string;
  title: string;
  description: string | null;
  source_type: PaperSourceType;
  source_paper_id: string | null;
  root_knowledge_point_id: string | null;
  root_knowledge_point: IKnowledgePoint | null;
  is_reusable: boolean;
  archived_at: string | null;
  question_count: number;
  total_score: number;
  owner_id: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface IPaperDetail extends IPaper {
  questions: IPaperQuestion[];
  knowledge_suggestions?: IPaperQuestionKnowledgeSuggestion[];
}

export interface IPaperImportImageInput {
  image_id: string;
  url: string;
  order: number;
  page?: number;
  alt?: string | null;
}

export interface IPaperImportDraft {
  draft_id: string;
  raw_text: string;
  title: string;
  type: QuestionType;
  content_text: string;
  options: Record<string, string> | null;
  answer_text: string | null;
  analysis: string | null;
  difficulty: number;
  segment_source: string;
  type_confidence: "high" | "medium" | "low";
  boundary_confidence: "high" | "medium" | "low";
  issues: string[];
  images: IPaperImportImageInput[];
  comparison_flags: string[];
  review_status: "pending" | "approved" | "skipped";
  review_required: boolean;
}

export interface IPaperImportSummary {
  total: number;
  duplicates_removed: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  issue_count: number;
  pending_review: number;
  approved: number;
  skipped: number;
}

export interface IPaperImportRecognizeResponse {
  session_id: string;
  mode: "template" | "smart";
  summary: IPaperImportSummary;
  drafts: IPaperImportDraft[];
}

export interface IPaperImportSession {
  id: string;
  file_name: string;
  source_format: "pdf" | "docx" | "md";
  root_knowledge_point_id: string | null;
  error_detail: string | null;
  preview_payload: Record<string, unknown>;
  created_paper_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IExamQuestion {
  question_id: string;
  order: number;
  score_override: number | null;
  source_exam_id?: string | null;
  source_question_id?: string | null;
  question_title: string | null;
  question_type: string | null;
  question_score: number | null;
  question_difficulty: number | null;
}

export interface IExamStudent {
  student_id: string;
  full_name: string | null;
  username: string | null;
  phone?: string | null;
  user_type?: string | null;
  started_at: string | null;
  submitted_at: string | null;
}

export interface IPosition {
  id: string;
  name: string;
  is_system: boolean;
  created_by: string;
  created_at: string;
}

// ── Student Exam Taking ──

export interface IExamQuestionForStudent {
  question_id: string;
  order: number;
  score: number;
  type: QuestionType;
  title: string;
  content: Record<string, unknown>;
  options: Record<string, unknown> | null;
}

export interface ICodeQuestionExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ICodeSampleTest {
  input: string;
  expected_output: string;
}

export interface ICodeFunctionParameter {
  name: string;
  type: string;
}

export interface ICodeQuestionContent extends Record<string, unknown> {
  mode?: "program" | "function";
  description?: string;
  text?: string;
  input_description?: string;
  output_description?: string;
  function_name?: string;
  signature?: string;
  parameters?: ICodeFunctionParameter[];
  return_type?: string;
  starter_code?: Partial<Record<CodeLanguage, string>>;
  examples?: ICodeQuestionExample[];
  sample_tests?: ICodeSampleTest[];
  constraints?: string[];
}

export interface ICodeAnswerContent extends Record<string, unknown> {
  language?: CodeLanguage;
  code?: string;
  code_by_language?: Partial<Record<CodeLanguage, string>>;
  custom_input?: string;
  last_run_input?: string;
  last_run_output?: string;
}

export interface IStudentCodeRunCaseResult {
  name: string;
  input: string;
  expected_output?: string | null;
  actual_output: string;
  status: "passed" | "failed" | "compile_error" | "runtime_error" | "timeout" | "system_error";
  time_ms: number;
  memory_kb: number;
  message: string;
}

export interface IStudentCodeRunResult {
  status: "passed" | "failed" | "compile_error" | "runtime_error" | "timeout" | "system_error";
  mode: "sample" | "custom";
  language: string;
  stdout: string;
  stderr: string;
  compile_output: string;
  time_ms: number;
  memory_kb: number;
  case_count: number;
  passed_count: number;
  cases: IStudentCodeRunCaseResult[];
}

export interface IExamResultQuestionFeedbackDimension {
  name: string;
  score: number;
  max_score: number;
  comment: string;
}

export interface IExamResultQuestionFeedback {
  dimensions?: IExamResultQuestionFeedbackDimension[];
  strengths?: string[];
  deductions?: string[];
  suggestions?: string[];
  evidence_lines?: string[];
  model_evaluation?: {
    model?: string;
    matches?: Array<{
      index?: number;
      expected?: string;
      score?: number;
      is_correct?: boolean;
      reason?: string;
    }>;
  };
}

export interface IExamResultQuestion {
  question_id: string;
  order: number;
  type: QuestionType;
  title: string;
  content: Record<string, unknown>;
  options: Record<string, unknown> | null;
  total_score: number;
  score_awarded: number;
  is_correct: boolean;
  answer_content: Record<string, unknown>;
  standard_answer: Record<string, unknown>;
  analysis: string | null;
  feedback: IExamResultQuestionFeedback;
  appeal_status: string | null;
  appeal_reason: string | null;
  appeal_reply: string | null;
  grading_pending?: boolean;
  grading_failed?: boolean;
  needs_human_review?: boolean;
}

export interface IExamResult {
  exam_id: string;
  title: string;
  submitted_at: string | null;
  total_score: number;
  score: number | null;
  objective_score: number | null;
  subjective_score: number | null;
  grading_status: ExamGradingStatus | null;
  can_view: boolean;
  blocked_reason: string | null;
  teacher_comment?: string | null;
  questions: IExamResultQuestion[];
}

export interface ISubmitExamResponse {
  submitted: boolean;
  score: number | null;
  grading_status: ExamGradingStatus;
}

export interface IStudentNotification {
  id: string;
  type: string;
  title: string;
  content: string;
  related_exam_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface IWrongAnswerFeedback {
  strengths?: string[];
  deductions?: string[];
  suggestions?: string[];
}

export interface IWrongAnswerDetail {
  id: string;
  question_id: string;
  question_title: string;
  question_type: string;
  exam_title: string;
  wrong_count: number;
  last_wrong_at: string;
  tags: string[];
  mastered: boolean;
  question_content: Record<string, unknown>;
  question_options?: Record<string, unknown> | null;
  standard_answer: Record<string, unknown>;
  analysis: string | null;
  student_answer: Record<string, unknown>;
  feedback: IWrongAnswerFeedback;
}

export interface IAppealResponse {
  id: string;
  exam_id: string;
  question_id: string;
  status: string;
  reason: string;
  teacher_reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface IExamTaking {
  exam_id: string;
  title: string;
  category: ExamCategory;
  duration_minutes: number;
  max_switch_count: number;
  allow_retake: boolean;
  started_at: string;
  end_time: string | null;
  questions: IExamQuestionForStudent[];
  saved_answers: Record<string, Record<string, unknown>>;
  switch_count: number;
}

export interface ISwitchReportResponse {
  switch_count: number;
  max_switch_count: number;
  force_submit: boolean;
}

export interface IQuestion {
  id: string;
  type: QuestionType;
  title: string;
  content: Record<string, unknown>;
  options: Record<string, unknown> | null;
  answer: Record<string, unknown>;
  analysis: string | null;
  difficulty: number;
  score: number;
  source?: QuestionSource;
  usage_count: number;
  question_bank_id: string | null;
  question_bank_name: string | null;
  tags: ITag[];
  knowledge_points: IKnowledgePoint[];
  edit_lock?: {
    in_use: boolean;
    allowed_fields: string[];
    regrade_on_fields: string[];
    has_submitted_attempts: boolean;
  } | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}
