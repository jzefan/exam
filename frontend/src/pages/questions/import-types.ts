import type { QuestionType } from "@/types";

export type ImportRecognitionMode = "template" | "smart";
export type ImportConfidence = "high" | "medium" | "low";
export type ImportReviewStatus = "pending" | "approved" | "skipped";
export type ImportFilter = "all" | "pending" | "issues" | "low" | "missing_answer";
export type QuestionImportAnalysisMode = "fast" | "ai_full";
export type QuestionImportJobStatus = "pending" | "running" | "completed" | "failed" | "partial_failed";

export interface QuestionImportImageInput {
  image_id: string;
  url: string;
  order: number;
  page?: number;
  alt?: string | null;
}

export interface QuestionImportTableInput {
  order: number;
  rows: string[][];
}

export interface QuestionImportDraft {
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
  type_confidence: ImportConfidence;
  boundary_confidence: ImportConfidence;
  issues: string[];
  images?: QuestionImportImageInput[];
  comparison_flags?: string[];
  review_status: ImportReviewStatus;
  review_required: boolean;
  doubt?: boolean;
  doubt_reason?: string | null;
  suggested_knowledge_points?: Array<{ id: string; name: string }>;
}

export interface QuestionImportDocumentSummary {
  total: number;
  duplicates_removed: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  issue_count: number;
  pending_review: number;
  approved: number;
  skipped: number;
  incomplete_choice_count: number;
  visual_retry_recommended: boolean;
}

export interface QuestionImportDocumentRecognizeResponse {
  mode: ImportRecognitionMode;
  summary: QuestionImportDocumentSummary;
  drafts: QuestionImportDraft[];
}

export interface QuestionImportBulkCreateJobResponse {
  job_id: string;
  created: number;
  existing: number;
  failed: number;
  status: QuestionImportJobStatus;
}

export interface QuestionBulkCreateResponse {
  created: number;
  existing: number;
  failed: number;
}

export interface QuestionImportJobResponse {
  id: string;
  user_id: string;
  status: QuestionImportJobStatus;
  total_count: number;
  processed_count: number;
  matched_count: number;
  unmatched_count: number;
  failed_count: number;
  created_question_ids: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface EnhanceDraftInput {
  draft_id: string;
  type: QuestionType;
  content_text: string;
  options: Record<string, string> | null;
  answer_text: string | null;
  analysis: string | null;
}

export interface EnhancedDraft {
  draft_id: string;
  answer_text: string | null;
  analysis: string | null;
  doubt: boolean;
  doubt_reason: string | null;
  suggested_knowledge_points: Array<{ id: string; name: string }>;
}

export interface EnhanceDraftsResponse {
  drafts: EnhancedDraft[];
}
