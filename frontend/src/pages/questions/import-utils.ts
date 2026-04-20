import type { QuestionType } from "@/types";
import type {
  ImportConfidence,
  ImportRecognitionMode,
  ImportReviewStatus,
  QuestionImportImageInput,
  QuestionImportDocumentSummary,
  QuestionImportDraft,
} from "./import-types";

export const emptyImportSummary: QuestionImportDocumentSummary = {
  total: 0,
  duplicates_removed: 0,
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

export function buildStandardImportTemplate(): string {
  return `# 题目导入标准模板

请严格按照以下格式填写题目，题目之间保留一个空行。

难度映射：
- 很容易 = 1
- 容易 = 2
- 一般 = 3
- 困难 = 4
- 很难 = 5

[题型] 选择题
题目内容：我国首都是哪里？
A. 北京
B. 上海
C. 广州
D. 深圳
[答案] A
[解析] 北京是中国首都。
[难度] 容易

[题型] 简答题
题目内容：请简述数据库事务的 ACID 特性。
[答案] 原子性、一致性、隔离性、持久性。
[解析] ACID 是数据库事务的四个核心特性。
[难度] 一般
`;
}

export async function extractQuestionImportPayload(file: File): Promise<{
  rawText: string;
  sourceFormat: "pdf" | "docx" | "md";
  images: QuestionImportImageInput[];
}> {
  const format = detectQuestionImportFormat(file.name);

  if (format === "md") {
    const normalized = normalizeMarkdownImages(await readFileAsText(file));
    return {
      rawText: normalized.html,
      sourceFormat: format,
      images: normalized.images,
    };
  }

  if (format === "docx") {
    const mammoth = await import("mammoth");
    const images: QuestionImportImageInput[] = [];
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.readAsBase64String();
          const url = await uploadImportedImage(base64, image.contentType);
          const imageId = `image-${images.length + 1}`;
          images.push({ image_id: imageId, url, order: images.length + 1, alt: "" });
          return { src: url, "data-image-id": imageId };
        }),
      },
    );
    return {
      rawText: htmlToImportText(result.value, images),
      sourceFormat: format,
      images,
    };
  }

  const [{ getDocument, GlobalWorkerOptions, OPS }, { default: pdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const chunks: string[] = [];
  const images: QuestionImportImageInput[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const operatorList = await page.getOperatorList();
    const hasImage = operatorList.fnArray.some(
      (fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject,
    );
    const pageText = text.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    if (hasImage) {
      const imageId = `image-${images.length + 1}`;
      images.push({
        image_id: imageId,
        url: `pdf-page-image://${pageNumber}`,
        order: images.length + 1,
        page: pageNumber,
        alt: `第 ${pageNumber} 页图片`,
      });
      chunks.push(`${pageText}\n[IMAGE:${imageId}]`);
    } else {
      chunks.push(pageText);
    }
  }
  return {
    rawText: chunks.join("\n"),
    sourceFormat: format,
    images,
  };
}

export async function extractQuestionImportText(file: File): Promise<string> {
  const payload = await extractQuestionImportPayload(file);
  return payload.rawText;
}

async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  if (typeof file.arrayBuffer === "function") {
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsText(file);
  });
}

async function uploadImportedImage(base64: string, contentType: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const extension = contentType.split("/")[1] || "png";
  const file = new File([bytes], `question-import-image.${extension}`, { type: contentType });
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("图片上传失败，请检查文件后重试。");
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    throw new Error("图片上传失败，请检查文件后重试。");
  }
  return data.url;
}

function normalizeMarkdownImages(markdown: string): { html: string; images: QuestionImportImageInput[] } {
  const images: QuestionImportImageInput[] = [];
  const html = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
    const imageId = `image-${images.length + 1}`;
    images.push({
      image_id: imageId,
      url: src.trim(),
      order: images.length + 1,
      alt: alt.trim(),
    });
    return `<img src="${src.trim()}" alt="${alt.trim()}" data-image-id="${imageId}" />`;
  });
  return { html, images };
}

