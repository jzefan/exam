import type { QuestionImportJobResponse } from "./import-types";

export const ACTIVE_QUESTION_IMPORT_JOB_ID_STORAGE_KEY = "active_question_import_job_id";
export const QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID = "question-knowledge-recognition";
export const QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH = "/questions/import";
export const QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION =
  "可离开当前页面继续其它操作，系统会在后台继续识别知识点。";

export type QuestionKnowledgeRecognitionStatus = "waiting" | "running";

export function isTerminalQuestionImportJobStatus(status: QuestionImportJobResponse["status"]) {
  return status === "completed" || status === "failed" || status === "partial_failed";
}

export function isActiveQuestionImportJob(job: QuestionImportJobResponse | null | undefined): job is QuestionImportJobResponse {
  return job?.status === "pending" || job?.status === "running";
}

export function getQuestionKnowledgeRecognitionStatus(
  questionId: string,
  job: QuestionImportJobResponse | null | undefined,
): QuestionKnowledgeRecognitionStatus | null {
  if (!isActiveQuestionImportJob(job)) {
    return null;
  }

  const questionIndex = job.created_question_ids.indexOf(questionId);
  if (questionIndex < 0) {
    return null;
  }

  if (job.status === "pending") {
    return "waiting";
  }

  if (questionIndex < job.processed_count) {
    return null;
  }

  if (questionIndex === job.processed_count) {
    return "running";
  }

  return "waiting";
}

export function readPersistedQuestionImportJobId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(ACTIVE_QUESTION_IMPORT_JOB_ID_STORAGE_KEY);
}

export function persistQuestionImportJobId(jobId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(ACTIVE_QUESTION_IMPORT_JOB_ID_STORAGE_KEY, jobId);
}

export function clearPersistedQuestionImportJobId(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(ACTIVE_QUESTION_IMPORT_JOB_ID_STORAGE_KEY);
}
