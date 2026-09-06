import { createRandomId } from "@/lib/random-id";

export type CatalogPhotoImage = {
  id: string;
  name: string;
  src: string;
};

export const DEFAULT_CATALOG_IMAGE_MAX_EDGE = 2048;
const DEFAULT_CATALOG_IMAGE_QUALITY = 0.92;
const CATALOG_COLUMN_ANALYSIS_MAX_WIDTH = 360;
const CATALOG_COLUMN_ANALYSIS_MAX_HEIGHT = 720;
const CATALOG_COLUMN_BODY_TOP_RATIO = 0.18;
const CATALOG_COLUMN_BODY_BOTTOM_RATIO = 0.96;
const CATALOG_COLUMN_DEFAULT_CROP_TOP_RATIO = 0.08;
const CATALOG_COLUMN_LARGE_HEADER_CROP_TOP_RATIO = 0.13;
const CATALOG_COLUMN_LARGE_HEADER_MIN_COVERAGE = 0.55;
const CATALOG_RIGHT_COLUMN_FOCUS_TOP_RATIO = 0.2;
const CATALOG_RIGHT_COLUMN_FOCUS_HEIGHT_RATIO = 0.32;
const CATALOG_COLUMN_MIN_GUTTER_RATIO = 0.025;
const CATALOG_COLUMN_MAX_GUTTER_INK_RATIO = 0.018;
const CATALOG_COLUMN_SIDE_MIN_INK_RATIO = 0.006;
const CATALOG_PDF_RENDER_MAX_SCALE = 2.5;

export function scaleDimensionsToMaxEdge(width: number, height: number, maxEdge = DEFAULT_CATALOG_IMAGE_MAX_EDGE) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width, height, scale: 1 };
  }

  const scale = Number((maxEdge / longestEdge).toFixed(4));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("文件读取失败"));
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = dataUrl;
  });
}

export function findCatalogTwoColumnSplit(
  inkByColumn: number[],
  sampledRowCount: number,
): number | null {
  const width = inkByColumn.length;
  const minCandidateX = Math.floor(width * 0.32);
  const maxCandidateX = Math.ceil(width * 0.68);
  const maxGutterInk = sampledRowCount * CATALOG_COLUMN_MAX_GUTTER_INK_RATIO;
  const minGutterWidth = Math.max(4, Math.round(width * CATALOG_COLUMN_MIN_GUTTER_RATIO));

  let best: { end: number; start: number } | null = null;
  let runStart: number | null = null;

  for (let x = minCandidateX; x <= maxCandidateX; x += 1) {
    if (inkByColumn[x] <= maxGutterInk) {
      runStart ??= x;
      continue;
    }
    if (runStart !== null && x - runStart >= minGutterWidth) {
      if (!best || x - runStart > best.end - best.start) {
        best = { start: runStart, end: x };
      }
    }
    runStart = null;
  }

  if (runStart !== null && maxCandidateX + 1 - runStart >= minGutterWidth) {
    const end = maxCandidateX + 1;
    if (!best || end - runStart > best.end - best.start) {
      best = { start: runStart, end };
    }
  }

  if (!best) return null;

  const hasEnoughInk = (start: number, end: number) => {
    const ink = inkByColumn.slice(start, end).reduce((total, value) => total + value, 0);
    return ink / ((end - start) * sampledRowCount) >= CATALOG_COLUMN_SIDE_MIN_INK_RATIO;
  };

  if (!hasEnoughInk(0, best.start) || !hasEnoughInk(best.end, width)) {
    return null;
  }

  return Math.round((best.start + best.end) / 2);
}

export function hasWideCatalogHeader(inkByColumn: number[]): boolean {
  if (inkByColumn.length === 0) return false;
  const inkedColumnCount = inkByColumn.filter((ink) => ink > 0).length;
  return inkedColumnCount / inkByColumn.length >= CATALOG_COLUMN_LARGE_HEADER_MIN_COVERAGE;
}

export function getCatalogRightColumnFocusCropRange(
  sourceHeight: number,
  fullColumnCropTop: number,
  hasLargeHeader: boolean,
) {
  const startY = hasLargeHeader
    ? Math.max(fullColumnCropTop, Math.round(sourceHeight * CATALOG_RIGHT_COLUMN_FOCUS_TOP_RATIO))
    : fullColumnCropTop;
  const height = Math.min(
    sourceHeight - startY,
    Math.round(sourceHeight * CATALOG_RIGHT_COLUMN_FOCUS_HEIGHT_RATIO),
  );
  return { startY, height };
}

function hasLargeCatalogHeader(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  // The first catalog page often has a large decorative title (for example,
  // “CONTENTS”), while later pages place their first real entry much higher.
  // Detect the wide title rather than applying the deeper crop to every page.
  const headerEndY = Math.max(1, Math.round(height * CATALOG_COLUMN_DEFAULT_CROP_TOP_RATIO));
  const headerInkByColumn = Array.from({ length: width }, () => 0);

  for (let x = 0; x < width; x += 1) {
    let hasInk = false;
    for (let y = 0; y < headerEndY; y += 1) {
      const pixelOffset = (y * width + x) * 4;
      const brightness =
        pixels[pixelOffset] * 0.299 +
        pixels[pixelOffset + 1] * 0.587 +
        pixels[pixelOffset + 2] * 0.114;
      if (pixels[pixelOffset + 3] > 0 && brightness < 225) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) headerInkByColumn[x] = 1;
  }

  return hasWideCatalogHeader(headerInkByColumn);
}

