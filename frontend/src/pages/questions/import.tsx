import { useList } from "@refinedev/core";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, Download, Eye, LoaderCircle, RefreshCw, Sparkles, Upload } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
import {
  KnowledgePointSelector,
  type SelectedKnowledgePoint,
} from "@/components/questions/knowledge-point-selector";
import { useBackgroundTaskNotice } from "@/hooks/use-background-task-notice";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ImportReviewWorkspace } from "./components/import-review-workspace";
import { ImportSourceEditor } from "./components/import-source-editor";
import {
  clearPersistedQuestionImportJobId,
  isTerminalQuestionImportJobStatus,
  persistQuestionImportJobId,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH,
} from "./question-knowledge-recognition";
import type {
  QuestionBulkCreateResponse,
  QuestionImportBulkCreateJobResponse,
  QuestionImportDocumentRecognizeResponse,
  QuestionImportDocumentSummary,
  QuestionImportDraft,
  QuestionImportJobResponse,
  QuestionImportTableInput,
} from "./import-types";
import {
  applySourceDraftEdits,
  buildImportableQuestions,
  buildStandardImportTemplate,
  buildImportSummary,
  countFastImportEligibleDrafts,
  emptyImportSummary,
  extractQuestionImportPayload,
  generateImportQuestionTitle,
  getNextDraftIdAfterRemoval,
  getBlockingImportIssues,
  isEligibleForFastImport,
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
    let errorText = "";
    try {
      const clonedResponse = typeof response.clone === "function" ? response.clone() : response;
      errorText = await clonedResponse.text();
    } catch {
      errorText = "";
    }
    const error = await response.json().catch(() => ({}));
    const detail = error.detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item: { loc?: unknown[]; msg?: string }) => {
        const loc = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
        return loc ? `${loc}: ${item.msg ?? ""}` : item.msg ?? "";
      });
      throw new Error(messages.join("；") || "请求失败");
    }
    throw new Error(
      typeof detail === "string"
        ? detail
        : errorText.trim() || `请求失败（HTTP ${response.status}）`,
    );
  }

  return response.json() as Promise<T>;
}

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

type ImportResultSummary = {
  attempted: number;
  created: number;
  existing: number;
  failed: number;
  importJobId: string | null;
};

type ImportDocumentPayload = {
  fileName: string;
  rawText: string;
  sourceFormat: "pdf" | "docx" | "md";
  images: QuestionImportDraft["images"];
  tables?: QuestionImportTableInput[];
};

type AiRecognizeOverlayState =
  | { status: "loading" }
  | { status: "success"; count: number }
  | null;

