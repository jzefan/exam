export type CatalogPhotoImage = {
  id: string;
  name: string;
  src: string;
};

export const DEFAULT_CATALOG_IMAGE_MAX_EDGE = 1280;
const DEFAULT_CATALOG_IMAGE_QUALITY = 0.8;

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
        id: crypto.randomUUID(),
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
      scale: Math.min(1.5, DEFAULT_CATALOG_IMAGE_MAX_EDGE / Math.max(baseViewport.width, baseViewport.height)),
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
      id: crypto.randomUUID(),
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