async function splitCatalogImageForReadingOrder(imageSource: string): Promise<string[]> {
  const image = await loadImageElement(imageSource);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth === 0 || sourceHeight === 0) return [imageSource];

  const analysisScale = Math.min(
    1,
    CATALOG_COLUMN_ANALYSIS_MAX_WIDTH / sourceWidth,
    CATALOG_COLUMN_ANALYSIS_MAX_HEIGHT / sourceHeight,
  );
  const analysisWidth = Math.max(1, Math.round(sourceWidth * analysisScale));
  const analysisHeight = Math.max(1, Math.round(sourceHeight * analysisScale));
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = analysisWidth;
  analysisCanvas.height = analysisHeight;
  const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!analysisContext) return [imageSource];

  analysisContext.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const pixels = analysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const startY = Math.floor(analysisHeight * CATALOG_COLUMN_BODY_TOP_RATIO);
  const endY = Math.max(startY + 1, Math.ceil(analysisHeight * CATALOG_COLUMN_BODY_BOTTOM_RATIO));
  const sampledRowCount = endY - startY;
  const inkByColumn = Array.from({ length: analysisWidth }, () => 0);

  for (let y = startY; y < endY; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      const pixelOffset = (y * analysisWidth + x) * 4;
      const brightness =
        pixels[pixelOffset] * 0.299 +
        pixels[pixelOffset + 1] * 0.587 +
        pixels[pixelOffset + 2] * 0.114;
      if (pixels[pixelOffset + 3] > 0 && brightness < 225) {
        inkByColumn[x] += 1;
      }
    }
  }

  const splitX = findCatalogTwoColumnSplit(inkByColumn, sampledRowCount);
  if (splitX === null) return [imageSource];

  const sourceSplitX = Math.round((splitX / analysisWidth) * sourceWidth);
  const overlap = Math.max(4, Math.round(sourceWidth * 0.008));
  // Only the decorative first-page header gets the deeper crop. Continuation
  // pages can start with a real item close to the top (such as 4.1.3), so a
  // universal crop here would remove that item before it reaches the model.
  const hasLargeHeader = hasLargeCatalogHeader(pixels, analysisWidth, analysisHeight);
  const cropTopRatio = hasLargeHeader
    ? CATALOG_COLUMN_LARGE_HEADER_CROP_TOP_RATIO
    : CATALOG_COLUMN_DEFAULT_CROP_TOP_RATIO;
  const cropTop = Math.round(sourceHeight * cropTopRatio);
  const cropHeight = sourceHeight - cropTop;
  const rightStartX = Math.max(0, sourceSplitX - overlap);
  const leftColumnWidth = Math.min(sourceWidth, sourceSplitX + overlap);
  const rightColumnWidth = sourceWidth - rightStartX;
  const rightColumnFocusRange = getCatalogRightColumnFocusCropRange(
    sourceHeight,
    cropTop,
    hasLargeHeader,
  );
  const cropRanges = [
    { startX: 0, startY: cropTop, width: leftColumnWidth, height: cropHeight },
    // A focused crop makes the first right-column entry legible even when the
    // source page has a large decorative header above it. It is recognized
    // after the left column and before the complete right column.
    {
      startX: rightStartX,
      startY: rightColumnFocusRange.startY,
      width: rightColumnWidth,
      height: rightColumnFocusRange.height,
    },
    { startX: rightStartX, startY: cropTop, width: rightColumnWidth, height: cropHeight },
  ];

  return cropRanges.map(({ startX, startY, width, height }) => {
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) return imageSource;
    cropContext.drawImage(
      image,
      startX,
      startY,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    return cropCanvas.toDataURL("image/jpeg", DEFAULT_CATALOG_IMAGE_QUALITY);
  });
}

/**
 * Detect the blank gutter in two-column catalog pages and group crops by their
 * source page. Each two-column group is ordered left column, focused right
 * column top, then complete right column.
 */
export async function prepareCatalogPhotoImageGroupsForRecognition(
  images: CatalogPhotoImage[],
): Promise<string[][]> {
  return Promise.all(
    images.map((image) => splitCatalogImageForReadingOrder(image.src)),
  );
}

async function compressImageDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImageElement(dataUrl);
  const nextSize = scaleDimensionsToMaxEdge(image.naturalWidth, image.naturalHeight);
  if (nextSize.scale === 1) {
    return dataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = nextSize.width;
  canvas.height = nextSize.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("图片压缩失败");
  }

  context.drawImage(image, 0, 0, nextSize.width, nextSize.height);
  return canvas.toDataURL("image/jpeg", DEFAULT_CATALOG_IMAGE_QUALITY);
}

async function extractImagesFromSingleFile(file: File): Promise<CatalogPhotoImage[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) {
    throw new Error("无法识别文件格式");
  }

  if (["png", "jpg", "jpeg", "webp", "heic"].includes(extension)) {
    const originalDataUrl = await readFileAsDataUrl(file);
    return [
      {
        id: createRandomId(),
        name: file.name,
        src: await compressImageDataUrl(originalDataUrl),
      },
    ];
  }

  if (extension !== "pdf") {
    throw new Error("仅支持图片或 PDF 文件。");
  }

  const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const images: CatalogPhotoImage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(
        CATALOG_PDF_RENDER_MAX_SCALE,
        DEFAULT_CATALOG_IMAGE_MAX_EDGE / Math.max(baseViewport.width, baseViewport.height),
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
    images.push({
      id: createRandomId(),
      name: `${file.name} · 第 ${pageNumber} 页`,
      src: canvas.toDataURL("image/jpeg", DEFAULT_CATALOG_IMAGE_QUALITY),
    });
  }

  return images;
}

export async function extractCatalogPhotoImages(files: FileList | File[]): Promise<CatalogPhotoImage[]> {
  const fileList = Array.from(files);
  const imageGroups = await Promise.all(fileList.map((file) => extractImagesFromSingleFile(file)));
  return imageGroups.flat();
}
