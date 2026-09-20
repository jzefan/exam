import { useMemo, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  Globe,
  ImageUp,
  Loader2,
  Pencil,
  RotateCw,
  Search,
  Sparkles,
} from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  EMPTY_CATALOG_WEB_BOOK,
  editableTextToPaths,
  extractErrorMessage,
  fetchCatalogFromWeb,
  formatPublishYear,
  pathsToEditableText,
  recognizeCatalogCover,
  searchCatalogBooks,
  type CatalogWebBookInfo,
  type CatalogWebCandidate,
  type CatalogWebFetchResult,
} from "./catalog-web-api";
import { extractCatalogPhotoImages } from "./import-knowledge-photo-utils";
import type { KnowledgeImportPath } from "./import-knowledge-utils";
import { KnowledgeCatalogDraftEditor } from "./KnowledgeCatalogDraftEditor";
import { KnowledgeImportTreePreview } from "./KnowledgeImportTreePreview";

type Step = "input" | "pick" | "preview";

/** 第 3 步的两种编辑方式：树形编辑（与目录页一致）与文本批量编辑。 */
type EditorView = "preview" | "tree" | "text";

type KnowledgeCatalogWebDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (paths: KnowledgeImportPath[]) => Promise<void>;
  selectedTargetName: string | null;
  /** 课程名等已存在的父节点名；设置后仅作只读展示，不参与路径拼接。 */
  lockedRootName?: string | null;
  existingRootNames?: string[];
};

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "input", label: "1 填写书名 / 上传封面" },
  { key: "pick", label: "2 确认是哪一本" },
  { key: "preview", label: "3 校对目录并导入" },
];

function sourceBadge(result: CatalogWebFetchResult) {
  if (result.source === "publisher_site") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Globe className="mr-1 size-3" />
        {result.publisher_site || "出版社官网"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <Sparkles className="mr-1 size-3" />
      大模型推断
    </Badge>
  );
}