export function QuestionImportPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showNotice, dismissNotice } = useBackgroundTaskNotice();
  const initialQuestionBankId = new URLSearchParams(window.location.search).get("question_bank_id");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiRecognizing, setAiRecognizing] = useState(false);
  const [aiRecognizeOverlay, setAiRecognizeOverlay] = useState<AiRecognizeOverlayState>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [questionBankId, setQuestionBankId] = useState<string>(initialQuestionBankId || "__none__");
  const [isDragActive, setIsDragActive] = useState(false);
  const [documentPayload, setDocumentPayload] = useState<ImportDocumentPayload | null>(null);
  const [recognizedSummary, setRecognizedSummary] = useState<QuestionImportDocumentSummary | null>(null);
  const [mode, setMode] = useState<"review" | "source-edit">("review");
  const [sourceEdits, setSourceEdits] = useState<Record<string, string>>({});

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const [rootKnowledgePointDialogOpen, setRootKnowledgePointDialogOpen] = useState(false);
  const [selectedRootKnowledgePoints, setSelectedRootKnowledgePoints] = useState<SelectedKnowledgePoint[]>([]);
  const [activeImportJobId, setActiveImportJobId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultSummary | null>(null);

  useEffect(() => {
    if (!activeImportJobId) return;

    let cancelled = false;
    let timer: number | null = null;

    const pollJobStatus = async () => {
      try {
        const job = await questionApiFetch<QuestionImportJobResponse>(
          `/api/questions/import/jobs/${activeImportJobId}`,
        );
        if (cancelled) return;

        if (isTerminalQuestionImportJobStatus(job.status)) {
          setActiveImportJobId(null);
          clearPersistedQuestionImportJobId();
          dismissNotice(QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID);
          const summary = `知识点识别完成：成功匹配 ${job.matched_count} 道，未匹配 ${job.unmatched_count} 道，失败 ${job.failed_count} 道`;
          toast({ title: "题目知识点识别完成", description: summary });
          return;
        }

        showNotice({
          id: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID,
          title: "知识点正在后台识别",
          progressText: `${job.processed_count}/${job.total_count}`,
          description: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION,
          pagePath: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH,
        });
        timer = window.setTimeout(pollJobStatus, 2000);
      } catch (error) {
        if (cancelled) return;
        setActiveImportJobId(null);
        clearPersistedQuestionImportJobId();
        dismissNotice(QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID);
        toast({
          title: "知识点识别状态查询失败",
          description: error instanceof Error ? error.message : "请稍后在题目列表中刷新查看结果",
          variant: "destructive",
        });
      }
    };

    void pollJobStatus();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeImportJobId, dismissNotice, showNotice, toast]);

  const derivedSummary = drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const summary = recognizedSummary
    ? {
        ...derivedSummary,
        duplicates_removed: recognizedSummary.duplicates_removed,
        incomplete_choice_count: recognizedSummary.incomplete_choice_count,
        visual_retry_recommended: recognizedSummary.visual_retry_recommended,
      }
    : derivedSummary;
  const fastImportEligibleCount = countFastImportEligibleDrafts(drafts);
  const blockingIssueCount = drafts.filter((draft) => getBlockingImportIssues(draft).length > 0).length;
  const selectedRootKnowledgePointId = selectedRootKnowledgePoints[0]?.id ?? "";
  const showDocxQualityWarning =
    documentPayload?.sourceFormat === "docx" && summary.visual_retry_recommended;

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
      const nextDocumentPayload: ImportDocumentPayload = {
        fileName: file.name,
        rawText: payload.rawText,
        sourceFormat: payload.sourceFormat,
        images: payload.images,
        tables: payload.tables,
      };
      const response = await recognizeImportDocument(nextDocumentPayload, "fast");
      setDrafts(response.drafts);
      setRecognizedSummary(response.summary);
      if (response.summary.duplicates_removed > 0) {
        toast({ title: `已自动去除 ${response.summary.duplicates_removed} 道重复题目` });
      }
      setSourceEdits(Object.fromEntries(response.drafts.map((draft) => [draft.draft_id, draft.raw_text])));
      setSelectedDraftId(response.drafts[0]?.draft_id ?? null);
      setDocumentPayload(nextDocumentPayload);
      setSourceFileName(file.name);
      setMode("review");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "文件解析失败");
      setDrafts([]);
      setRecognizedSummary(null);
      setDocumentPayload(null);
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

  const recognizeImportDocument = async (
    payload: ImportDocumentPayload,
    analysisMode: "fast" | "ai_full",
  ) =>
    questionApiFetch<QuestionImportDocumentRecognizeResponse>(
      "/api/questions/import/document-recognize",
      {
        method: "POST",
        body: JSON.stringify({
          file_name: payload.fileName,
          raw_text: payload.rawText,
          source_format: payload.sourceFormat,
          analysis_mode: analysisMode,
          images: payload.images ?? [],
          tables: payload.tables ?? [],
        }),
      },
    );

  const handleAiReRecognize = async () => {
    if (!documentPayload) {
      setParseError("未找到导入原文，请重新上传文件后再试。");
      return;
    }

    setAiRecognizing(true);
    setAiRecognizeOverlay({ status: "loading" });
    setParseError(null);
    try {
      const response = await recognizeImportDocument(documentPayload, "ai_full");
      if (response.drafts.length === 0) {
        throw new Error("AI 未识别到题目，请检查导入文本后重试。");
      }
      setDrafts(response.drafts);
      setRecognizedSummary(response.summary);
      setSourceEdits(Object.fromEntries(response.drafts.map((draft) => [draft.draft_id, draft.raw_text])));
      setSelectedDraftId(response.drafts[0]?.draft_id ?? null);
      setMode("review");
      setAiRecognizeOverlay({ status: "success", count: response.summary.total });
      window.setTimeout(() => {
        setAiRecognizeOverlay((current) => (current?.status === "success" ? null : current));
      }, 1600);
    } catch (error) {
      setAiRecognizeOverlay(null);
      setParseError(error instanceof Error ? error.message : "AI重新识别失败，请稍后再试。");
    } finally {
      setAiRecognizing(false);
    }
  };

  const handleVisualRecognize = async () => {
    if (!documentPayload) return;
    setAiRecognizing(true);
    setAiRecognizeOverlay({ status: "loading" });
    setParseError(null);
    try {
      const fileInput = fileInputRef.current;
      if (!fileInput?.files?.[0]) {
        throw new Error("未找到原始文件，请重新上传后再试。");
      }
      const formData = new FormData();
      formData.append("file", fileInput.files[0]);
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/import/document-recognize-visual", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "视觉识别失败");
      }
      const result = (await response.json()) as QuestionImportDocumentRecognizeResponse;
      setDrafts(result.drafts);
      setRecognizedSummary(result.summary);
      setSourceEdits(Object.fromEntries(result.drafts.map((d) => [d.draft_id, d.raw_text])));
      setSelectedDraftId(result.drafts[0]?.draft_id ?? null);
      setMode("review");
      setAiRecognizeOverlay({ status: "success", count: result.summary.total });
      window.setTimeout(() => {
        setAiRecognizeOverlay((current) => (current?.status === "success" ? null : current));
      }, 1600);
    } catch (error) {
      setAiRecognizeOverlay(null);
      setParseError(error instanceof Error ? error.message : "视觉识别失败");
    } finally {
      setAiRecognizing(false);
    }
  };

  const updateDraft = (draftId: string, patch: Partial<QuestionImportDraft>) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.draft_id === draftId
          ? {
              ...draft,
              ...patch,
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

  const previewSourceEdits = () => {
    setDrafts((current) => applySourceDraftEdits(current, sourceEdits));
    setMode("review");
  };

  const openImportCourseDialog = () => {
    const readyCount = fastImportEligibleCount;
    if (readyCount === 0) {
      setParseError("暂无可直接导入的题目，请先处理解析异常题。");
      return;
    }
    setParseError(null);
    setRootKnowledgePointDialogOpen(true);
  };

  const runImportWithRootKnowledgePoint = async (rootKnowledgePointId: string | null) => {
    const importDrafts = drafts.map((draft) =>
      isEligibleForFastImport(draft)
        ? {
            ...draft,
            title: draft.title || generateImportQuestionTitle(draft.content_text),
            review_status: "approved" as const,
            review_required: false,
          }
        : draft,
    );
    const importableDraftIds = importDrafts
      .filter((draft) => draft.review_status === "approved" && getBlockingImportIssues(draft).length === 0)
      .map((draft) => draft.draft_id);
    const bankId = questionBankId === "__none__" ? null : questionBankId;
    const questions = buildImportableQuestions(importDrafts, bankId);
    if (questions.length === 0 || questions.length !== importableDraftIds.length) {
      setParseError("暂无可直接导入的题目，请先处理解析异常题。");
      return;
    }

    setImporting(true);
    setParseError(null);
    try {
      const response = rootKnowledgePointId
        ? await questionApiFetch<QuestionImportBulkCreateJobResponse>(
            "/api/questions/import/bulk-create-job",
            {
              method: "POST",
              body: JSON.stringify({ questions, root_knowledge_point_id: rootKnowledgePointId }),
            },
          )
        : await questionApiFetch<QuestionBulkCreateResponse>("/api/questions/bulk", {
            method: "POST",
            body: JSON.stringify({ questions }),
          });
      const importedCount = response.created;
      const existingCount = response.existing ?? 0;
      const failedCount = response.failed ?? 0;
      const responseJobId =
        "job_id" in response && typeof response.job_id === "string" ? response.job_id : null;
      const importJobId =
        rootKnowledgePointId && importedCount > 0 ? responseJobId : null;
      if (failedCount === 0) {
        const successfulIds = new Set(importableDraftIds);
        setDrafts((current) => current.filter((draft) => !successfulIds.has(draft.draft_id)));
        setSourceEdits((current) => {
          const rest = { ...current };
          successfulIds.forEach((draftId) => {
            delete rest[draftId];
          });
          return rest;
        });
        setSelectedDraftId((current) => {
          if (current && !successfulIds.has(current)) return current;
          const nextDraft = drafts.find((draft) => !successfulIds.has(draft.draft_id));
          return nextDraft?.draft_id ?? null;
        });
        const nextSummary = buildImportSummary(importDrafts.filter((draft) => !successfulIds.has(draft.draft_id)));
        setRecognizedSummary((current) =>
          current
            ? {
                ...nextSummary,
                duplicates_removed: current.duplicates_removed,
                incomplete_choice_count: 0,
                visual_retry_recommended: false,
              }
            : nextSummary,
        );
      }
      setImportResult({
        attempted: questions.length,
        created: importedCount,
        existing: existingCount,
        failed: failedCount,
        importJobId,
      });
      if (rootKnowledgePointId) {
        if (importedCount > 0 && responseJobId) {
          setActiveImportJobId(responseJobId);
          persistQuestionImportJobId(responseJobId);
          showNotice({
            id: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID,
            title: "知识点正在后台识别",
            progressText: `0/${importedCount}`,
            description: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION,
            pagePath: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH,
          });
        }
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const confirmImportWithRootKnowledgePoint = async () => {
    if (!selectedRootKnowledgePointId) return;
    const rootKnowledgePointId = selectedRootKnowledgePointId;
    setRootKnowledgePointDialogOpen(false);
    await runImportWithRootKnowledgePoint(rootKnowledgePointId);
  };

  const skipRootKnowledgePointAndImport = async () => {
    setRootKnowledgePointDialogOpen(false);
    await runImportWithRootKnowledgePoint(null);
  };

  const goToQuestionListAfterImport = () => {
    const importJobId = importResult?.importJobId;
    setImportResult(null);
    navigate(importJobId ? `/questions?import_job_id=${importJobId}` : "/questions");
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
              onClick={() => {
                if (showReviewer) {
                  setDrafts([]);
                  setRecognizedSummary(null);
                  setDocumentPayload(null);
                  setSourceEdits({});
                  setSelectedDraftId(null);
                  setSourceFileName("");
                  return;
                }
                navigate(activeImportJobId ? `/questions?import_job_id=${activeImportJobId}` : "/questions");
              }}
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
                <div className="hidden items-center gap-4 border-r border-slate-100 pr-4 lg:flex">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">总数</span>
                    <span className="text-base font-black leading-none text-slate-900">{summary.total}</span>
                  </div>
                  {summary.duplicates_removed > 0 && (
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">去重</span>
                      <span className="text-base font-black leading-none text-orange-500">{summary.duplicates_removed}</span>
                    </div>
                  )}
                </div>

                {blockingIssueCount > 0 && (
                  <Badge className="hidden h-7 border-none bg-amber-100 px-3 text-xs font-bold text-amber-800 md:inline-flex">
                    {blockingIssueCount} 道解析异常，将跳过导入
                  </Badge>
                )}
                
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
                  type="button"
                  variant="outline"
                  disabled={importing || aiRecognizing || !documentPayload}
                  onClick={handleAiReRecognize}
                  className="h-9 rounded-lg px-3 text-sm font-bold"
                >
                  {aiRecognizing ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  AI重新识别
                </Button>

                {showDocxQualityWarning ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={importing || aiRecognizing || !documentPayload}
                    onClick={handleVisualRecognize}
                    className="h-9 rounded-lg px-3 text-sm font-bold"
                  >
                    {aiRecognizing ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    页面视觉识别
                  </Button>
                ) : null}

                <Button
                  type="button"
                  disabled={importing || aiRecognizing || fastImportEligibleCount === 0}
                  onClick={openImportCourseDialog}
                  className="h-9 rounded-lg px-4 text-sm font-bold shadow-sm shadow-primary/20"
                >
                  {importing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                  导入 {fastImportEligibleCount} 道题目
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {parseError && (
        <div className="mx-8 mt-6">
          <Alert variant="destructive" className="flex items-start gap-3 rounded-[16px] border-none bg-red-50 p-4 text-red-600 shadow-sm [&>svg]:static [&>svg]:translate-y-0">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-sm font-medium leading-snug">{parseError}</AlertDescription>
          </Alert>
        </div>
      )}

      {showDocxQualityWarning ? (
        <div className="mx-8 mt-4">
          <Alert className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm [&>svg]:static [&>svg]:translate-y-0">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-sm font-medium leading-snug">
              当前 Word 文档可能使用了自动编号。系统已尽量恢复选项结构，请重点核对这些题目后再导入。
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

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
          <ImportReviewWorkspace
            drafts={drafts}
            onChangeDraft={updateDraft}
            onDeleteDraft={removeDraft}
          />
        )}
      </main>

      {aiRecognizeOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-6 backdrop-blur-[2px]">
          <div className="w-full max-w-sm">
            <div className="flex w-full flex-col items-center rounded-3xl border border-border/60 bg-card px-8 py-7 text-center shadow-xl">
              {aiRecognizeOverlay.status === "loading" ? (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <LoaderCircle size={28} className="animate-spin" />
                  </div>
                  <div className="mb-2 flex items-center gap-2 text-base font-semibold text-foreground">
                    <Sparkles size={16} />
                    AI正在重新识别
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    正在重新分析导入文本，提取题型、题目内容、选项、答案、难度和解析。
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 size={30} />
                  </div>
                  <div className="mb-2 text-base font-semibold text-foreground">AI重新识别完成</div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    已重新识别 {aiRecognizeOverlay.count} 道题目，列表已更新。
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={rootKnowledgePointDialogOpen} onOpenChange={setRootKnowledgePointDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>选择主知识点</AlertDialogTitle>
            <AlertDialogDescription>
              选择后，系统会从这个主知识点下的子知识中为题目自动匹配知识点；也可以暂不关联。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <KnowledgePointSelector
              fetcher={(path, options) => questionApiFetch(`/api${path}`, options)}
              selectedKnowledgePoints={selectedRootKnowledgePoints}
              onSelectedKnowledgePointsChange={setSelectedRootKnowledgePoints}
              storageKey="question-import-root-knowledge-recent-keywords"
              label="主知识点"
              triggerLabel="搜索或展开知识图谱选择主知识点"
              popoverSide="bottom"
              popoverContentStyle={{ maxHeight: "min(340px, calc(100dvh - 360px))" }}
              selectionTarget="root"
              selectionMode="single"
              showUsageShortcuts={false}
            />
            {selectedRootKnowledgePoints[0] ? (
              <p className="rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                将从「{selectedRootKnowledgePoints[0].name}」下的子知识点中自动匹配。
                <span className="ml-1 text-muted-foreground/70">{selectedRootKnowledgePoints[0].path}</span>
              </p>
            ) : null}
            <Alert className="flex items-start gap-3 border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300 [&>svg]:static [&>svg]:translate-y-0">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription className="text-xs leading-5">
                暂不确定时可以先导入，之后在题库列表中使用“关联知识点”补充。
              </AlertDescription>
            </Alert>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => void skipRootKnowledgePointAndImport()}
            >
              暂不关联
            </Button>
            <AlertDialogAction
              disabled={!selectedRootKnowledgePointId || importing}
              onClick={(event) => {
                event.preventDefault();
                void confirmImportWithRootKnowledgePoint();
              }}
            >
              关联并导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={importResult !== null} onOpenChange={(open) => {
        if (!open && importResult) {
          goToQuestionListAfterImport();
        }
      }}>
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>题目导入完成</AlertDialogTitle>
            <AlertDialogDescription>
              本次导入已处理完成，系统会带你回到题目列表查看结果。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {importResult ? (
            <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
                <p className="text-xs font-bold text-muted-foreground">本次导入</p>
                <p className="mt-2 text-2xl font-black text-slate-900">{importResult.attempted}</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                <p className="text-xs font-bold text-emerald-700">成功入库</p>
                <p className="mt-2 text-2xl font-black text-emerald-600">{importResult.created}</p>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-center">
                <p className="text-xs font-bold text-amber-700">数据库已存在</p>
                <p className="mt-2 text-2xl font-black text-amber-600">{importResult.existing}</p>
              </div>
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-center">
                <p className="text-xs font-bold text-red-700">失败</p>
                <p className="mt-2 text-2xl font-black text-red-600">{importResult.failed}</p>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                goToQuestionListAfterImport();
              }}
            >
              查看题目列表
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
