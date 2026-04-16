import { useList } from "@refinedev/core";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Download, FileUp, LoaderCircle, Upload } from "lucide-react";

import type { IQuestionBank } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ImportReviewEditor } from "./components/import-review-editor";
import { ImportReviewSidebar } from "./components/import-review-sidebar";
import { ImportSourceEditor } from "./components/import-source-editor";
import type {
  ImportFilter,
  QuestionImportImageInput,
  QuestionImportDocumentRecognizeResponse,
  QuestionImportDraft,
} from "./import-types";
import {
  approveAllPendingDrafts,
  applySourceDraftEdits,
  buildImportableQuestions,
  buildStandardImportTemplate,
  buildImportSummary,
  canApproveAllDrafts,
  emptyImportSummary,
  extractQuestionImportPayload,
  generateImportQuestionTitle,
  getNextDraftIdAfterRemoval,
  hasBlockingImportIssues,
} from "./import-utils";

async function questionApiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function QuestionImportPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAnalyzingDocument, setIsAnalyzingDocument] = useState(false);
  const [recognizingDraftId, setRecognizingDraftId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [questionBankId, setQuestionBankId] = useState<string>("__none__");
  const [isDragActive, setIsDragActive] = useState(false);
  const [filter, setFilter] = useState<ImportFilter>("pending");
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const [mode, setMode] = useState<"review" | "source-edit">("review");
  const [sourceEdits, setSourceEdits] = useState<Record<string, string>>({});
  const [sourceImportPayload, setSourceImportPayload] = useState<{
    rawText: string;
    sourceFormat: "pdf" | "docx" | "md";
    images: QuestionImportImageInput[];
  } | null>(null);

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.draft_id === selectedDraftId) ?? null,
    [drafts, selectedDraftId],
  );
  const summary = drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const approvedCount = summary.approved;
  const completionPercent = summary.total > 0 ? Math.round((summary.approved / summary.total) * 100) : 0;
  const allowApproveAll = canApproveAllDrafts(drafts);

  const selectNextReviewTarget = (currentDraftId: string) => {
    const nextPending = drafts.find(
      (draft) => draft.draft_id !== currentDraftId && draft.review_status === "pending",
    );
    const nextAny = drafts.find((draft) => draft.draft_id !== currentDraftId);
    setSelectedDraftId(nextPending?.draft_id ?? nextAny?.draft_id ?? currentDraftId);
  };

  const processImportFile = async (
    file: File | null | undefined,
  ) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请上传 20 MB 以内的文件。`);
      return;
    }

    setLoading(true);
    setParseError(null);
    try {
      const payload = await extractQuestionImportPayload(file);
      setSourceImportPayload(payload);
      const response = await questionApiFetch<QuestionImportDocumentRecognizeResponse>(
        "/api/questions/import/document-recognize",
        {
          method: "POST",
          body: JSON.stringify({
            file_name: file.name,
            raw_text: payload.rawText,
            source_format: payload.sourceFormat,
            analysis_mode: "fast",
            images: payload.images,
          }),
        },
      );
      setDrafts(response.drafts);
      setDuplicatesRemoved(response.summary.duplicates_removed);
      if (response.summary.duplicates_removed > 0) {
        toast({ title: `已自动去除 ${response.summary.duplicates_removed} 道重复题目` });
      }
      setSourceEdits(Object.fromEntries(response.drafts.map((draft) => [draft.draft_id, draft.raw_text])));
      setSelectedDraftId(response.drafts[0]?.draft_id ?? null);
      setSourceFileName(file.name);
      setFilter("pending");
      setMode("review");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "文件解析失败");
      setDrafts([]);
      setDuplicatesRemoved(0);
      setSourceImportPayload(null);
      setSourceEdits({});
      setSelectedDraftId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await processImportFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const updateDraft = (draftId: string, patch: Partial<QuestionImportDraft>) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.draft_id === draftId
          ? {
              ...draft,
              ...patch,
              review_status: patch.review_status ?? "pending",
              review_required: patch.review_required ?? true,
            }
          : draft,
      ),
    );
  };

  const removeDraft = (draftId: string) => {
    setSelectedDraftId((currentSelectedId) => getNextDraftIdAfterRemoval(drafts, draftId, currentSelectedId));
    setDrafts((current) => current.filter((draft) => draft.draft_id !== draftId));
    setSourceEdits((current) => {
      const rest = { ...current };
      delete rest[draftId];
      return rest;
    });
  };

  const openSourceEditor = () => {
    setSourceEdits(Object.fromEntries(drafts.map((draft) => [draft.draft_id, sourceEdits[draft.draft_id] ?? draft.raw_text])));
    setMode("source-edit");
  };

  const previewSourceEdits = () => {
    setDrafts((current) => applySourceDraftEdits(current, sourceEdits));
    setMode("review");
  };

  const reRecognizeSelectedDraft = async () => {
    if (!selectedDraft) return;
    setRecognizingDraftId(selectedDraft.draft_id);
    setParseError(null);
    try {
      const response = await questionApiFetch<QuestionImportDraft>("/api/questions/import/re-recognize", {
        method: "POST",
        body: JSON.stringify({ raw_text: selectedDraft.raw_text }),
      });
      setDrafts((current) =>
        current.map((draft) =>
          draft.draft_id === selectedDraft.draft_id
            ? { ...response, draft_id: selectedDraft.draft_id, review_status: "pending", review_required: true }
            : draft,
        ),
      );
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "AI 补全失败");
    } finally {
      setRecognizingDraftId(null);
    }
  };

  const analyzeWholeImportedDocument = async () => {
    if (!sourceImportPayload || !sourceFileName) return;
    setIsAnalyzingDocument(true);
    setParseError(null);
    try {
      const response = await questionApiFetch<QuestionImportDocumentRecognizeResponse>(
        "/api/questions/import/document-recognize",
        {
          method: "POST",
          body: JSON.stringify({
            file_name: sourceFileName,
            raw_text: sourceImportPayload.rawText,
            source_format: sourceImportPayload.sourceFormat,
            analysis_mode: "ai_full",
            images: sourceImportPayload.images,
          }),
        },
      );
      setDrafts(response.drafts);
      setDuplicatesRemoved(response.summary.duplicates_removed);
      if (response.summary.duplicates_removed > 0) {
        toast({ title: `已自动去除 ${response.summary.duplicates_removed} 道重复题目` });
      }
      setSourceEdits(Object.fromEntries(response.drafts.map((draft) => [draft.draft_id, draft.raw_text])));
      setSelectedDraftId((current) => response.drafts.find((draft) => draft.draft_id === current)?.draft_id ?? response.drafts[0]?.draft_id ?? null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "AI 分析失败");
    } finally {
      setIsAnalyzingDocument(false);
    }
  };

  const importApprovedDrafts = async () => {
    const bankId = questionBankId === "__none__" ? null : questionBankId;
    const questions = buildImportableQuestions(drafts, bankId);
    if (questions.length === 0) {
      setParseError("请先人工确认至少一道题目后再导入。");
      return;
    }

    setImporting(true);
    setParseError(null);
    try {
      await questionApiFetch<{ created: number }>("/api/questions/bulk", {
        method: "POST",
        body: JSON.stringify({ questions }),
      });
      navigate("/questions");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const showReviewer = drafts.length > 0 && !loading;
  const showSourceEditor = showReviewer && mode === "source-edit";

  const downloadStandardTemplate = () => {
    const blob = new Blob([buildStandardImportTemplate()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "question-import-template.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (showSourceEditor) {
    return (
      <ImportSourceEditor
        drafts={drafts}
        selectedDraftId={selectedDraftId}
        sourceEdits={sourceEdits}
        onChange={(draftId, value) => setSourceEdits((current) => ({ ...current, [draftId]: value }))}
        onPreview={previewSourceEdits}
        onCancel={() => setMode("review")}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f8fafc]">
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-100 bg-white">
        <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2 lg:px-6">
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => showReviewer ? setDrafts([]) : navigate("/questions")} 
              className="size-8 rounded-lg border-slate-200 p-0 transition-all hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 lg:text-base">
                  {showReviewer ? "核对导入内容" : "智能题目导入"}
                </h1>
                {showReviewer && (
                   <Badge variant="secondary" className="h-5 border-none bg-primary/10 px-2 text-[11px] font-bold text-primary">
                      审核模式
                   </Badge>
                )}
              </div>
              <p className="max-w-[360px] truncate text-xs leading-snug text-muted-foreground">
                {showReviewer ? `正在处理: ${sourceFileName}` : "通过 AI 快速解析并导入多格式题目"}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {showReviewer && (
              <>
                <div className="hidden items-center gap-4 border-r border-slate-100 pr-4 xl:flex">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">总数</span>
                    <span className="text-base font-black leading-none text-slate-900">{summary.total}</span>
                  </div>
                  {duplicatesRemoved > 0 && (
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">去重</span>
                      <span className="text-base font-black leading-none text-orange-500">{duplicatesRemoved}</span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">待核对</span>
                    <span className="text-base font-black leading-none text-amber-500">{summary.pending_review}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">已确认</span>
                    <span className="text-base font-black leading-none text-emerald-500">{summary.approved}</span>
                  </div>
                </div>

                <div className="mr-1 hidden items-center gap-4 border-r border-slate-100 pr-4 lg:flex">
                   <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">进度</span>
                        <span className="text-sm font-bold text-primary">{completionPercent}%</span>
                      </div>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-primary shadow-sm shadow-primary/30 transition-all duration-700 ease-out"
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                   </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Label className="hidden text-xs font-bold text-slate-400 xl:block">导入至</Label>
                  <Select value={questionBankId} onValueChange={setQuestionBankId}>
                    <SelectTrigger className="h-9 w-[160px] rounded-lg border-none bg-slate-50 text-sm font-medium focus:ring-1 focus:ring-primary/20">
                      <SelectValue placeholder="选择目标题库" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-slate-100 shadow-xl">
                      <SelectItem value="__none__" className="text-sm">不指定题库</SelectItem>
                      {banks.map((bank) => (
                        <SelectItem key={bank.id} value={bank.id} className="text-sm">
                          {bank.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  disabled={approvedCount === 0 || importing}
                  onClick={() => void importApprovedDrafts()}
                  className="h-9 rounded-lg px-4 text-sm font-bold shadow-sm shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.98]"
                >
                  {importing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                  正式导入 {approvedCount} 题
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {parseError && (
        <div className="mx-8 mt-6">
          <Alert variant="destructive" className="rounded-[16px] border-none bg-red-50 text-red-600 shadow-sm p-4">
            <AlertCircle size={16} />
            <AlertDescription className="text-sm leading-snug font-medium ml-2">{parseError}</AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!showReviewer ? (
          /* Step 1: Upload Interface */
          <div className="flex flex-1 items-center justify-center p-8 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
            <div className="w-full max-w-2xl space-y-8 animate-in fade-in zoom-in-95 duration-700">
              <div className="text-center space-y-2">
                 <h2 className="text-base font-bold tracking-tight text-slate-900 uppercase tracking-wider">开始导入题目</h2>
                 <p className="text-xs leading-snug text-muted-foreground">建立您的高质量题库资源，支持通过 AI 自动识别文档结构</p>
              </div>

              <div 
                className={cn(
                  "relative group flex flex-col items-center justify-center rounded-[48px] border-2 border-dashed transition-all duration-500 min-h-[400px] bg-white shadow-2xl shadow-slate-200/40",
                  isDragActive 
                    ? "border-primary bg-primary/[0.01] scale-[1.01]" 
                    : "border-slate-100 hover:border-primary/30"
                )}
                onDragEnter={(e) => { e.preventDefault(); setIsDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  const nextTarget = e.relatedTarget;
                  if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
                    setIsDragActive(false);
                  }
                }}
                  onDrop={(e) => {
                  e.preventDefault();
                  setIsDragActive(false);
                  void processImportFile(e.dataTransfer.files?.[0]);
                }}
              >
                <input
                  ref={fileInputRef}
                  data-testid="question-import-file-input"
                  className="hidden"
                  accept=".pdf,.docx,.md,.markdown"
                  onChange={(e) => void handleFileChange(e)}
                  type="file"
                />

                {loading ? (
                  <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in-95">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <LoaderCircle size={40} className="animate-spin" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-foreground uppercase tracking-widest">正在解析文档</p>
                      <p className="text-sm leading-snug text-muted-foreground mt-1">AI 正在努力识别并拆分题目...</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-8">
                    <div className="flex h-24 w-24 items-center justify-center rounded-[32px] bg-slate-50 text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-all duration-500 group-hover:rotate-6">
                      <Upload size={48} strokeWidth={1.5} />
                    </div>
                    <div className="text-center px-8">
                      <p className="text-base font-bold text-slate-900 uppercase tracking-widest mb-2">拖拽文件到这里，或点击选择</p>
                      <p className="text-sm leading-snug text-muted-foreground">支持 PDF, WORD, MARKDOWN 格式 (最大 20MB)</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={downloadStandardTemplate}
                        className="h-12 rounded-2xl border-slate-200 px-6 text-sm font-bold text-slate-600"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        下载标准模板
                      </Button>
                      <Button 
                        size="lg" 
                        onClick={() => fileInputRef.current?.click()} 
                        className="h-12 rounded-2xl px-10 text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
                      >
                        选择本地文件
                      </Button>
                    </div>
                    <p className="text-xs font-medium text-slate-400">按标准模板填写并上传，可获得最稳定的识别结果。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Step 2: Review Interface */
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white/50 lg:flex-row">
            <aside className="z-10 flex h-[40vh] shrink-0 flex-col border-b border-slate-100 bg-white shadow-sm lg:h-full lg:w-[clamp(420px,32vw,520px)] lg:border-b-0 lg:border-r">
               <div className="flex-1 min-h-0">
                  <ImportReviewSidebar
                    drafts={drafts}
                    selectedDraftId={selectedDraftId}
                    filter={filter}
                    onFilterChange={setFilter}
                    onSelect={setSelectedDraftId}
                    onDelete={removeDraft}
                  />
               </div>
            </aside>
            <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50/40 p-4 lg:p-6">
               <div className="relative mx-auto w-full max-w-[1320px]">
                {isAnalyzingDocument && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-white/95">
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white px-8 py-7 shadow-xl">
                      <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                      <div className="text-center">
                        <p className="text-base font-bold text-slate-900">AI 正在分析整份导入内容</p>
                        <p className="mt-1 text-sm text-slate-500">正在理解题目结构与图片内容，请稍候</p>
                      </div>
                    </div>
                  </div>
                )}
                <ImportReviewEditor
                    draft={selectedDraft}
                    isRecognizing={recognizingDraftId === selectedDraft?.draft_id}
                    isAnalyzingDocument={isAnalyzingDocument}
                    canApproveAll={allowApproveAll}
                    onChange={(patch) => {
                      if (selectedDraft) updateDraft(selectedDraft.draft_id, patch);
                    }}
                    onApprove={() => {
                      if (selectedDraft) {
                        if (hasBlockingImportIssues(selectedDraft)) {
                          setParseError("当前题存在异常，请先修正异常后再确认。");
                          return;
                        }
                        updateDraft(selectedDraft.draft_id, {
                          title: generateImportQuestionTitle(selectedDraft.content_text),
                          review_status: "approved",
                          review_required: false,
                        });
                        selectNextReviewTarget(selectedDraft.draft_id);
                      }
                    }}
                    onApproveAll={() => {
                      if (!allowApproveAll) {
                        setParseError("存在异常题目，暂不能全部确定，请先修正异常。");
                        return;
                      }
                      setDrafts((current) => approveAllPendingDrafts(current));
                    }}
	                    onReRecognize={() => void reRecognizeSelectedDraft()}
                    onAnalyzeDocument={() => void analyzeWholeImportedDocument()}
	                    onEditSource={openSourceEditor}
	                  />
               </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
