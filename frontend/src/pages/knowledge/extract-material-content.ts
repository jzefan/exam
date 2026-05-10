/**
 * 从课程学习资料文件中抽取多模态内容（文本 + 图片 dataURL），用于多模态智能出题。
 *
 * 支持格式：pdf / docx / pptx
 * - pdf：每页全页渲染为 JPEG dataURL，同时抽页内文本
 * - docx：mammoth 抽文本 + 嵌入图片
 * - pptx：unzip 解析每张幻灯片文本 + ppt/media 下的全部嵌入图
 *
 * 旧二进制 .doc / .ppt 不支持，抛出明确错误引导用户转换。
 */

const MAX_PAGES = 50;
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.7;

export interface ExtractedMaterialContent {
  text: string;
  images: string[]; // data URLs (JPEG / PNG / GIF)
  pageCount: number;
  truncated: boolean; // pages/images was clipped at MAX_PAGES
}

export interface MaterialFormatRejection {
  /** 用户友好的中文错误说明，可直接展示。 */
  message: string;
}

export class UnsupportedMaterialFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMaterialFormatError";
  }
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

async function canvasToJpegDataURL(canvas: HTMLCanvasElement): Promise<string> {
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

async function bytesToDataURL(bytes: Uint8Array, mimeType: string): Promise<string> {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function extractFromPdf(file: File): Promise<ExtractedMaterialContent> {
  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const pageCount = pdf.numPages;
  const pagesToProcess = Math.min(pageCount, MAX_PAGES);
  const truncated = pageCount > MAX_PAGES;

  const textChunks: string[] = [];
  const images: string[] = [];

  for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (pageText) textChunks.push(`--- 第 ${pageNumber} 页 ---\n${pageText}`);

    const baseViewport = page.getViewport({ scale: 1 });
    const longEdge = Math.max(baseViewport.width, baseViewport.height);
    const scale = longEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longEdge : 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF 渲染失败：无法创建画布");

    // pdfjs v5 deprecated `canvasContext`+`viewport` shape but still accepts legacy form.
    await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
    images.push(await canvasToJpegDataURL(canvas));
  }

  return {
    text: textChunks.join("\n\n"),
    images,
    pageCount,
    truncated,
  };
}

async function extractFromDocx(file: File): Promise<ExtractedMaterialContent> {
  const mammoth = await import("mammoth");
  const images: string[] = [];

  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        if (images.length >= MAX_PAGES) return { src: "" };
        const buffer = await image.read("base64");
        const dataUrl = `data:${image.contentType};base64,${buffer}`;
        images.push(dataUrl);
        return { src: dataUrl };
      }),
    },
  );

  const text = await mammoth
    .extractRawText({ arrayBuffer: await file.arrayBuffer() })
    .then((res) => res.value.trim())
    .catch(() => result.value.replace(/<[^>]+>/g, " ").trim());

  return {
    text,
    images,
    pageCount: images.length,
    truncated: false,
  };
}

async function extractFromPptx(file: File): Promise<ExtractedMaterialContent> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const numB = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return numA - numB;
    });
  const slideCount = slideFiles.length;
  const slidesToProcess = Math.min(slideCount, MAX_PAGES);

  const textChunks: string[] = [];
  for (let i = 0; i < slidesToProcess; i += 1) {
    const xml = await zip.file(slideFiles[i])!.async("string");
    const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
    const slideText = matches
      .map((m) => m.replace(/<a:t[^>]*>/, "").replace(/<\/a:t>/, ""))
      .join(" ")
      .trim();
    if (slideText) textChunks.push(`--- 幻灯片 ${i + 1} ---\n${slideText}`);
  }

  const mediaEntries = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/.+\.(png|jpe?g|gif|bmp)$/i.test(name),
  );
  mediaEntries.sort();

  const images: string[] = [];
  for (const name of mediaEntries) {
    if (images.length >= MAX_PAGES) break;
    const ext = getExtension(name);
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "bmp"
            ? "image/bmp"
            : "image/jpeg";
    const bytes = await zip.file(name)!.async("uint8array");
    images.push(await bytesToDataURL(bytes, mimeType));
  }

  return {
    text: textChunks.join("\n\n"),
    images,
    pageCount: slideCount,
    truncated: slideCount > MAX_PAGES || mediaEntries.length > MAX_PAGES,
  };
}

export async function extractMaterialContent(file: File): Promise<ExtractedMaterialContent> {
  const ext = getExtension(file.name);
  if (ext === "pdf") return extractFromPdf(file);
  if (ext === "docx") return extractFromDocx(file);
  if (ext === "pptx") return extractFromPptx(file);
  if (ext === "doc" || ext === "ppt") {
    throw new UnsupportedMaterialFormatError(
      `暂不支持 .${ext} 旧二进制格式，请先在 Office/WPS 中另存为 .${ext}x 后重新上传。`,
    );
  }
  throw new UnsupportedMaterialFormatError(
    "仅支持 PDF / Word(.docx) / PowerPoint(.pptx) 文件用于智能出题。",
  );
}

export const MATERIAL_PAGE_LIMIT = MAX_PAGES;