type ImportTextBlock = {
  text: string;
  separate?: boolean;
};

function collectInlineParts(
  node: ChildNode,
  imageIndex: Map<string, QuestionImportImageInput>,
): ImportTextBlock[] {
  if (node instanceof Text) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return text ? [{ text }] : [];
  }

  if (node instanceof HTMLImageElement) {
    const imageId = node.getAttribute("data-image-id") ?? `image-${imageIndex.size + 1}`;
    if (!imageIndex.has(imageId)) {
      imageIndex.set(imageId, {
        image_id: imageId,
        url: node.getAttribute("src") ?? node.src,
        order: imageIndex.size + 1,
        alt: node.getAttribute("alt") ?? "",
      });
    }
    return [
      {
        text: `<img src="${node.getAttribute("src") ?? node.src}" alt="${node.getAttribute("alt") ?? ""}" data-image-id="${imageId}" />`,
        separate: true,
      },
    ];
  }

  if (node instanceof HTMLElement) {
    return Array.from(node.childNodes).flatMap((child) => collectInlineParts(child, imageIndex));
  }

  return [];
}

function appendMergedInlineText(
  target: string[],
  parts: ImportTextBlock[],
) {
  const textParts = parts.filter((part) => !part.separate).map((part) => part.text.trim()).filter(Boolean);
  if (textParts.length > 0) {
    target.push(textParts.join(" "));
  }
  for (const imagePart of parts.filter((part) => part.separate)) {
    target.push(imagePart.text);
  }
}

export function htmlToImportText(html: string, images: QuestionImportImageInput[] = []): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const parts: string[] = [];
  const imageIndex = new Map(images.map((image) => [image.image_id, image]));

  const visitNode = (node: ChildNode) => {
    if (node instanceof HTMLParagraphElement || /^H[1-6]$/.test(node.nodeName)) {
      appendMergedInlineText(parts, collectInlineParts(node, imageIndex));
      parts.push("");
      return;
    }

    if (node instanceof HTMLOListElement) {
      Array.from(node.children).forEach((child) => {
        if (child instanceof HTMLLIElement) {
          const lineParts: string[] = [];
          appendMergedInlineText(lineParts, collectInlineParts(child, imageIndex));
          if (lineParts[0]) {
            parts.push(`- ${lineParts[0]}`);
          }
          for (const extra of lineParts.slice(1)) {
            parts.push(extra);
          }
        }
      });
      parts.push("");
      return;
    }

    if (node instanceof HTMLUListElement) {
      Array.from(node.children).forEach((child) => {
        if (child instanceof HTMLLIElement) {
          const lineParts: string[] = [];
          appendMergedInlineText(lineParts, collectInlineParts(child, imageIndex));
          if (lineParts[0]) {
            parts.push(`- ${lineParts[0]}`);
          }
          for (const extra of lineParts.slice(1)) {
            parts.push(extra);
          }
        }
      });
      parts.push("");
      return;
    }

    if (node instanceof HTMLImageElement) {
      appendMergedInlineText(parts, collectInlineParts(node, imageIndex));
      parts.push("");
      return;
    }

    if (node instanceof HTMLElement) {
      Array.from(node.childNodes).forEach(visitNode);
      if (node instanceof HTMLDivElement || node instanceof HTMLTableElement) {
        parts.push("");
      }
      return;
    }
  };

  Array.from(document.body.childNodes).forEach(visitNode);

  return parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

export function isMissingAnswerIssue(issue: string): boolean {
  return /未识别到答案|缺少答案|缺答案/.test(issue);
}

export function getBlockingImportIssues(draft: QuestionImportDraft): string[] {
  return draft.issues.filter((issue) => !isMissingAnswerIssue(issue));
}

export function hasBlockingImportIssues(draft: QuestionImportDraft): boolean {
  return getBlockingImportIssues(draft).length > 0;
}

