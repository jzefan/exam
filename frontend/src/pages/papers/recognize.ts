// Shared paper-recognition pipeline used by the 导入试卷 page and by 种子题 import.
//
// Standard exam papers (with covers, headers, answer cards, score grids) are
// recognized via the /papers/import endpoints, which are tuned to skip那些非题目
// 的版式元素并保留真题的题干/选项/答案/解析。PDF 渲染成整页图走多模态识别，
// Word(docx) 直接上传原文件走多模态，其余走纯文本识别。

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

export const PAPER_IMPORT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PAPER_PDF_PAGE_IMAGE_QUALITY = 0.92;
const PAPER_PDF_PAGE_IMAGE_MAX_EDGE = 2048;

const RECOGNITION_PROMPT =
  "请直接识别试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。";

export async function extractPaperImportPayload(
  file: File,
): Promise<ImportDocumentPayload> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf") {
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
): Promise<IPaperImportRecognizeResponse> {
  if (payload.sourceFormat === "docx" && payload.originalFile) {
    const formData = new FormData();
    formData.append("file", payload.originalFile);
    formData.append(
      "prompt",
      "请直接识别 Word 试卷中的真实题目。保留题干、选项、答案和解析，不要把封面、题型标题、题号表、答题卡或得分栏当成题目。",
    );
    return paperApiRequest<IPaperImportRecognizeResponse>(
      "/papers/import/recognize-file",
      { method: "POST", body: formData },
    );
  }
  return paperApiRequest<IPaperImportRecognizeResponse>(
    "/papers/import/recognize",
    {
      method: "POST",
      body: JSON.stringify({
        file_name: payload.fileName,
        raw_text: payload.rawText,
        source_format: payload.sourceFormat,
        root_knowledge_point_id: null,
        images: payload.images ?? [],
        tables: payload.tables ?? [],
        recognition_prompt: RECOGNITION_PROMPT,
      }),
    },
  );
}
