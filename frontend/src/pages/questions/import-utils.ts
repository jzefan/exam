import type { QuestionType } from "@/types";
import type {
  ImportConfidence,
  ImportRecognitionMode,
  ImportReviewStatus,
  QuestionImportDocumentSummary,
  QuestionImportDraft,
} from "./import-types";

export const emptyImportSummary: QuestionImportDocumentSummary = {
  total: 0,
  high_confidence: 0,
  medium_confidence: 0,
  low_confidence: 0,
  issue_count: 0,
  pending_review: 0,
  approved: 0,
  skipped: 0,
};

export function detectQuestionImportFormat(fileName: string): "pdf" | "docx" | "md" {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf" || extension === "docx" || extension === "md" || extension === "markdown") {
    return extension === "markdown" ? "md" : extension;
  }
  throw new Error("暂不支持该文件格式，请上传 PDF、Word(docx) 或 Markdown 文件。");
}

export async function extractQuestionImportText(file: File): Promise<string> {
  const format = detectQuestionImportFormat(file.name);

  if (format === "md") {
    return file.text();
  }

  if (format === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    chunks.push(text.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return chunks.join("\n");
}

function buildAnswerPayload(type: QuestionType, answerText: string | null) {
  const text = answerText ?? "";
  if (type === "choice") return { correct: text };
  if (type === "true_false") return { correct: /^(正确|对|true|t|√)$/i.test(text.trim()) };
  if (type === "fill_in") {
    return { correct: text.split(/[;,；\n]/).map((item) => item.trim()).filter(Boolean) };
  }
  if (type === "code") return { code: text };
  return { points: text.split(/\n+/).map((item) => item.trim()).filter(Boolean) };
}

export function buildImportableQuestions(drafts: QuestionImportDraft[], questionBankId: string | null) {
  return drafts
    .filter((draft) => draft.review_status === "approved")
    .map((draft) => ({
      type: draft.type,
      title: draft.title || draft.content_text.replace(/\s+/g, " ").slice(0, 120),
      content: {
        text: draft.content_text,
        html: `<p>${draft.content_text.replace(/\n/g, "<br />")}</p>`,
      },
      options: draft.type === "choice" ? draft.options : null,
      answer: buildAnswerPayload(draft.type, draft.answer_text),
      analysis: draft.analysis || null,
      difficulty: draft.difficulty,
      score: 10,
      tag_ids: [],
      knowledge_point_ids: [],
      question_bank_id: questionBankId,
    }));
}

export function buildImportSummary(drafts: QuestionImportDraft[]): QuestionImportDocumentSummary {
  return {
    total: drafts.length,
    high_confidence: drafts.filter(
      (draft) => draft.type_confidence === "high" && draft.boundary_confidence === "high",
    ).length,
    medium_confidence: drafts.filter(
      (draft) => draft.type_confidence === "medium" || draft.boundary_confidence === "medium",
    ).length,
    low_confidence: drafts.filter(
      (draft) => draft.type_confidence === "low" || draft.boundary_confidence === "low",
    ).length,
    issue_count: drafts.filter((draft) => draft.issues.length > 0).length,
    pending_review: drafts.filter((draft) => draft.review_status === "pending").length,
    approved: drafts.filter((draft) => draft.review_status === "approved").length,
    skipped: drafts.filter((draft) => draft.review_status === "skipped").length,
  };
}

export function getConfidenceLabel(confidence: ImportConfidence): string {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  return "低";
}

export function getImportModeLabel(mode: ImportRecognitionMode | null): string {
  if (mode === "template") return "模板导入";
  if (mode === "smart") return "智能识别";
  return "未识别";
}

export function getReviewStatusLabel(status: ImportReviewStatus): string {
  if (status === "approved") return "已确认";
  if (status === "skipped") return "已跳过";
  return "待审核";
}
