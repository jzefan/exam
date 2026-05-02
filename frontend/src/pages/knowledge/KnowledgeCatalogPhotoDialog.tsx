import { useMemo, useState, type ChangeEvent } from "react";
import {
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
  selectedDirectionName: string | null;
};

export function KnowledgeCatalogPhotoDialog({
  existingRootNames,
  open,
  onOpenChange,
  onRecognize,
  onImport,
  selectedDirectionName,
}: KnowledgeCatalogPhotoDialogProps) {
  const { toast } = useToast();
  const [images, setImages] = useState<CatalogPhotoImage[]>([]);
  const [paths, setPaths] = useState<KnowledgeImportPath[]>([]);
  const [rootName, setRootName] = useState("");
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
    () =>
      Boolean(
        trimmedRootName &&
          existingRootNames.some((name) => name.trim() === trimmedRootName),
      ),
    [existingRootNames, trimmedRootName],
  );
  const effectivePaths = useMemo<KnowledgeImportPath[]>(
    () =>
      trimmedRootName ? paths.map((path) => [trimmedRootName, ...path]) : paths,
    [paths, trimmedRootName],
  );

  const reset = () => {
    setImages([]);
    setPaths([]);
    setRootName("");
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
      setError(nextError instanceof Error ? nextError.message : "目录识别失败");
    } finally {
      setRecognizing(false);
    }
  };

  const handleImport = async () => {
    if (effectivePaths.length === 0) return;
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
    setImporting(true);
    setError(null);
    try {
      await onImport(effectivePaths);
      handleOpenChange(false);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "导入失败";
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
    if (trimmedRootName && node.depth === 0) {
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
            {selectedDirectionName
              ? `将目录识别结果导入到“${selectedDirectionName}”方向。`
              : "请先选择方向。"}
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
                主知识点名称 <span className="text-red-500">*</span>
              </Label>
              <Input
                aria-describedby={duplicateRootName ? "catalog-root-name-error" : undefined}
                aria-invalid={duplicateRootName}
                id="catalog-root-name"
                onChange={(event) => setRootName(event.target.value)}
                placeholder="例如：高等数学上册 / 数据结构导论"
                value={rootName}
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
                  识别出的全部章节会作为该主知识点的子节点导入。
                </p>
              )}
            </div>

            <div className="relative flex-1 rounded-2xl border border-stone-200 dark:border-stone-800">
              <ScrollArea className="h-[420px]">
                <div className="p-4">
                  {error ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {error}
                    </p>
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
                    10 秒至 1 分钟。
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
