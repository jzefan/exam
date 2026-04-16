import type { QuestionType } from "@/types";

export type ImportRecognitionMode = "template" | "smart";
export type ImportConfidence = "high" | "medium" | "low";
export type ImportReviewStatus = "pending" | "approved" | "skipped";
export type ImportFilter = "all" | "pending" | "issues" | "low" | "missing_answer";
export type QuestionImportAnalysisMode = "fast" | "ai_full";

export interface QuestionImportImageInput {
  image_id: string;
  url: string;
  order: number;
  page?: number;
  alt?: string | null;
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
}

export interface QuestionImportDocumentRecognizeResponse {
  mode: ImportRecognitionMode;
  summary: QuestionImportDocumentSummary;
  drafts: QuestionImportDraft[];
}