export function KnowledgeCatalogWebDialog({
  open,
  onOpenChange,
  onImport,
  selectedTargetName,
  lockedRootName,
  existingRootNames = [],
}: KnowledgeCatalogWebDialogProps) {
  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"title" | "cover">("title");
  const [book, setBook] = useState<CatalogWebBookInfo>(EMPTY_CATALOG_WEB_BOOK);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CatalogWebCandidate[]>([]);
  const [result, setResult] = useState<CatalogWebFetchResult | null>(null);
  const [paths, setPaths] = useState<KnowledgeImportPath[]>([]);
  const [editorView, setEditorView] = useState<EditorView>("preview");
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const busy = searching || recognizing || fetching;

  const trimmedRootName = (lockedRootName ?? "").trim();
  // 草稿编辑器的树根对应课程本身：拿不到课程名时给一个中性标题。
  const treeRootName = trimmedRootName || "课程目录";
  const duplicateRootName = useMemo(() => {
    if (trimmedRootName) return false; // 锁定目标本身就是已存在的父节点
    const root = paths[0]?.[0]?.trim();
    if (!root) return false;
    return existingRootNames.some((name) => name.trim() === root);
  }, [existingRootNames, paths, trimmedRootName]);

  // 允许退回之前的步骤：只要那一步所需的数据还在，就不该把用户困在当前页。
  const canJumpToStep = (target: Step) => {
    if (busy || target === step) return false;
    if (target === "input") return true;
    if (target === "pick") return candidates.length > 0;
    return paths.length > 0; // preview：目录已生成才可回看
  };

  const reset = () => {
    setStep("input");
    setMode("title");
    setBook(EMPTY_CATALOG_WEB_BOOK);
    setCoverPreview(null);
    setCandidates([]);
    setResult(null);
    setPaths([]);
    setEditorView("preview");
    setEditText("");
    setError(null);
    setSearching(false);
    setRecognizing(false);
    setFetching(false);
    setImporting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  // 书名或版次改动后，之前的检索结果与目录都不再可信。
  const updateBook = (patch: Partial<CatalogWebBookInfo>) => {
    setBook((current) => ({ ...current, ...patch }));
    setCandidates([]);
    setResult(null);
    setPaths([]);
    setEditorView("preview");
    setStep("input");
  };

  const runSearch = async (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setError("请先填写书名或 ISBN。");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const found = await searchCatalogBooks({ keyword: trimmed });
      setCandidates(found);
      // 重新检索意味着重新选书，此前拿到的目录不再对应，直接作废。
      setResult(null);
      setPaths([]);
      setEditorView("preview");
      if (found.length === 0) {
        setError("没有检索到这本书。请换用更完整的书名，或加上作者 / 出版社。");
      } else {
        setStep("pick");
      }
    } catch (nextError) {
      setCandidates([]);
      setError(extractErrorMessage(nextError, "图书检索失败，请稍后重试。"));
    } finally {
      setSearching(false);
    }
  };

  const handleCoverChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setRecognizing(true);
    setError(null);
    try {
      const [image] = await extractCatalogPhotoImages([files[0]]);
      if (!image) {
        throw new Error("封面图片解析失败，请换一张图片。");
      }
      setCoverPreview(image.src);
      const recognized = await recognizeCatalogCover({ image: image.src, fileName: image.name });
      setBook((current) => ({ ...current, ...recognized }));
      await runSearch(recognized.title);
    } catch (nextError) {
      setError(extractErrorMessage(nextError, "封面识别失败，请改用手动填写书名。"));
    } finally {
      setRecognizing(false);
      event.target.value = "";
    }
  };

  const runFetch = async (nextBook: CatalogWebBookInfo) => {
    setBook(nextBook);
    setFetching(true);
    setError(null);
    try {
      const fetched = await fetchCatalogFromWeb(nextBook);
      setResult(fetched);
      setPaths(fetched.paths);
      setEditText(pathsToEditableText(fetched.paths));
      setEditorView("preview");
      setStep("preview");
    } catch (nextError) {
      setResult(null);
      setPaths([]);
      setError(extractErrorMessage(nextError, "没能获取到这本书的目录。"));
    } finally {
      setFetching(false);
    }
  };

  const handlePick = async (candidate: CatalogWebCandidate) => {
    await runFetch({
      title: candidate.title,
      edition: candidate.edition || book.edition,
      author: candidate.author || book.author,
      publisher: candidate.publisher || book.publisher,
    });
  };

  const openTreeEditor = () => setEditorView("tree");

  const openTextEditor = () => {
    setEditText(pathsToEditableText(paths));
    setEditorView("text");
  };

  const closeTextEditor = () => {
    setPaths(editableTextToPaths(editText));
    setEditorView("preview");
  };

  const removeNode = (node: { pathIndexes: number[] }) => {
    const indexes = new Set(node.pathIndexes);
    setPaths((current) => current.filter((_, index) => !indexes.has(index)));
  };

  const handleImport = async () => {
    if (paths.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(paths);
      handleOpenChange(false);
    } catch (nextError) {
      setError(extractErrorMessage(nextError, "目录导入失败，请稍后重试。"));
      setImporting(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className={cn(
          // 编辑目录时用与「课程详情 → 目录」编辑页同款的两栏版式，需要更宽的画布。
          editorView === "tree"
            ? "w-[86vw] min-w-[720px] max-w-[1180px]"
            : "w-[55vw] min-w-[600px] max-w-[880px]",
        )}
      >
        <DialogHeader>
          <DialogTitle>获取目录</DialogTitle>
          <DialogDescription>
            {selectedTargetName
              ? `上传书籍封面或填写书名，系统自动获取该书目录后导入到“${selectedTargetName}”。`
              : "请先选择课程。"}
            目录会先展示给你校对，确认无误再导入。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {STEP_LABELS.map(({ key, label }) => {
            const reachable = canJumpToStep(key);
            const active = step === key;
            return (
              <button
                key={key}
                type="button"
                disabled={!reachable}
                onClick={() => {
                  setEditorView("preview");
                  setStep(key);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition",
                  active
                    ? "border-primary/40 bg-primary/10 font-medium text-primary"
                    : reachable
                      ? "border-border bg-muted/50 text-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                  !reachable && "cursor-default",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{error}</p>
          </div>
        )}

        {step === "input" && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "title" ? "default" : "outline"}
                onClick={() => setMode("title")}
              >
                <BookOpen className="mr-1.5 h-4 w-4" />
                填写书名
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "cover" ? "default" : "outline"}
                onClick={() => setMode("cover")}
              >
                <ImageUp className="mr-1.5 h-4 w-4" />
                上传封面
              </Button>
            </div>

            {mode === "title" ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px] flex-1 space-y-2">
                  <Label htmlFor="catalog-web-title">
                    书名 / ISBN <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="catalog-web-title"
                    onChange={(event) => updateBook({ title: event.target.value })}
                    placeholder="例如：计算机网络 / 9787121411403"
                    value={book.title}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runSearch(book.title);
                    }}
                  />
                </div>
                <div className="w-[136px] shrink-0 space-y-2">
                  <Label htmlFor="catalog-web-edition">版本（可选）</Label>
                  <Input
                    id="catalog-web-edition"
                    onChange={(event) => updateBook({ edition: event.target.value })}
                    placeholder="例如：第8版"
                    value={book.edition}
                  />
                </div>
                <Button
                  className="shrink-0"
                  disabled={busy || !book.title.trim()}
                  onClick={() => void runSearch(book.title)}
                  type="button"
                >
                  {searching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      检索中…
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      检索图书
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/60 px-6 py-8 text-center transition hover:border-primary",
                    recognizing && "pointer-events-none opacity-70",
                  )}
                >
                  {recognizing ? (
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  ) : (
                    <ImageUp className="h-7 w-7 text-primary" />
                  )}
                  <span className="text-base font-semibold text-primary">
                    {recognizing ? "正在识别封面…" : "点击上传书籍封面"}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    支持 PNG / JPG / HEIC，系统会读出书名、版次、作者与出版社
                  </span>
                  <Input
                    accept=".png,.jpg,.jpeg,.webp,.heic"
                    className="hidden"
                    onChange={handleCoverChange}
                    type="file"
                  />
                </label>
                {coverPreview && (
                  <img
                    alt="书籍封面"
                    className="mx-auto max-h-40 rounded-lg border border-border object-contain"
                    src={coverPreview}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {step === "pick" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-stone-600 dark:text-stone-300">
                检索「{book.title}」命中 {candidates.length} 本，请点选你要用的那一本
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStep("input")}
                disabled={fetching}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                返回修改
              </Button>
            </div>
            <ScrollArea className="h-[380px] rounded-2xl border border-border">
              <div className="space-y-2 p-3">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.url || candidate.title}
                    className="flex w-full flex-col gap-1 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary hover:shadow-sm disabled:opacity-60"
                    disabled={fetching}
                    onClick={() => void handlePick(candidate)}
                    type="button"
                  >
                    <span className="text-sm font-medium leading-5 text-foreground">
                      {candidate.title}
                      {candidate.edition && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {candidate.edition}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[
                        candidate.author,
                        candidate.publisher,
                        formatPublishYear(candidate.publish_date),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "作者与出版社信息缺失"}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            {fetching && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在获取目录，先试出版社官网，拿不到会交给大模型推断…
              </p>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {result && sourceBadge(result)}
              <span className="text-xs text-muted-foreground">
                《{book.title}》{book.edition ? ` ${book.edition}` : ""} · 共 {paths.length} 条
              </span>
              {result?.source_url && (
                <a
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  href={result.source_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  查看来源页
                </a>
              )}
              <div className="flex-1" />
              {editorView === "text" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={closeTextEditor}
                  disabled={importing}
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  完成编辑
                </Button>
              ) : editorView === "tree" ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={openTreeEditor}
                  disabled={importing}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  编辑目录
                </Button>
              )}
            </div>

            {result?.notes && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
                {result.notes}
              </p>
            )}

            {editorView === "tree" ? (
              <KnowledgeCatalogDraftEditor
                paths={paths}
                rootName={treeRootName}
                onBack={() => setEditorView("preview")}
                onBatchEdit={openTextEditor}
                onChange={setPaths}
              />
            ) : (
              <div className="rounded-2xl border border-border">
                <ScrollArea className="h-[400px]">
                  <div className="p-4">
                    {editorView === "text" ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          每行一条目录，层级用「 &gt; 」分隔，例如：第一章 概述 &gt; 1.1 计算机网络在信息时代的作用
                        </p>
                        <Textarea
                          aria-label="目录文本"
                          className="min-h-[340px] font-mono text-xs leading-6"
                          onChange={(event) => setEditText(event.target.value)}
                          value={editText}
                        />
                      </div>
                    ) : (
                      <KnowledgeImportTreePreview
                        emptyText="没有可导入的目录条目。"
                        onRemoveNode={removeNode}
                        paths={paths}
                        showCounts={false}
                        showTypeBadge={false}
                      />
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {duplicateRootName && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                当前方向下已存在同名主知识点，请修改首层名称后再导入。
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-muted-foreground"
              onClick={() => void runFetch(book)}
              disabled={importing || fetching}
            >
              <RotateCw className="mr-1.5 h-4 w-4" />
              重新获取
            </Button>
          )}
          <Button onClick={() => handleOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button
            disabled={step !== "preview" || importing || paths.length === 0 || duplicateRootName}
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
