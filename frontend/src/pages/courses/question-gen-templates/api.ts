// API client for course question-generation templates (Step 1).
// CRUD reuses apiRequest; generation streams from the template endpoint and
// saving reuses the existing save-generated-to-course-bank endpoint.

import { apiRequest } from "@/pages/grading/api";
import type {
  CreatedKnowledgePoint,
  KnowledgePointCandidate,
  RunSummary,
  SeedUsageMap,
  TemplateCreatePayload,
  TemplateDetail,
  TemplateGenerateOverrides,
  TemplateSummary,
  TemplateUpdatePayload,
} from "./types";

export function listCourseTemplates(courseId: string): Promise<TemplateSummary[]> {
  return apiRequest<TemplateSummary[]>(`/teacher/courses/${courseId}/question-gen-templates`);
}

export function createCourseTemplate(
  courseId: string,
  payload: TemplateCreatePayload,
): Promise<TemplateDetail> {
  return apiRequest<TemplateDetail>(`/teacher/courses/${courseId}/question-gen-templates`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTemplate(templateId: string): Promise<TemplateDetail> {
  return apiRequest<TemplateDetail>(`/question-gen-templates/${templateId}`);
}

export function updateTemplate(
  templateId: string,
  payload: TemplateUpdatePayload,
): Promise<TemplateDetail> {
  return apiRequest<TemplateDetail>(`/question-gen-templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteTemplate(templateId: string): Promise<void> {
  return apiRequest<void>(`/question-gen-templates/${templateId}`, { method: "DELETE" });
}

export function setDefaultTemplate(templateId: string): Promise<TemplateDetail> {
  return apiRequest<TemplateDetail>(`/question-gen-templates/${templateId}/set-default`, {
    method: "POST",
  });
}

export function duplicateTemplate(templateId: string): Promise<TemplateDetail> {
  return apiRequest<TemplateDetail>(`/question-gen-templates/${templateId}/duplicate`, {
    method: "POST",
  });
}

export function listTemplateRuns(templateId: string): Promise<RunSummary[]> {
  return apiRequest<RunSummary[]>(`/question-gen-templates/${templateId}/runs`);
}

/** question_id -> 使用该题作为种子的出题技能（用于题库列表徽标）。 */
export function getSeedUsage(courseId: string): Promise<SeedUsageMap> {
  return apiRequest<SeedUsageMap>(`/teacher/courses/${courseId}/question-gen-templates/seed-usage`);
}

// --- Step 3: seed questions (种子题) ---

/** A recognized/typed seed question (not yet persisted into a bank). */
export interface RecognizedSeed {
  type: string;
  text: string;
  options?: Record<string, string> | null;
  answer?: string | null;
  analysis?: string | null;
}

/** 手动添加种子题：根据题型 + 题干，AI 补全参考答案与解析。 */
export function completeSeedAnswer(
  type: string,
  text: string,
): Promise<{ answer: string; analysis: string }> {
  return apiRequest<{ answer: string; analysis: string }>(
    "/question-gen-templates/seed/complete-answer",
    { method: "POST", body: JSON.stringify({ type, text }) },
  );
}

interface DocRecognizeDraft {
  type: string;
  content_text?: string | null;
  options?: Record<string, string> | null;
  answer_text?: string | null;
  analysis?: string | null;
}

function draftsToSeeds(drafts: DocRecognizeDraft[]): RecognizedSeed[] {
  return drafts
    .map((d) => ({
      type: d.type,
      text: (d.content_text ?? "").trim(),
      options: d.options ?? null,
      answer: d.answer_text ?? null,
      analysis: d.analysis ?? null,
    }))
    .filter((s) => s.text.length > 0);
}

/** 导入题目清单：将一份只含题目的文档识别成带题型的种子题（复用题目文档识别端点，AI 全量模式）。 */
export async function recognizeQuestionListSeeds(payload: {
  file_name: string;
  raw_text: string;
  source_format: "pdf" | "docx" | "md";
}): Promise<RecognizedSeed[]> {
  const res = await apiRequest<{ drafts: DocRecognizeDraft[] }>(
    "/questions/import/document-recognize",
    {
      method: "POST",
      body: JSON.stringify({
        file_name: payload.file_name,
        raw_text: payload.raw_text,
        source_format: payload.source_format,
        analysis_mode: "ai_full",
      }),
    },
  );
  return draftsToSeeds(res.drafts ?? []);
}

/** 导入标准试卷：复用「考试管理-导入试卷」的识别管线（PDF/Word 走多模态），
 *  能跳过封面/答题卡/得分栏等版式，识别成带题型的种子题。 */
export async function recognizeStandardPaperSeeds(file: File): Promise<RecognizedSeed[]> {
  const { extractPaperImportPayload, recognizePaperPayload } = await import(
    "@/pages/papers/recognize"
  );
  const payload = await extractPaperImportPayload(file);
  const recognized = await recognizePaperPayload(payload);
  return draftsToSeeds(recognized.drafts as unknown as DocRecognizeDraft[]);
}

/** Save approved generated questions into the course's default bank (reuses existing endpoint). */
export function saveGeneratedToCourseBank(
  questions: unknown[],
): Promise<{ created_question_ids: string[] }> {
  return apiRequest<{ created_question_ids: string[] }>(
    "/questions/save-generated-to-course-bank",
    { method: "POST", body: JSON.stringify({ questions }) },
  );
}

// --- Step 2: material → knowledge-point extraction ---
export function extractKnowledgePoints(
  courseId: string,
  resourceId: string,
  body: { material_text: string; resource_title?: string | null },
): Promise<{ candidates: KnowledgePointCandidate[] }> {
  return apiRequest<{ candidates: KnowledgePointCandidate[] }>(
    `/teacher/courses/${courseId}/materials/${resourceId}/extract-knowledge-points`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function bulkCreateKnowledgePoints(
  courseId: string,
  items: Array<{ name: string; description?: string | null; parent_id?: string | null }>,
): Promise<{ created: CreatedKnowledgePoint[]; skipped: string[] }> {
  return apiRequest<{ created: CreatedKnowledgePoint[]; skipped: string[] }>(
    `/teacher/courses/${courseId}/knowledge-points/bulk-create`,
    { method: "POST", body: JSON.stringify({ items }) },
  );
}

/** Extract typed knowledge fragments from a material's text and store them ON the
 *  material (concepts/formulas/code/cases/workflows — NOT added to the course tree). */
export function extractKnowledgeFragments(
  courseId: string,
  resourceId: string,
  body: { material_text: string; resource_title?: string | null },
): Promise<{ fragments: Array<{ type: string; title: string; content: string }> }> {
  return apiRequest<{ fragments: Array<{ type: string; title: string; content: string }> }>(
    `/teacher/courses/${courseId}/materials/${resourceId}/extract-knowledge-fragments`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export interface KbStatus {
  kb_status: string | null;
  kb_error: string | null;
  kb_chunk_count: number;
}

/** Start the course-KB ingest pipeline (chunk → embed → store) for one material.
 *  Returns immediately; poll kbStatus to observe progress. */
export function kbIngestMaterial(
  courseId: string,
  resourceId: string,
  materialText: string,
): Promise<KbStatus> {
  return apiRequest<KbStatus>(`/teacher/courses/${courseId}/materials/${resourceId}/kb-ingest`, {
    method: "POST",
    body: JSON.stringify({ material_text: materialText }),
  });
}

export function kbStatus(courseId: string, resourceId: string): Promise<KbStatus> {
  return apiRequest<KbStatus>(`/teacher/courses/${courseId}/materials/${resourceId}/kb-status`);
}

export interface KbStats {
  chunk_count: number;
  ready_materials: number;
  total_chunked_materials: number;
}

export function kbStats(courseId: string): Promise<KbStats> {
  return apiRequest<KbStats>(`/teacher/courses/${courseId}/kb/stats`);
}

/**
 * Start a template generation run. Returns the raw streaming Response; the caller
 * reads the SSE body (events are the same `data: {type, ...}` shape produced by
 * the existing AI generate engine).
 */
export async function generateFromTemplate(
  templateId: string,
  overrides: TemplateGenerateOverrides,
  signal?: AbortSignal,
): Promise<Response> {
  const token = localStorage.getItem("access_token");
  return fetch(`/api/question-gen-templates/${templateId}/generate/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(overrides),
    signal,
  });
}

/**
 * Chat-style generation: a free-form instruction drives types/counts/topic.
 * Returns the raw streaming Response (same SSE event shape as generateFromTemplate).
 */
export async function chatGenerateFromTemplate(
  templateId: string,
  message: string,
  signal?: AbortSignal,
): Promise<Response> {
  const token = localStorage.getItem("access_token");
  return fetch(`/api/question-gen-templates/${templateId}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message }),
    signal,
  });
}
