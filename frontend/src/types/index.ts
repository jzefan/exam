import type { IUserOrgInfo } from "./rbac";

export type UserRole = "platform_admin" | "enterprise_admin" | "enterprise_user" | "school_admin" | "teacher" | "student";

export interface IUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  primary_org: IUserOrgInfo | null;
  organizations: IUserOrgInfo[];
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
  role?: UserRole;
}

export interface ITokenResponse {
  access_token: string;
  token_type: string;
  user: IUser;
}

export type QuestionType = "choice" | "true_false" | "fill_in" | "short_answer" | "essay" | "code";

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
  question_count: number;
  created_at: string;
}

export type ExamStatus = "draft" | "upcoming" | "ongoing" | "completed" | "closed";

export interface IExam {
  id: string;
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
  show_result: boolean;
  notes_template: string | null;
  total_questions: number;
  total_students: number;
  submitted_count: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface IExamQuestion {
  question_id: string;
  order: number;
  score_override: number | null;
  question_title: string | null;
  question_type: string | null;
  question_score: number | null;
  question_difficulty: number | null;
}

export interface IExamStudent {
  student_id: string;
  full_name: string | null;
  username: string | null;
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

export interface IExamTaking {
  exam_id: string;
  title: string;
  duration_minutes: number;
  max_switch_count: number;
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
  usage_count: number;
  question_bank_id: string | null;
  question_bank_name: string | null;
  tags: ITag[];
  knowledge_points: IKnowledgePoint[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}
