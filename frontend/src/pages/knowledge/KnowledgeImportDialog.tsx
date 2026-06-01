import { useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { extractKnowledgeImportPaths, summarizeKnowledgeImportPaths, type KnowledgeImportPath } from "./import-knowledge-utils";
import { KnowledgeImportTreePreview } from "./KnowledgeImportTreePreview";
import type { KnowledgeImportPreviewNode } from "./import-knowledge-utils";

type KnowledgeImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (paths: KnowledgeImportPath[]) => Promise<void>;
  selectedTargetName: string | null;
};

export function KnowledgeImportDialog({
  open,
  onOpenChange,
  onImport,
  selectedTargetName,
}: KnowledgeImportDialogProps) {
  const { toast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [paths, setPaths] = useState<KnowledgeImportPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const summary = useMemo(() => summarizeKnowledgeImportPaths(paths), [paths]);

  const reset = () => {
    setFileName(null);
    setPaths([]);
    setError(null);
    setLoading(false);
    setSubmitting(false);
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
    try {
      const nextPaths = await extractKnowledgeImportPaths(file);
      if (nextPaths.length === 0) {
        throw new Error("没有识别到可导入的知识路径，请检查 Excel 内容。");
      }
      setFileName(file.name);
      setPaths(nextPaths);
    } catch (nextError) {
      setFileName(file.name);
      setPaths([]);
      setError(nextError instanceof Error ? nextError.message : "文件解析失败");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const handleImport = async () => {
    if (paths.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImport(paths);
      handleOpenChange(false);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "导入失败";
      setError(message);
      toast({
        title: "知识库导入失败",
        description: message,
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  const removeTreeNode = (node: KnowledgeImportPreviewNode) => {
    const pathIndexes = new Set(node.pathIndexes);
    setPaths((current) => current.filter((_, index) => !pathIndexes.has(index)));
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="w-[95vw] max-w-[1120px]">
        <DialogHeader>
          <DialogTitle>导入知识库</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 leading-6">
            {selectedTargetName ? (
              <>
                <span>将知识点导入到</span>
                <Badge
                  className="h-6 rounded-full border-none bg-primary/10 px-2.5 text-[11px] font-semibold text-primary"
                  variant="secondary"
                >
                  {selectedTargetName}
                </Badge>
                <span>。</span>
              </>
            ) : (
              <span>先选择专业或方向，再导入知识点。</span>
            )}
            <span>Excel 每一行表示一条知识路径，列从左到右表示层级；也支持单列用</span>
            <span className="px-1 font-medium">{">"}</span>
            <span>分隔层级路径。</span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          提醒：一级知识点会作为当前方向下的主知识创建；对于课程来说，就是一门课的课程名称。
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/60 px-6 py-6 text-center transition hover:border-primary">
              <Upload className="h-7 w-7 text-primary" />
              <span className="text-base font-semibold text-primary">点击上传 Excel 或 CSV</span>
              <span className="text-xs text-stone-500 dark:text-stone-400">
                建议第一行为表头：一级知识点 / 二级知识点 / 三级知识点...
              </span>
              <Input accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} type="file" />
            </label>

            <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-4 dark:border-stone-800 dark:bg-stone-950/60">
              <div className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                {fileName ?? "尚未选择文件"}
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
                每一行表示一条知识路径，列从左到右表示层级；也支持单列用
                <span className="px-1 font-medium text-stone-700 dark:text-stone-200">{">"}</span>
                分隔层级路径。
              </p>
            </div>

          </div>

          <div className="rounded-2xl border border-stone-200 dark:border-stone-800">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
              <div className="text-sm font-medium">导入预览</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                  一级知识点 {summary.rootCount}
                </div>
                <div className="rounded-full bg-stone-100 px-3 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                  最大层级 {summary.maxDepth}
                </div>
              </div>
            </div>
            <ScrollArea className="h-[420px]">
              <div className="p-4">
                {loading && <p className="text-sm text-stone-500 dark:text-stone-400">正在解析文件…</p>}
                {!loading && !error && (
                  <KnowledgeImportTreePreview
                    paths={paths}
                    emptyText="左侧上传文件后，会在这里以层级树方式预览识别出的知识路径。"
                    onRemoveNode={removeTreeNode}
                  />
                )}
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={loading || submitting || paths.length === 0} onClick={() => void handleImport()} type="button">
            {submitting ? "正在导入…" : "开始导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
