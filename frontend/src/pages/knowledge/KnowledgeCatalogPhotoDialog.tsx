import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Camera,
  FileImage,
  GripVertical,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  extractCatalogPhotoImages,
  type CatalogPhotoImage,
} from "./import-knowledge-photo-utils";
import type {
  KnowledgeImportPath,
  KnowledgeImportPreviewNode,
} from "./import-knowledge-utils";
import { KnowledgeImportTreePreview } from "./KnowledgeImportTreePreview";

type KnowledgeCatalogPhotoDialogProps = {
  existingRootNames: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecognize: (payload: {
    fileName: string;
    images: string[];
  }) => Promise<KnowledgeImportPath[]>;
  onImport: (paths: KnowledgeImportPath[]) => Promise<void>;
  selectedTargetName: string | null;
  /** When set, the rootName field is pre-filled, disabled, and NOT prepended
   *  to the import paths — the caller's `onImport` is treating that named
   *  node as the existing parent (e.g. the current course). */
  lockedRootName?: string | null;
};

function extractErrorDetail(message: string): string {
  const trimmed = message.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
    } catch {
      // Fall back to the original message when it is not a JSON error payload.
    }
  }
  return trimmed;
}

function normalizeCatalogPhotoError(nextError: unknown, imageCount: number): string {
  const rawMessage = nextError instanceof Error ? nextError.message : "目录识别失败";
  const detail = extractErrorDetail(rawMessage);
  const timeoutMatch = detail.match(/第\s*(\d+)\s*张图片识别超时/);

  if (timeoutMatch) {
    const imageLabel = `第 ${timeoutMatch[1]} 张图片`;
    if (imageCount <= 1) {
      return `${imageLabel}识别超时，请更换更清晰的图片后重试。`;
    }
    return `${imageLabel}识别超时，请减少单次上传数量，或更换更清晰的图片后重试。`;
  }

  return detail || "目录识别失败";
}