export function buildImportableQuestions(drafts: QuestionImportDraft[], questionBankId: string | null) {
  return drafts
    .filter((draft) => draft.review_status === "approved" && !hasBlockingImportIssues(draft))
    .map((draft) => {
      const rawTitle = (draft.title || generateImportQuestionTitle(draft.content_text)).trim();
      const title = (rawTitle || "未命名题目").slice(0, 500);
      const clampedDifficulty = Math.min(5, Math.max(1, Math.round(draft.difficulty || 3)));
      return {
        type: draft.type,
        title,
        content: {
          text: stripHtmlForTitle(draft.content_text),
          html: importTextToHtml(draft.content_text),
        },
        options: draft.type === "choice" ? draft.options : null,
        answer: buildAnswerPayload(draft.type, draft.answer_text),
        analysis: draft.analysis || null,
        difficulty: clampedDifficulty,
        score: 10,
        tag_ids: [],
        knowledge_point_ids: [],
        question_bank_id: questionBankId,
      };
    });
}

export function generateImportQuestionTitle(contentText: string): string {
  const normalized = stripHtmlForTitle(contentText).replace(/\s+/g, " ").trim();
  return normalized.slice(0, 120) || "未命名题目";
}

export function importTextToHtml(contentText: string): string {
  return contentText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^<img\s/i.test(line)) {
        return line;
      }
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("");
}

function stripHtmlForTitle(value: string): string {
  return value
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildImportSummary(drafts: QuestionImportDraft[]): QuestionImportDocumentSummary {
  return {
    total: drafts.length,
    duplicates_removed: 0,
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

export function getNextDraftIdAfterRemoval(
  drafts: QuestionImportDraft[],
  removedDraftId: string,
  selectedDraftId: string | null,
): string | null {
  if (selectedDraftId !== removedDraftId) return selectedDraftId;

  const removedIndex = drafts.findIndex((draft) => draft.draft_id === removedDraftId);
  const remainingDrafts = drafts.filter((draft) => draft.draft_id !== removedDraftId);
  if (remainingDrafts.length === 0) return null;

  return remainingDrafts[Math.min(removedIndex, remainingDrafts.length - 1)]?.draft_id ?? null;
}

export function getDraftPreviewText(draft: QuestionImportDraft): string {
  return draft.content_text?.trim() || draft.title?.trim() || "未命名题目";
}

export function isEligibleForBulkApprove(draft: QuestionImportDraft): boolean {
  return (
    draft.review_status === "pending" &&
    !hasBlockingImportIssues(draft)
  );
}

export function canApproveAllDrafts(drafts: QuestionImportDraft[]): boolean {
  return drafts.some(isEligibleForBulkApprove);
}

export function isEligibleForFastImport(draft: QuestionImportDraft): boolean {
  return !hasBlockingImportIssues(draft) && draft.review_status !== "skipped";
}

export function countFastImportEligibleDrafts(drafts: QuestionImportDraft[]): number {
  return drafts.filter(isEligibleForFastImport).length;
}

export function approveAllPendingDrafts(drafts: QuestionImportDraft[]): QuestionImportDraft[] {
  return drafts.map((draft) => {
    if (!isEligibleForBulkApprove(draft)) return draft;
    return {
      ...draft,
      title: generateImportQuestionTitle(draft.content_text),
      review_status: "approved",
      review_required: false,
    };
  });
}

export function applySourceDraftEdits(
  drafts: QuestionImportDraft[],
  edits: Record<string, string>,
): QuestionImportDraft[] {
  return drafts.map((draft) => {
    const nextRawText = edits[draft.draft_id];
    if (nextRawText == null || nextRawText === draft.raw_text) return draft;

    return {
      ...draft,
      raw_text: nextRawText,
      content_text: nextRawText,
      review_status: "pending",
      review_required: true,
    };
  });
}

export function getConfidenceLabel(confidence: ImportConfidence): string {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  return "低";
}

export function getQuestionTypeLabel(type: QuestionType): string {
  const labels: Record<QuestionType, string> = {
    choice: "选择题",
    true_false: "判断题",
    fill_in: "填空题",
    short_answer: "简答题",
    essay: "论述题",
    code: "编程题",
  };
  return labels[type] ?? type;
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
