import { useMemo, useState, type ChangeEvent } from "react";
import { Camera, FileImage } from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { extractCatalogPhotoImages } from "./import-knowledge-photo-utils";
import { summarizeKnowledgeImportPaths, type KnowledgeImportPath } from "./import-knowledge-utils";

type KnowledgeCatalogPhotoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecognize: (payload: { fileName: string; images: string[] }) => Promise<KnowledgeImportPath[]>;
  onImport: (paths: KnowledgeImportPath[]) => Promise<void>;
  selectedDirectionName: string | null;
};

export function KnowledgeCatalogPhotoDialog({
  open,
  onOpenChange,
  onRecognize,
  onImport,
  selectedDirectionName,
}: KnowledgeCatalogPhotoDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [paths, setPaths] = useState<KnowledgeImportPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);

  const summary = useMemo(() => summarizeKnowledgeImportPaths(paths), [paths]);

  const reset = () => {
    setFileName(null);
    setImages([]);
    setPaths([]);
    setError(null);
    setLoading(false);
    setRecognizing(false);
    setImporting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      reset();
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setPaths([]);
    try {
      const nextImages = await extractCatalogPhotoImages(file);
      setFileName(file.name);
      setImages(nextImages);
    } catch (nextError) {
      setFileName(file.name);
      setImages([]);
      setError(nextError instanceof Error ? nextError.message : "文件解析失败");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const handleRecognize = async () => {
    if (!fileName || images.length === 0) return;
    setRecognizing(true);
    setError(null);
    try {
      setPaths(await onRecognize({ fileName, images }));
    } catch (nextError) {
      setPaths([]);
      setError(nextError instanceof Error ? nextError.message : "目录识别失败");
    } finally {
      setRecognizing(false);
    }
  };

  const handleImport = async () => {
    if (paths.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(paths);
      handleOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "导入失败");
      setImporting(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>书籍目录拍照导入</DialogTitle>
          <DialogDescription>
            {selectedDirectionName ? `将目录识别结果导入到“${selectedDirectionName}”方向。` : "请先选择方向。"}
            支持上传目录照片或扫描版 PDF，系统会先识别目录层级，再由你确认导入。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          提醒：一级知识点会作为当前方向下的主知识创建；对于课程来说，就是一门课的课程名称。
        </div>

        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 p-5 dark:border-stone-700 dark:bg-stone-900/40">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="rounded-full" size="sm" type="button" variant="outline">
              <label className="cursor-pointer">
                <Camera className="mr-2 h-4 w-4" />
                选择图片或 PDF
                <Input accept=".png,.jpg,.jpeg,.webp,.heic,.pdf" className="hidden" onChange={handleFileChange} type="file" />
              </label>
            </Button>
            {fileName ? (
              <span className="inline-flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <FileImage className="h-4 w-4" />
                {fileName}
                {images.length > 1 ? ` · 已提取 ${images.length} 页` : ""}
              </span>
            ) : (
              <span className="text-sm text-stone-500 dark:text-stone-400">
                建议上传目录页清晰、层级完整的照片或扫描版 PDF。
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 dark:border-stone-800">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
            <div className="text-sm font-medium">目录识别预览</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                知识路径 {summary.totalPaths}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                最大层级 {summary.maxDepth}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                一级知识点 {summary.rootCount}
              </span>
            </div>
          </div>
          <ScrollArea className="h-[420px]">
            <div className="space-y-2 p-4">
              {!paths.length && !error && (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  选择文件后点击“开始识别”，系统会在这里展示识别出的目录层级路径。
                </p>
              )}
              {paths.map((path, index) => (
                <div
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900"
                  key={`${path.join(" > ")}-${index}`}
                >
                  {path.join(" > ")}
                </div>
              ))}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={loading || recognizing || images.length === 0} onClick={() => void handleRecognize()} type="button" variant="outline">
            {recognizing ? "识别中…" : "开始识别"}
          </Button>
          <Button disabled={recognizing || importing || paths.length === 0} onClick={() => void handleImport()} type="button">
            {importing ? "导入中…" : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