export function KnowledgeCatalogPhotoDialog({
  existingRootNames,
  open,
  onOpenChange,
  onRecognize,
  onImport,
  selectedTargetName,
  lockedRootName,
}: KnowledgeCatalogPhotoDialogProps) {
  const { toast } = useToast();
  const [images, setImages] = useState<CatalogPhotoImage[]>([]);
  const [paths, setPaths] = useState<KnowledgeImportPath[]>([]);
  const [rootName, setRootName] = useState(lockedRootName ?? "");
  const isLocked = Boolean(lockedRootName);

  // Re-seed when caller's locked name changes or the dialog reopens.
  useEffect(() => {
    if (lockedRootName !== undefined && lockedRootName !== null) {
      setRootName(lockedRootName);
    }
  }, [lockedRootName, open]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<CatalogPhotoImage | null>(
    null,
  );

  const trimmedRootName = rootName.trim();
  const duplicateRootName = useMemo(
    () => {
      if (isLocked) return false; // the locked target is by definition an existing parent
      return Boolean(
        trimmedRootName &&
          existingRootNames.some((name) => name.trim() === trimmedRootName),
      );
    },
    [existingRootNames, isLocked, trimmedRootName],
  );
  const effectivePaths = useMemo<KnowledgeImportPath[]>(
    () => {
      if (isLocked) return paths; // caller's onImport already nests under the locked node
      return trimmedRootName ? paths.map((path) => [trimmedRootName, ...path]) : paths;
    },
    [isLocked, paths, trimmedRootName],
  );

  const reset = () => {
    setImages([]);
    setPaths([]);
    setRootName(lockedRootName ?? "");
    setError(null);
    setLoading(false);
    setRecognizing(false);
    setImporting(false);
    setDraggingImageId(null);
    setPreviewImage(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      reset();
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const nextImages = await extractCatalogPhotoImages(files);
      setImages((current) => [...current, ...nextImages]);
      setPaths([]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文件解析失败");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const handleRecognize = async () => {
    if (images.length === 0) return;
    setRecognizing(true);
    setError(null);
    try {
      setPaths(
        await onRecognize({
          fileName:
            images.length === 1
              ? images[0].name
              : `目录照片共 ${images.length} 张`,
          images: images.map((image) => image.src),
        }),
      );
    } catch (nextError) {
      setPaths([]);
      setError(normalizeCatalogPhotoError(nextError, images.length));
    } finally {
      setRecognizing(false);
    }
  };

  const handleImport = async () => {
    if (effectivePaths.length === 0) return;
    if (!isLocked) {
      if (!trimmedRootName) {
        toast({
          title: "请填写主知识点名称",
          description: "填写后再导入，识别结果会作为这个主知识点的子节点导入。",
          position: "top",
          variant: "destructive",
        });
        return;
      }
      if (duplicateRootName) {
        toast({
          title: "主知识点名称已存在",
          description: "当前方向下已存在同名主知识点，请换一个名称。",
          position: "top",
          variant: "destructive",
        });
        return;
      }
    }
    setImporting(true);
    setError(null);
    try {
      await onImport(effectivePaths);
      handleOpenChange(false);
    } catch (nextError) {
      const message = normalizeCatalogPhotoError(nextError, images.length);
      setError(message);
      toast({
        title: "目录导入失败",
        description: message,
        variant: "destructive",
      });
      setImporting(false);
    }
  };

  const moveImage = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setImages((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setPaths([]);
  };

  const removeImage = (imageId: string) => {
    setImages((current) => current.filter((image) => image.id !== imageId));
    setPaths([]);
    if (draggingImageId === imageId) {
      setDraggingImageId(null);
    }
  };

  const removeTreeNode = (node: KnowledgeImportPreviewNode) => {
    // Non-locked mode: depth 0 == the virtual rootName layer (cannot delete it,
    // it's prepended automatically). Locked mode: depth 0 == real first-level
    // children of the locked node, so removal IS allowed.
    if (!isLocked && trimmedRootName && node.depth === 0) {
      return;
    }
    const pathIndexes = new Set(node.pathIndexes);
    setPaths((current) =>
      current.filter((_, index) => !pathIndexes.has(index)),
    );
  };

  const canImport =
    !recognizing && !importing && paths.length > 0 && !duplicateRootName;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-[1100px] w-[95vw]">
        <DialogHeader>
          <DialogTitle>书籍目录拍照导入</DialogTitle>
          <DialogDescription>
            {selectedTargetName
              ? `将目录识别结果导入到“${selectedTargetName}”。`
              : "请先选择专业或方向。"}
            上传目录照片或扫描版 PDF，系统按章、节识别后以层级树方式显示。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[350px_1fr]">
          {/* 左栏：上传与排序 */}
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/60 px-6 py-6 text-center transition hover:border-primary">
              <UploadCloud className="h-7 w-7 text-primary" />
              <span className="text-base font-semibold text-primary">
                点击添加图片或 PDF
              </span>
              <span className="text-xs text-stone-500 dark:text-stone-400">
                支持 PNG / JPG / HEIC / PDF，可一次选择多张
              </span>
              <Input
                accept=".png,.jpg,.jpeg,.webp,.heic,.pdf"
                className="hidden"
                multiple
                onChange={handleFileChange}
                type="file"
              />
            </label>

            <div className="flex items-center justify-between text-xs text-stone-600 dark:text-stone-300">
              <span className="inline-flex items-center gap-1">
                <FileImage className="h-4 w-4" />
                {images.length > 0
                  ? `已添加 ${images.length} 张`
                  : "尚未添加文件"}
              </span>
              {images.length > 0 && <span>拖动调整识别顺序</span>}
            </div>

            <ScrollArea className="h-[380px] rounded-2xl border border-stone-200/80 bg-white/80 dark:border-stone-800 dark:bg-stone-950/60">
              <div className="space-y-2 p-3">
                {images.length === 0 ? (
                  <p className="py-10 text-center text-sm text-stone-400">
                    上传后，图片会按顺序显示在这里。
                  </p>
                ) : (
                  images.map((image, index) => (
                    <div
                      className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900"
                      draggable
                      key={image.id}
                      onDragEnd={() => setDraggingImageId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={() => setDraggingImageId(image.id)}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggingImageId) {
                          moveImage(draggingImageId, image.id);
                        }
                        setDraggingImageId(null);
                      }}
                    >
                      <div className="flex items-center gap-2 text-stone-400">
                        <GripVertical className="h-4 w-4" />
                        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                          {index + 1}
                        </span>
                      </div>
                      <button
                        aria-label="查看大图"
                        className="shrink-0 overflow-hidden rounded-lg border border-stone-200 transition hover:ring-2 hover:ring-primary dark:border-stone-800"
                        onClick={() => setPreviewImage(image)}
                        type="button"
                      >
                        <img
                          alt={image.name}
                          className="h-14 w-14 cursor-zoom-in object-cover"
                          src={image.src}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-700 dark:text-stone-200">
                          {image.name}
                        </p>
                      </div>
                      <Button
                        className="h-8 w-8 rounded-full text-stone-500 hover:text-red-600 dark:text-stone-400 dark:hover:text-red-400"
                        onClick={() => removeImage(image.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* 右栏：识别结果 */}
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor="catalog-root-name">
                {isLocked ? "导入到课程" : (
                  <>主知识点名称 <span className="text-red-500">*</span></>
                )}
              </Label>
              <Input
                aria-describedby={duplicateRootName ? "catalog-root-name-error" : undefined}
                aria-invalid={duplicateRootName}
                id="catalog-root-name"
                onChange={(event) => setRootName(event.target.value)}
                placeholder="例如：高等数学上册 / 数据结构导论"
                value={rootName}
                disabled={isLocked}
                readOnly={isLocked}
              />
              {duplicateRootName ? (
                <p
                  className="text-xs font-medium text-red-600 dark:text-red-400"
                  id="catalog-root-name-error"
                >
                  当前方向下已存在同名主知识点，请换一个名称。
                </p>
              ) : (
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {isLocked
                    ? "识别出的全部章节会作为本课程的子知识点导入。"
                    : "识别出的全部章节会作为该主知识点的子节点导入。"}
                </p>
              )}
            </div>

            <div className="relative flex-1 rounded-2xl border border-stone-200 dark:border-stone-800">
              <ScrollArea className="h-[420px]">
                <div className="p-4">
                  {error ? (
                    <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">识别未完成</p>
                        <p className="mt-1 leading-6">{error}</p>
                      </div>
                    </div>
                  ) : (
                    <KnowledgeImportTreePreview
                      emptyText={
                        images.length === 0
                          ? "左侧上传目录照片后，点击“开始识别”即可在此预览层级。"
                          : "点击“开始识别”，等待后端识别目录层级。"
                      }
                      emptyClassName={
                        images.length > 0
                          ? "text-emerald-700 dark:text-emerald-400 font-medium"
                          : undefined
                      }
                      onRemoveNode={removeTreeNode}
                      paths={effectivePaths}
                      showCounts={false}
                      showTypeBadge={false}
                    />
                  )}
                </div>
              </ScrollArea>

              {recognizing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/85 backdrop-blur-sm">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm font-medium">正在识别目录，请稍候…</p>
                  <p className="max-w-xs text-center text-xs text-stone-500 dark:text-stone-400">
                    后端会对每张图片进行 OCR 并整理层级，首次识别较慢，通常需要
                    10 秒至 1 分钟左右。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {previewImage && (
          <button
            aria-label="关闭大图"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
            onClick={() => setPreviewImage(null)}
            type="button"
          >
            <img
              alt={previewImage.name}
              className="max-h-full max-w-full rounded-lg object-contain"
              src={previewImage.src}
            />
          </button>
        )}

        <DialogFooter className="gap-2">
          <Button
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={loading || recognizing || images.length === 0}
            onClick={() => void handleRecognize()}
            type="button"
            variant="outline"
          >
            {recognizing ? (
              <>
                <Camera className="mr-2 h-4 w-4 animate-pulse" />
                识别中…
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                开始识别
              </>
            )}
          </Button>
          <Button
            disabled={!canImport}
            onClick={() => void handleImport()}
            type="button"
          >
            {importing ? "导入中…" : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
