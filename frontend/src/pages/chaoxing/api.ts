export interface ContentBlock {
  kind: "text" | "image" | "file";
  text?: string;
  name?: string;
  asset_id?: string;
  size?: number;
  preview?: string;
  embedded_images?: { asset_id: string; name: string }[];
  unavailable?: boolean;
}
export interface PaperRichContent {
  content?: ContentBlock[];
  student_answer?: ContentBlock[];
  reference_answer?: ContentBlock[];
}
export interface Connection {
  id: string;
  connected: boolean;
  width: number;
  height: number;
  remaining_seconds: number;
}
export interface RecordItem {
  id: string;
  source_id?: string;
  title?: string;
  item_type?: "考试" | "作业";
  name?: string;
  student_no?: string;
  status?: "submitted" | "unsubmitted" | "unknown";
  submitted_count?: number | null;
  course_code?: string;
  teacher_name?: string;
  teacher_team?: string;
  school_name?: string;
  semester_title?: string;
  course_tags?: string;
  source_score?: number | null;
  /** Set only when the provider prints a submission time for that answer. */
  submitted_at?: string | null;
  saved_candidate_id?: string;
  saved_revision?: number;
  grading_state?: "needs_grading" | "grading" | "graded" | "no_ai" | "saved";
  already_ai_graded?: boolean;
  readable: boolean;
}
export interface Semester { id: string; title: string; selected: boolean }
export interface Listing {
  items: RecordItem[];
  notice: string;
  assignment_notice?: string;
  complete: boolean;
  semesters?: Semester[];
  semester_id?: string;
  expected_submitted?: number | null;
  source?: "live" | "session" | "snapshot";
  fetched_at?: string;
  stale?: boolean;
}
export interface Question {
  rich_content?: PaperRichContent | null;
  source_id: string;
  question_type: string;
  content: string;
  student_answer: string;
  reference_answer: string;
  max_score: number | null;
  source_score: number | null;
  objective: boolean;
  requires_manual_review: boolean;
}
export interface Review {
  questions: Question[]; notice: string; review_hash: string; declared_max_score: number | null;
  source?: "live" | "session" | "snapshot"; fetched_at?: string; stale?: boolean;
}
export interface Verified extends Listing { session: Connection }
export class ConnectionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function connectionFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`/api/chaoxing${path}`, {
    ...init, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ConnectionError(response.status, typeof error?.detail === "string" ? error.detail : "连接请求失败，请重试");
  }
  return response;
}
export async function connectionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await connectionFetch(path, init);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export interface Totals {
  question_count: number; resolved_count: number; objective_score: number;
  ai_subjective_score: number; ai_graded_count: number; confirmed_subtotal: number;
  final_score: number | null; max_score: number | null; declared_max_score: number | null; score_mismatch: boolean;
}
export interface SavedCandidate { id: string; name: string; student_no: string; revision: number; totals: Totals }
export interface SavedExam { id: string; title: string; course_title: string; expected_submitted: number | null; candidates: SavedCandidate[] }
export interface SavedItem {
  rich_content?: PaperRichContent | null;
  id: string; position: number; question_type: string; content: string; student_answer: string;
  reference_answer: string; max_score: number | null; objective: boolean; source_score: number | null;
  ai_score: number | null; confirmed_score: number | null; status: string; version: number;
  comment: string; error: string; requires_manual_review: boolean; binding_version?: number;
  feedback: { dimension_scores?: Record<string, number>; dimension_comments: Record<string, string>;
    dimension_labels?: Record<string, string>; dimension_max_scores?: Record<string, number>; deduction_reasons: string[];
    strengths: string[]; improvement_suggestions: string[]; risk_flags: string[] } | null;
}
export interface SavedPaper {
  id: string; exam_id: string; name: string; student_no: string; exam_title: string; course_title: string;
  revision: number; current_revision: number; completeness_confirmed: boolean; source_score: number | null; totals: Totals | null; items: SavedItem[];
  audit: { action: string; actor_id: string; created_at: string; details: Record<string, unknown> }[];
}
