// Shared paper-recognition pipeline used by the 导入试卷 page and by 种子题 import.
//
// Standard exam papers (with covers, headers, answer cards, score grids) are
// recognized via the /papers/import endpoints, which are tuned to skip那些非题目
// 的版式元素并保留真题的题干/选项/答案/解析。PDF/Word(docx) 优先上传原文件，
// 让后端按题型章节与题号边界稳定切题；视觉识别必须显式启用，避免题目数量漂移。

import type {
  QuestionImportImageInput,
  QuestionImportTableInput,
} from "@/pages/questions/import-types";
import { extractQuestionImportPayload } from "@/pages/questions/import-utils";
import type { IPaperImportRecognizeResponse } from "@/types";

import { paperApiRequest } from "./api";

export type ImportDocumentPayload = {
  fileName: string;
  rawText: string;
  sourceFormat: "pdf" | "docx" | "md";
  images: QuestionImportImageInput[];
  tables?: QuestionImportTableInput[];
  originalFile?: File;
};

export type RecognizePaperPayloadOptions = {
  rootKnowledgePointId?: string | null;
  allowPdfImageFallback?: boolean;
};

export const PAPER_IMPORT_MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024;
const PAPER_PDF_PAGE_IMAGE_QUALITY = 0.92;
const PAPER_PDF_PAGE_IMAGE_MAX_EDGE = 2048;

const RECOGNITION_PROMPT =
  "请直接识别试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。";

export async function extractPaperImportPayload(
  file: File,
): Promise<ImportDocumentPayload> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "pdf") {
    return {
      fileName: file.name,
      rawText: file.name,
      sourceFormat: "pdf",
      images: [],
      tables: [],
      originalFile: file,
    };
  }

  if (extension === "docx") {
    // Word 原件直接交给后端 python-docx 解析（与题库导入一致）。客户端 mammoth
    // 只在后端文件识别失败时按需加载，避免试卷导入强依赖一个仅在交互时才会
    // 拉取的动态 chunk。
    return {
      fileName: file.name,
      rawText: "",
      sourceFormat: "docx",
      images: [],
      tables: [],
      originalFile: file,
    };
  }

  const payload = await extractQuestionImportPayload(file);
  if (payload.sourceFormat === "json" || payload.sourceFormat === "zip") {
    throw new Error(
      "试卷导入暂不支持 JSON 或 ZIP 文件，请上传 PDF、Word(docx) 或 Markdown 文件。",
    );
  }
  return {
    fileName: file.name,
    rawText: payload.rawText,
    sourceFormat: payload.sourceFormat,
    images: payload.images,
    tables: payload.tables,
    originalFile: file,
  };
}

async function extractPdfImagePayload(file: File): Promise<ImportDocumentPayload> {
  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] =
    await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const images: QuestionImportImageInput[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(
        1.5,
        PAPER_PDF_PAGE_IMAGE_MAX_EDGE /
          Math.max(baseViewport.width, baseViewport.height),
      ),
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("PDF 渲染失败");
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const imageId = `page-${pageNumber}`;
    images.push({
      image_id: imageId,
      url: canvas.toDataURL("image/jpeg", PAPER_PDF_PAGE_IMAGE_QUALITY),
      order: pageNumber,
      page: pageNumber,
      alt: `第 ${pageNumber} 页`,
    });
  }

  return {
    fileName: file.name,
    rawText: images.map((image) => `[IMAGE:${image.image_id}]`).join("\n"),
    sourceFormat: "pdf",
    images,
    tables: [],
    originalFile: file,
  };
}

export async function recognizePaperPayload(
  payload: ImportDocumentPayload,
  options: RecognizePaperPayloadOptions = {},
): Promise<IPaperImportRecognizeResponse> {
  if ((payload.sourceFormat === "docx" || payload.sourceFormat === "pdf") && payload.originalFile) {
    const formData = new FormData();
    formData.append("file", payload.originalFile);
    formData.append(
      "prompt",
      "请直接识别试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。",
    );
    if (options.rootKnowledgePointId) {
      formData.append("root_knowledge_point_id", options.rootKnowledgePointId);
    }
    try {
      return await paperApiRequest<IPaperImportRecognizeResponse>(
        "/papers/import/recognize-file",
        { method: "POST", body: formData },
      );
    } catch (error) {
      if (payload.sourceFormat === "docx" && payload.originalFile) {
        // 后端 Word 识别失败时，回退到客户端解析后再走文本识别。
        try {
          const extracted = await extractQuestionImportPayload(payload.originalFile);
          return recognizePaperPayloadAsJson(
            {
              ...payload,
              rawText: extracted.rawText,
              images: extracted.images,
              tables: extracted.tables,
            },
            options,
          );
        } catch {
          throw error;
        }
      }
      if (payload.sourceFormat !== "pdf" || !options.allowPdfImageFallback) {
        throw error;
      }
      return recognizePaperPayloadAsJson(await extractPdfImagePayload(payload.originalFile), options);
    }
  }
  return recognizePaperPayloadAsJson(payload, options);
}

function recognizePaperPayloadAsJson(
  payload: ImportDocumentPayload,
  options: RecognizePaperPayloadOptions = {},
): Promise<IPaperImportRecognizeResponse> {
  return paperApiRequest<IPaperImportRecognizeResponse>(
    "/papers/import/recognize",
    {
      method: "POST",
      body: JSON.stringify({
        file_name: payload.fileName,
        raw_text: payload.rawText,
        source_format: payload.sourceFormat,
        root_knowledge_point_id: options.rootKnowledgePointId ?? null,
        images: payload.images ?? [],
        tables: payload.tables ?? [],
        recognition_prompt: RECOGNITION_PROMPT,
      }),
    },
  );
}
