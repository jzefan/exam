import type { QuestionType } from "@/types";
import type {
  ImportConfidence,
  ImportRecognitionMode,
  ImportReviewStatus,
  QuestionImportImageInput,
  QuestionImportTableInput,
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
  incomplete_choice_count: 0,
  visual_retry_recommended: false,
};

export function detectQuestionImportFormat(fileName: string): "pdf" | "docx" | "md" | "json" | "zip" {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf" || extension === "docx" || extension === "md" || extension === "markdown" || extension === "json" || extension === "zip") {
    if (extension === "markdown") return "md";
    return extension as "pdf" | "docx" | "md" | "json" | "zip";
  }
  throw new Error("暂不支持该文件格式，请上传 PDF、Word(docx)、Markdown、JSON 或 ZIP 文件。");
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
  sourceFormat: "pdf" | "docx" | "md" | "json" | "zip";
  images: QuestionImportImageInput[];
  tables: QuestionImportTableInput[];
}> {
  const format = detectQuestionImportFormat(file.name);

  if (format === "zip") {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);
    // Find JSON files in the zip
    const jsonFiles = Object.keys(zip.files).filter(
      (name) => name.endsWith(".json") && !name.startsWith("__MACOSX") && !zip.files[name].dir,
    );
    if (jsonFiles.length === 0) {
      throw new Error("ZIP 文件中未找到 JSON 题目文件");
    }
    // Use the first JSON file found
    const jsonFile = zip.files[jsonFiles[0]];
    const jsonText = await jsonFile.async("text");

    // Find and upload images referenced in the JSON
    const images: QuestionImportImageInput[] = [];
    try {
      const parsed = JSON.parse(jsonText);
      const items: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)?.questions)
          ? ((parsed as Record<string, unknown>).questions as unknown[])
          : [parsed];
      const referencedImages: Array<{ filename: string }> = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const q = item as Record<string, unknown>;
        if (q.images && Array.isArray(q.images)) {
          for (const img of q.images as Array<{ filename?: string }>) {
            if (img.filename && !referencedImages.some((r) => r.filename === img.filename)) {
              referencedImages.push(img as { filename: string });
            }
          }
        }
      }
      // Match images in ZIP by filename (search in root, images/, imgs/, pics/)
      for (const ref of referencedImages) {
        const candidates = [
          ref.filename,
          `images/${ref.filename}`,
          `imgs/${ref.filename}`,
          `pics/${ref.filename}`,
        ];
        let found: string | null = null;
        for (const candidate of candidates) {
          if (zip.files[candidate] && !zip.files[candidate].dir) {
            found = candidate;
            break;
          }
        }
        if (!found) {
          // Try fuzzy match: any file with the same name anywhere in the zip
          found = Object.keys(zip.files).find(
            (name) =>
              !zip.files[name].dir &&
              (name.endsWith(`/${ref.filename}`) || name === ref.filename),
          ) || null;
        }
        if (found) {
          const imageData = await zip.files[found].async("base64");
          const ext = ref.filename.split(".").pop()?.toLowerCase() || "png";
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
          const url = await uploadImportedImage(imageData, mime);
          images.push({
            image_id: `zip-img-${ref.filename.replace(/[^a-zA-Z0-9]/g, "-")}`,
            url,
            order: images.length + 1,
            alt: ref.filename,
          });
        }
      }
    } catch {
      // If JSON parsing or image upload fails, still proceed with the raw JSON text
    }

    return { rawText: jsonText, sourceFormat: "json", images, tables: [] };
  }

  if (format === "json") {
    const rawText = await readFileAsText(file);
    return { rawText, sourceFormat: "json", images: [], tables: [] };
  }

  if (format === "md") {
    const normalized = normalizeMarkdownImages(await readFileAsText(file));
    return {
      rawText: normalized.html,
      sourceFormat: format,
      images: normalized.images,
      tables: [],
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
      tables: extractHtmlTables(result.value),
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
    tables: [],
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

function appendListItems(
  target: string[],
  list: HTMLOListElement | HTMLUListElement,
  marker: "[OL]" | "[UL]",
  imageIndex: Map<string, QuestionImportImageInput>,
) {
  Array.from(list.children).forEach((child) => {
    if (child instanceof HTMLLIElement) {
      const lineParts: string[] = [];
      appendMergedInlineText(lineParts, collectInlineParts(child, imageIndex));
      if (lineParts[0]) {
        target.push(`${marker} ${lineParts[0]}`);
      }
      for (const extra of lineParts.slice(1)) {
        target.push(extra);
      }
    }
  });
  target.push("");
}

export function htmlToImportText(html: string, images: QuestionImportImageInput[] = []): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const parts: string[] = [];
  const imageIndex = new Map(images.map((image) => [image.image_id, image]));
  let tableCount = 0;

  const visitNode = (node: ChildNode) => {
    if (node instanceof HTMLTableElement) {
      tableCount += 1;
      parts.push(`[TABLE:${tableCount}]`);
      parts.push("");
      return;
    }

    if (node instanceof HTMLParagraphElement || /^H[1-6]$/.test(node.nodeName)) {
      appendMergedInlineText(parts, collectInlineParts(node, imageIndex));
      parts.push("");
      return;
    }

    if (node instanceof HTMLOListElement) {
      appendListItems(parts, node, "[OL]", imageIndex);
      return;
    }

    if (node instanceof HTMLUListElement) {
      appendListItems(parts, node, "[UL]", imageIndex);
      return;
    }

    if (node instanceof HTMLImageElement) {
      appendMergedInlineText(parts, collectInlineParts(node, imageIndex));
      parts.push("");
      return;
    }

    if (node instanceof HTMLElement) {
      Array.from(node.childNodes).forEach(visitNode);
      if (node instanceof HTMLDivElement) {
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

export function extractHtmlTables(html: string): QuestionImportTableInput[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.querySelectorAll("table"))
    .map((table, index) => {
      const rows = Array.from(table.querySelectorAll("tr"))
        .map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
        )
        .filter((row) => row.some(Boolean));
      return { order: index + 1, rows };
    })
    .filter((table) => table.rows.length > 0);
}

export function buildAnswerPayload(type: QuestionType, answerText: string | null) {
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
      const contentHtml = buildImportContentHtml(draft.content_text, draft.images ?? []);
      return {
        type: draft.type,
        title,
        content: {
          text: stripHtmlForTitle(draft.content_text),
          html: contentHtml,
        },
        options: draft.type === "choice" ? draft.options : null,
        answer: buildAnswerPayload(draft.type, draft.answer_text),
        analysis: draft.analysis || null,
        difficulty: clampedDifficulty,
        score: 10,
        tag_ids: [],
        knowledge_point_ids: draft.suggested_knowledge_points?.map((kp) => kp.id) ?? [],
        question_bank_id: questionBankId,
      };
    });
}

export function buildImportContentHtml(
  contentText: string,
  images: QuestionImportImageInput[] = [],
): string {
  const baseHtml = importTextToHtml(contentText);
  if (images.length === 0) {
    return baseHtml;
  }

  const imageHtml = images
    .map((image) => {
      const alt = escapeHtml(image.alt?.trim() || "题目图片");
      const src = escapeHtml(image.url);
      return `<img src="${src}" alt="${alt}" data-image-id="${escapeHtml(image.image_id)}" />`;
    })
    .join("");

  return `${baseHtml}${imageHtml}`;
}

export function generateImportQuestionTitle(contentText: string): string {
  const normalized = stripHtmlForTitle(contentText).replace(/\s+/g, " ").trim();
  return normalized.slice(0, 120) || "未命名题目";
}

const TABLE_LINE_REGEX = /^\|.*\|$/;

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(rowLines: string[]): string {
  const rows = rowLines.map(parseMarkdownTableRow);
  const separatorIndex = rows.findIndex(isTableSeparatorRow);

  const headerRows = separatorIndex > 0 ? rows.slice(0, separatorIndex) : [];
  const bodyRows = separatorIndex >= 0 ? rows.slice(separatorIndex + 1) : rows;

  const renderRow = (cells: string[], tag: "th" | "td") =>
    `<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;

  const thead = headerRows.length
    ? `<thead>${headerRows.map((cells) => renderRow(cells, "th")).join("")}</thead>`
    : "";
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows.map((cells) => renderRow(cells, "td")).join("")}</tbody>`
    : "";

  return `<table>${thead}${tbody}</table>`;
}

export function importTextToHtml(contentText: string): string {
  const lines = contentText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parts: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (TABLE_LINE_REGEX.test(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && TABLE_LINE_REGEX.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      parts.push(renderMarkdownTable(tableLines));
      continue;
    }
    if (/^<img\s/i.test(line)) {
      parts.push(line);
    } else {
      parts.push(`<p>${escapeHtml(line)}</p>`);
    }
    index += 1;
  }
  return parts.join("");
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
  const incomplete_choice_count = drafts.filter(
    (draft) => draft.type === "choice" && draft.issues.includes("选择题选项不完整"),
  ).length;
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
    incomplete_choice_count,
    visual_retry_recommended: false,
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

// ============================================================
// Client-side template parsing — for large documents that
// exceed the backend's raw_text / images limits.
// ============================================================

export const RAW_TEXT_MAX_CHARS = 1_000_000;
export const IMAGES_MAX_COUNT = 500;

const DIFFICULTY_MAP: Record<string, number> = {
  "很容易": 1, "容易": 2, "一般": 3, "困难": 4, "很难": 5,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5,
};

const TYPE_MAP: Record<string, QuestionType> = {
  "选择题": "choice",
  "判断题": "true_false",
  "填空题": "fill_in",
  "简答题": "short_answer",
  "论述题": "essay",
  "编程题": "code",
};

function normalizeChineseLabel(line: string, label: string): string | null {
  // Match "[标签] value" or "标签：value" or "标签: value"
  const bracket = new RegExp(`^\\[${label}\\]\\s*(.*)`, "i");
  const colon = new RegExp(`^${label}[：:]\\s*(.*)`);
  const match = line.match(bracket) ?? line.match(colon);
  return match ? match[1].trim() : null;
}

function parseDifficulty(text: string): number {
  return DIFFICULTY_MAP[text] ?? 3; // default 一般
}

function parseType(text: string): QuestionType {
  for (const [key, value] of Object.entries(TYPE_MAP)) {
    if (text.includes(key)) return value;
  }
  return "short_answer";
}

export function parseTemplateQuestions(rawText: string): QuestionImportDraft[] {
  // Split into question blocks by blank-line-separated groups
  // or by "[题型]" / "题型：" markers.
  const blocks = rawText
    .split(/(?:\n\s*\n)+/)
    .map((b) => b.trim())
    .filter(Boolean);

  // Re-join blocks that don't start with a type marker — they belong
  // to the previous block (e.g. continuation lines).
  const merged: string[] = [];
  for (const block of blocks) {
    const startsWithType =
      /^\[题型\]|^题型[：:]/.test(block);
    if (startsWithType || merged.length === 0) {
      merged.push(block);
    } else {
      merged[merged.length - 1] += "\n" + block;
    }
  }

  const drafts: QuestionImportDraft[] = [];
  let draftIndex = 0;

  for (const block of merged) {
    const lines = block.split(/\n/);
    let type: QuestionType = "short_answer";
    let contentText = "";
    const options: Record<string, string> = {};
    let answerText: string | null = null;
    let analysis: string | null = null;
    let difficulty = 3;
    const contentLines: string[] = [];
    let inContent = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Type
      const typeVal =
        normalizeChineseLabel(line, "题型");
      if (typeVal !== null) {
        type = parseType(typeVal);
        inContent = false;
        continue;
      }

      // Difficulty
      const diffVal = normalizeChineseLabel(line, "难度");
      if (diffVal !== null) {
        difficulty = parseDifficulty(diffVal);
        inContent = false;
        continue;
      }

      // Answer
      const answerVal = normalizeChineseLabel(line, "答案");
      if (answerVal !== null) {
        answerText = answerVal;
        inContent = false;
        continue;
      }

      // Analysis
      const analysisVal = normalizeChineseLabel(line, "解析");
      if (analysisVal !== null) {
        analysis = analysisVal;
        inContent = false;
        continue;
      }

      // Content
      const contentVal = normalizeChineseLabel(line, "题目内容");
      if (contentVal !== null) {
        contentText = contentVal;
        inContent = true;
        continue;
      }

      // Choice options: A. text / B. text / etc.
      const optionMatch = line.match(/^([A-H])[.、．]\s*(.+)/);
      if (optionMatch && type === "choice") {
        options[optionMatch[1]] = optionMatch[2];
        inContent = false;
        continue;
      }

      // Accumulate multi-line content
      if (inContent) {
        contentLines.push(line);
      }
    }

    // Build content_text from parsed content
    const fullContent = contentText
      ? [contentText, ...contentLines].join("\n").trim()
      : contentLines.join("\n").trim();
    if (!fullContent && !answerText) continue; // skip empty blocks

    const draftId = `client-parse-${draftIndex + 1}`;
    draftIndex += 1;

    const resultContentText = fullContent || contentText || "未命名题目";
    const resultOptions =
      type === "choice" && Object.keys(options).length > 0 ? { ...options } : null;

    const issues: string[] = [];
    if (!answerText) {
      issues.push("未识别到答案");
    }
    if (type === "choice" && Object.keys(options).length < 2) {
      issues.push("选择题选项不足");
    }

    drafts.push({
      draft_id: draftId,
      raw_text: block,
      title: generateImportQuestionTitle(resultContentText),
      type,
      content_text: resultContentText,
      options: resultOptions,
      answer_text: answerText,
      analysis,
      difficulty,
      segment_source: "client-template",
      type_confidence: "high",
      boundary_confidence: "high",
      issues,
      review_status: "pending",
      review_required: issues.length > 0,
    });
  }

  return drafts;
}

// ============================================================
// Inline exam question parser — handles "学习通练习" style
// where questions, options, and analysis are all inline:
//   第 X 题 ：... A. opt B. opt ... 解析 ：...
// ============================================================

const INLINE_QUESTION_RE = /第\s*(\d+)\s*题\s*[：:.]?/g;
// Option markers: letter followed by . or 、or ． — may be run-on without spaces
// in multi-select formats like "A. textB. textC. text"
const OPTION_MARKER_RE = /([A-H])[.、．]\s*/g;

function parseInlineBlock(text: string): QuestionImportDraft | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  let bodyText = cleaned;

  // --- Extract ✅ 正确答案：X ---
  let answerText: string | null = null;
  const answerMatch = bodyText.match(/✅\s*正确答案[：:]\s*([A-H]+)/i);
  if (answerMatch) {
    answerText = answerMatch[1];
    bodyText = bodyText.replace(answerMatch[0], "");
  }

  // --- Extract 答案：X ---
  if (!answerText) {
    const m = bodyText.match(/答案[：:]\s*([A-H]+)/i);
    if (m) {
      answerText = m[1];
      bodyText = bodyText.replace(m[0], "");
    }
  }

  // --- Split at 解析 marker ---
  let analysis: string | null = null;
  const analysisIdx = bodyText.search(/解析\s*[：:]/);
  if (analysisIdx !== -1) {
    const after = bodyText.slice(analysisIdx);
    const rest = after.replace(/^解析\s*[：:]\s*/, "");
    // Analysis ends at next 第X题 marker, answer marker, or end
    const endIdx = rest.search(/第\s*\d+\s*题|✅|答案[：:]/);
    analysis = (endIdx === -1 ? rest : rest.slice(0, endIdx)).trim();
    bodyText = bodyText.slice(0, analysisIdx).trim();
  }

  // --- Detect options by finding all [A-H]. markers ---
  // Use a scan approach: find positions of all option markers
  const markers: Array<{ letter: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const markerRe = new RegExp(OPTION_MARKER_RE.source, "g");
  while ((m = markerRe.exec(bodyText)) !== null) {
    markers.push({ letter: m[1], start: m.index, end: m.index + m[0].length });
  }

  // Only treat as choice if there are enough sequential option markers (A, B, C, ...)
  // and the first marker is A or the letters form a consecutive sequence
  const hasOptions =
    markers.length >= 2 &&
    (markers[0].letter === "A" ||
      markers.every(
        (mk, i) =>
          i === 0 ||
          mk.letter.charCodeAt(0) === markers[i - 1].letter.charCodeAt(0) + 1,
      ));

  const questionType: QuestionType = hasOptions ? "choice" : "short_answer";

  // --- Extract question content ---
  let contentText: string;
  const optionValues: Record<string, string> = {};

  if (hasOptions) {
    // Content is everything before the first option marker
    contentText = bodyText.slice(0, markers[0].start).trim();
    // Clean trailing colon
    contentText = contentText.replace(/[：:]\s*$/, "").trim();

    // Extract option values: text between consecutive markers
    for (let i = 0; i < markers.length; i++) {
      const valStart = markers[i].end;
      const valEnd = i < markers.length - 1 ? markers[i + 1].start : bodyText.length;
      const raw = bodyText.slice(valStart, valEnd).trim();
      optionValues[markers[i].letter] = raw;
    }
  } else {
    contentText = bodyText;
  }

  // Clean up content
  contentText = contentText.replace(/——.+$/, "").trim();
  if (!contentText && !hasOptions) return null;

  // --- Try to extract answer from analysis text (heuristic) ---
  // Don't auto-remove the "未识别到答案" issue — the heuristic may be wrong;
  // instead just set answer_text for teacher review convenience.
  if (!answerText && analysis) {
    const hints: Array<RegExp> = [
      // Strong signals: explicit answer markers
      /[故应则均]+[应]?[选]择?\s*([A-H])/,
      /答案[为是]\s*([A-H])/,
      /正确选项[为是]?\s*([A-H])/,
      /正确答案[为是]?\s*([A-H])/,
      /应?选择\s*([A-H])[项]?\s*[，。]/,
      // （X）only when preceded by "正确"/"首选" indicators
      /(?:正确|首选)[^。]*(?:[（(]\s*([A-H])\s*[）)])/,
      // "选X。" at sentence end
      /选\s*([A-H])\s*[。，]/,
    ];
    for (const hint of hints) {
      const m = analysis.match(hint);
      if (m) {
        answerText = m[1];
        break;
      }
    }
  }

  const draftId = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const issues: string[] = [];
  if (!answerText) issues.push("未识别到答案");
  if (hasOptions && markers.length < 2) issues.push("选择题选项不足");

  return {
    draft_id: draftId,
    raw_text: cleaned,
    title: generateImportQuestionTitle(contentText),
    type: questionType,
    content_text: contentText,
    options: hasOptions ? { ...optionValues } : null,
    answer_text: answerText,
    analysis,
    difficulty: 3,
    segment_source: "client-inline",
    type_confidence: "high",
    boundary_confidence: "high",
    issues,
    review_status: "pending",
    review_required: issues.length > 0,
  };
}

export function parseInlineExamQuestions(rawText: string): QuestionImportDraft[] {
  // Split text into question blocks using 第 X 题 markers
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  let lastEnd = 0;

  const re = new RegExp(INLINE_QUESTION_RE.source, "g");
  while ((match = re.exec(rawText)) !== null) {
    if (blocks.length > 0) {
      blocks[blocks.length - 1] += rawText.slice(lastEnd, match.index);
    }
    blocks.push(match[0]);
    lastEnd = match.index + match[0].length;
  }
  if (blocks.length > 0) {
    blocks[blocks.length - 1] += rawText.slice(lastEnd);
  }

  const drafts: QuestionImportDraft[] = [];
  for (const block of blocks) {
    const body = block.replace(/^第\s*\d+\s*题\s*[：:.]?\s*/, "").trim();
    if (!body) continue;
    const draft = parseInlineBlock(body);
    if (draft) drafts.push(draft);
  }

  return drafts;
}

export function detectInlineExamFormat(rawText: string): boolean {
  let count = 0;
  const re = new RegExp(INLINE_QUESTION_RE.source, "g");
  while (re.exec(rawText) !== null) count += 1;
  if (count < 2) return false;
  const sample = rawText.slice(0, 5000);
  return /[A-E][.、．]\s*\S/.test(sample) && /解析\s*[：:]/.test(sample);
}

export function exceedsBackendImportLimits(
  _rawText: string,
  _images: unknown[] = [],
): boolean {
  return false;
}

// ============================================================
// JSON question import parser
// ============================================================

interface JsonQuestionImage {
  page?: number;
  source?: string;
  filename: string;
  position?: string;
  description?: string;
}

interface JsonQuestion {
  id?: string | number;
  type?: string;
  content?: string;
  title?: string;
  options?: Record<string, string>;
  answer?: string | string[] | boolean | Record<string, unknown>;
  analysis?: string;
  difficulty?: number;
  score?: number;
  images?: JsonQuestionImage[];
}

const JSON_TYPE_MAP: Record<string, QuestionType> = {
  single_choice: "choice",
  multiple_choice: "choice",
  choice: "choice",
  true_false: "true_false",
  fill_in: "fill_in",
  short_answer: "short_answer",
  essay: "essay",
  code: "code",
};

function buildJsonAnswerPayload(
  type: QuestionType,
  answer: JsonQuestion["answer"],
): string | null {
  if (answer === undefined || answer === null) return null;
  if (typeof answer === "boolean") return String(answer);
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.join("、");
  if (typeof answer === "object") {
    if (type === "fill_in" && Array.isArray((answer as Record<string, unknown>).correct)) {
      return ((answer as Record<string, unknown>).correct as string[]).join("；");
    }
    if (Array.isArray((answer as Record<string, unknown>).points)) {
      return ((answer as Record<string, unknown>).points as string[]).join("\n");
    }
    return JSON.stringify(answer);
  }
  return null;
}

function mapJsonImages(images: JsonQuestionImage[]): QuestionImportImageInput[] {
  return images.map((img, i) => ({
    image_id: `json-img-${img.filename.replace(/[^a-zA-Z0-9]/g, "-")}-${i}`,
    url: img.filename, // placeholder — user uploads real images later
    order: i + 1,
    page: img.page,
    alt: img.description || img.filename,
  }));
}

export function parseJsonQuestions(
  jsonText: string,
): { drafts: QuestionImportDraft[]; unresolvedImages: JsonQuestionImage[] } {
  const parsed = JSON.parse(jsonText);
  // Support both bare arrays and wrapper objects like { questions: [...], metadata: {...} }
  const rawItems: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.questions)
      ? parsed.questions
      : [parsed];
  const items = rawItems.filter(
    (item): item is JsonQuestion => Boolean(item) && typeof item === "object",
  );

  const drafts: QuestionImportDraft[] = [];
  const unresolvedImages: JsonQuestionImage[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    if (!item.content && !item.title) continue;

    const questionType: QuestionType = JSON_TYPE_MAP[item.type || ""] || "short_answer";
    const contentText = item.content || item.title || "";
    const answerText = buildJsonAnswerPayload(questionType, item.answer);

    const images = item.images || [];
    if (images.length > 0) {
      unresolvedImages.push(...images);
    }

    const issues: string[] = [];
    if (!answerText) issues.push("未识别到答案");

    const draftId = `json-${item.id || i + 1}`;

    drafts.push({
      draft_id: draftId,
      raw_text: JSON.stringify(item, null, 2),
      title: generateImportQuestionTitle(contentText),
      type: questionType,
      content_text: contentText,
      options: item.options && Object.keys(item.options).length >= 2 ? { ...item.options } : null,
      answer_text: answerText,
      analysis: item.analysis || null,
      difficulty: Math.min(5, Math.max(1, Math.round(item.difficulty || 3))),
      images: mapJsonImages(images),
      segment_source: "client-json",
      type_confidence: "high",
      boundary_confidence: "high",
      issues,
      review_status: "pending",
      review_required: issues.length > 0 || images.length > 0,
    });
  }

  return { drafts, unresolvedImages };
}
