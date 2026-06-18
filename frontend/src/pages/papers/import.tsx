import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  KnowledgePointSelector,
  type SelectedKnowledgePoint,
} from "@/components/questions/knowledge-point-selector";
import { ImportReviewWorkspace } from "@/pages/questions/components/import-review-workspace";
import type {
  EnhanceDraftInput,
  QuestionImportDraft,
} from "@/pages/questions/import-types";
import {
  buildImportSummary,
  emptyImportSummary,
  generateImportQuestionTitle,
  getBlockingImportIssues,
  isMissingAnswerIssue,
} from "@/pages/questions/import-utils";
import type { IPaperDetail } from "@/types";

import { paperApiRequest } from "./api";
import {
  extractPaperImportPayload,
  type ImportDocumentPayload,
  PAPER_IMPORT_MAX_FILE_SIZE_BYTES as MAX_FILE_SIZE_BYTES,
  recognizePaperPayload,
} from "./recognize";

export function PaperImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 从课程详情「导入试卷」进入时：预置主知识点为该课程，并让返回回到课程详情。
  const navState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
    rootKnowledgePointId?: string;
    rootKnowledgePointName?: string;
  };
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourcePayload, setSourcePayload] =
    useState<ImportDocumentPayload | null>(null);
  const [paperTitle, setPaperTitle] = useState("");
  const [paperDescription, setPaperDescription] = useState("");
  const presetRootKnowledgePoints: SelectedKnowledgePoint[] = navState.rootKnowledgePointId
    ? [
        {
          id: navState.rootKnowledgePointId,
          name: navState.rootKnowledgePointName ?? "课程",
          path: navState.rootKnowledgePointName ?? "课程",
        },
      ]
    : [];
  const [selectedRootKnowledgePoints, setSelectedRootKnowledgePoints] =
    useState<SelectedKnowledgePoint[]>(presetRootKnowledgePoints);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceOverlay, setEnhanceOverlay] = useState<{
    status: "loading" | "done" | "error";
    summary?: {
      answersCompleted: number;
      doubtsFlagged: number;
      kpsMatched: number;
    };
    errorMessage?: string;
  } | null>(null);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [enhanceSelectedKPs, setEnhanceSelectedKPs] = useState<
    SelectedKnowledgePoint[]
  >([]);
  const [enhancedRootKnowledgePoint, setEnhancedRootKnowledgePoint] =
    useState<SelectedKnowledgePoint | null>(null);

  const showReviewer = drafts.length > 0;
  const sourceFileName = sourcePayload?.fileName ?? "";
  const summary =
    drafts.length > 0 ? buildImportSummary(drafts) : emptyImportSummary;
  const importableCount = useMemo(
    () =>
      drafts.filter((draft) => getBlockingImportIssues(draft).length === 0)
        .length,
    [drafts],
  );
  const blockingIssueCount = useMemo(
    () =>
      drafts.filter((draft) => getBlockingImportIssues(draft).length > 0)
        .length,
    [drafts],
  );
  const rootKnowledgePointId = selectedRootKnowledgePoints[0]?.id ?? null;
  const enhancementApplied = useMemo(() => {
    if (!enhancedRootKnowledgePoint) return false;
    const approved = drafts.filter(
      (draft) => getBlockingImportIssues(draft).length === 0,
    );
    if (approved.length === 0) return false;
    return approved.every(
      (draft) =>
        draft.suggested_knowledge_points &&
        draft.suggested_knowledge_points.length > 0,
    );
  }, [drafts, enhancedRootKnowledgePoint]);

  const updateDraft = (
    draftId: string,
    patch: Partial<QuestionImportDraft>,
  ) => {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.draft_id !== draftId) return draft;
        const merged = {
          ...draft,
          ...patch,
          review_status: patch.review_status ?? draft.review_status,
          review_required: patch.review_required ?? draft.review_required,
        };
        if (patch.answer_text && patch.answer_text.trim() && patch.issues === undefined) {
          merged.issues = merged.issues.filter(
            (issue) => !isMissingAnswerIssue(issue),
          );
        }
        return merged;
      }),
    );
  };

  const removeDraft = (draftId: string) => {
    setDrafts((current) =>
      current.filter((draft) => draft.draft_id !== draftId),
    );
  };

  const recognizePayload = async (payload: ImportDocumentPayload) => {
    const recognized = await recognizePaperPayload(payload);
    const nextDrafts = recognized.drafts as unknown as QuestionImportDraft[];
    setSessionId(recognized.session_id);
    setDrafts(nextDrafts);
    setSourcePayload(payload);
    if (nextDrafts.length === 0) {
      setParseError(
        "未识别到题目。请确认上传的是含题干的试卷，而不是答题卡/封面/答案卡；若是 .doc 旧格式，请先另存为 .docx 再导入。",
      );
    } else {
      setParseError(null);
    }
    if (!paperTitle.trim()) {
      const titleFromFile = payload.fileName.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
    }
  };

  const processImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(
        `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请上传 20 MB 以内的文件。`,
      );
      return;
    }
    setLoading(true);
    setParseError(null);
    try {
      const payload = await extractPaperImportPayload(file);
      const titleFromFile = file.name.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
      setPaperDescription("");
      setSelectedRootKnowledgePoints(presetRootKnowledgePoints);
      await recognizePayload(payload);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入识别失败");
      setDrafts([]);
      setSessionId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await processImportFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleReRecognize = async () => {
    if (!sourcePayload) return;
    setLoading(true);
    try {
      await recognizePayload(sourcePayload);
      toast({
        title: "识别完成",
        description: `已重新识别 ${summary.total} 道题目`,
      });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "重新识别失败");
    } finally {
      setLoading(false);
    }
  };

  const handleEnhanceDrafts = async () => {
    const selectedKp = enhanceSelectedKPs[0];
    const selectedKpId = selectedKp?.id;
    if (!selectedKpId || !selectedKp) return;

    setEnhanceDialogOpen(false);
    setEnhancing(true);
    setEnhanceOverlay({ status: "loading" });

    const inputs: EnhanceDraftInput[] = drafts.map((d) => ({
      draft_id: d.draft_id,
      type: d.type,
      content_text: d.content_text,
      options: d.options,
      answer_text: d.answer_text,
      analysis: d.analysis,
    }));

    let answersCompleted = 0;
    let doubtsFlagged = 0;
    let kpsMatched = 0;
    let completed = 0;

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/import/enhance-drafts-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          drafts: inputs,
          root_knowledge_point_id: selectedKpId,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || `请求失败 (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式响应");

      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          const event = JSON.parse(raw) as {
            type: "progress" | "done";
            index?: number;
            total?: number;
            draft_id?: string;
            answer_text?: string | null;
            analysis?: string | null;
            doubt?: boolean;
            doubt_reason?: string | null;
            suggested_knowledge_points?: Array<{ id: string; name: string }>;
            answers_completed?: number;
            doubts_flagged?: number;
            kps_matched?: number;
          };

          if (event.type === "progress" && event.index != null) {
            completed++;
            const patch: Partial<QuestionImportDraft> = {};
            if (event.answer_text) {
              patch.answer_text = event.answer_text;
              answersCompleted++;
            }
            if (event.analysis) {
              patch.analysis = event.analysis;
            }
            if (event.doubt) {
              patch.doubt = event.doubt;
              patch.doubt_reason = event.doubt_reason;
              doubtsFlagged++;
            }
            if (event.suggested_knowledge_points && event.suggested_knowledge_points.length > 0) {
              patch.suggested_knowledge_points = event.suggested_knowledge_points;
              kpsMatched++;
            }
            if (event.draft_id) {
              updateDraft(event.draft_id, patch);
            }
            setEnhanceOverlay({
              status: "loading",
              summary: { answersCompleted, doubtsFlagged, kpsMatched },
            });
          }

          if (event.type === "done") {
            answersCompleted = event.answers_completed ?? answersCompleted;
            doubtsFlagged = event.doubts_flagged ?? doubtsFlagged;
            kpsMatched = event.kps_matched ?? kpsMatched;
            setEnhancedRootKnowledgePoint(selectedKp);
            setEnhanceOverlay({
              status: "done",
              summary: { answersCompleted, doubtsFlagged, kpsMatched },
            });
            window.setTimeout(() => setEnhanceOverlay(null), 2500);
          }
        }
      }
    } catch (error) {
      setEnhanceOverlay({
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "AI 增强失败，请稍后再试",
      });
      window.setTimeout(() => setEnhanceOverlay(null), 3000);
    } finally {
      setEnhancing(false);
      setEnhanceSelectedKPs([]);
    }
  };

  const openConfirmDialog = () => {
    if (importableCount === 0) {
      setParseError("没有可入库的题目，请先处理解析异常题目。");
      return;
    }
    if (!paperTitle.trim() && sourcePayload?.fileName) {
      const titleFromFile = sourcePayload.fileName.replace(/\.[^.]+$/, "");
      setPaperTitle(titleFromFile || "导入试卷");
    }
    setParseError(null);
    setConfirmDialogOpen(true);
  };

  const handleConfirmImport = async () => {
    if (!sessionId) return;
    if (!paperTitle.trim()) {
      setParseError("请填写试卷名称");
      return;
    }

    const reviewedDrafts = drafts.map((draft) => {
      const hasBlocking = getBlockingImportIssues(draft).length > 0;
      if (hasBlocking) {
        return { ...draft, review_status: "pending", review_required: true };
      }
      return {
        ...draft,
        title: draft.title || generateImportQuestionTitle(draft.content_text),
        review_status: "approved",
        review_required: false,
      };
    });

    const approvedCount = reviewedDrafts.filter(
      (draft) => draft.review_status === "approved",
    ).length;
    if (approvedCount === 0) {
      setParseError("没有可入库的题目，请先处理解析异常题目。");
      return;
    }

    const approvedDrafts = reviewedDrafts.filter(
      (draft) => draft.review_status === "approved",
    );
    const allApprovedEnhanced = approvedDrafts.every(
      (draft) =>
        draft.suggested_knowledge_points &&
        draft.suggested_knowledge_points.length > 0,
    );

    const effectiveRootKnowledgePointId =
      rootKnowledgePointId ??
      (enhancementApplied ? enhancedRootKnowledgePoint?.id ?? null : null);

    setImporting(true);
    setParseError(null);
    try {
      const paper = await paperApiRequest<IPaperDetail>(
        `/papers/import/sessions/${sessionId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            title: paperTitle.trim(),
            description: paperDescription.trim() || null,
            root_knowledge_point_id: effectiveRootKnowledgePointId,
            drafts: reviewedDrafts,
            skip_background_matching: allApprovedEnhanced,
          }),
        },
      );
      setConfirmDialogOpen(false);
      toast({ title: "导入成功", description: `已创建试卷：${paper.title}` });
      navigate(`/papers/${paper.id}`);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

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
                  setSessionId(null);
                  setParseError(null);
                  return;
                }
                navigate(navState.backTo ?? "/papers");
              }}
              className="size-8 rounded-lg border-slate-200 p-0 transition-all hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 lg:text-base">
                  {showReviewer ? "核对导入内容" : "导入试卷"}
                </h1>
                {showReviewer && (
                  <Badge
                    variant="secondary"
                    className="h-5 border-none bg-primary/10 px-2 text-[11px] font-bold text-primary"
                  >
                    审核模式
                  </Badge>
                )}
              </div>
              <p className="max-w-[360px] truncate text-xs leading-snug text-muted-foreground">
                {showReviewer
                  ? `正在处理: ${sourceFileName}`
                  : "上传历史试卷并校对后入库"}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {showReviewer && (
              <>
                <div className="hidden items-center gap-4 border-r border-slate-100 pr-4 lg:flex">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      总数
                    </span>
                    <span className="text-base font-black leading-none text-slate-900">
                      {summary.total}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      可入库
                    </span>
                    <span className="text-base font-black leading-none text-primary">
                      {importableCount}
                    </span>
                  </div>
                </div>

                {blockingIssueCount > 0 && (
                  <Badge className="hidden h-7 border-none bg-amber-100 px-3 text-xs font-bold text-amber-800 md:inline-flex">
                    {blockingIssueCount} 道解析异常，将跳过入库
                  </Badge>
                )}

                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || importing || !sourcePayload}
                  onClick={handleReRecognize}
                  className="h-9 rounded-lg px-3 text-sm font-bold"
                >
                  {loading ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  重新识别
                </Button>

                {/*
                  TODO: re-enable when visual recognition is faster
                  sourcePayload?.sourceFormat === "docx" && sourcePayload?.originalFile ? (
                  <Button ...>页面视觉识别</Button>
                  ) : null
                */}

                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    loading || importing || enhancing || drafts.length === 0
                  }
                  onClick={() => setEnhanceDialogOpen(true)}
                  className="h-9 rounded-lg px-3 text-sm font-bold"
                >
                  {enhancing ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  完善答案与知识点
                </Button>

                <Button
                  type="button"
                  disabled={loading || importing || importableCount === 0}
                  onClick={openConfirmDialog}
                  className="h-9 rounded-lg px-4 text-sm font-bold shadow-sm shadow-primary/20"
                >
                  {importing ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  确认入库
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Indeterminate progress bar during recognition / import */}
      {(loading || importing || enhancing) && (
        <div className="h-1 w-full overflow-hidden bg-primary/10">
          <div className="animate-progress-bar h-full w-2/5 rounded-r bg-primary" />
        </div>
      )}

      {enhanceOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-6 backdrop-blur-[2px]">
          <div className="w-full max-w-sm">
            <div className="flex w-full flex-col items-center rounded-3xl border border-border/60 bg-card px-8 py-7 text-center shadow-xl">
              {enhanceOverlay.status === "loading" ? (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <LoaderCircle size={28} className="animate-spin" />
                  </div>
                  <div className="mb-2 flex items-center gap-2 text-base font-semibold text-foreground">
                    <Sparkles size={16} />
                    正在完善答案与知识点
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    AI 正在逐题检查/补全答案，并匹配课程知识点。
                  </p>
                  {enhanceOverlay.summary ? (
                    <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-700">
                        已补全 {enhanceOverlay.summary.answersCompleted} 道答案
                      </span>
                      {enhanceOverlay.summary.doubtsFlagged > 0 ? (
                        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 font-medium text-orange-700">
                          存疑 {enhanceOverlay.summary.doubtsFlagged} 道
                        </span>
                      ) : null}
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 font-medium text-blue-700">
                        关联 {enhanceOverlay.summary.kpsMatched} 道知识点
                      </span>
                    </div>
                  ) : null}
                </>
              ) : enhanceOverlay.status === "done" ? (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 size={30} />
                  </div>
                  <div className="mb-2 text-base font-semibold text-foreground">
                    完善完成
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {enhanceOverlay.summary
                      ? (() => {
                          const parts = [];
                          const s = enhanceOverlay.summary;
                          if (s.answersCompleted > 0)
                            parts.push(`已补全 ${s.answersCompleted} 道答案`);
                          if (s.doubtsFlagged > 0)
                            parts.push(`标记 ${s.doubtsFlagged} 道存疑`);
                          if (s.kpsMatched > 0)
                            parts.push(`关联 ${s.kpsMatched} 道知识点`);
                          return parts.length > 0
                            ? parts.join("，")
                            : "所有题目已处理完毕";
                        })()
                      : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                    <AlertCircle size={28} />
                  </div>
                  <div className="mb-2 text-base font-semibold text-foreground">
                    增强失败
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {enhanceOverlay.errorMessage || "请稍后再试"}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {parseError && (
        <div className="mx-8 mt-6">
          <Alert
            variant="destructive"
            className="flex items-start gap-3 rounded-[16px] border-none bg-red-50 p-4 text-red-600 shadow-sm [&>svg]:static [&>svg]:translate-y-0"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-sm font-medium leading-snug">
              {parseError}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!showReviewer ? (
          <div className="flex flex-1 items-center justify-center p-8 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
            <div className="w-full max-w-2xl rounded-[40px] border-2 border-dashed border-slate-100 bg-white px-8 py-14 text-center shadow-2xl shadow-slate-200/40">
              <input
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,.md,.markdown"
                onChange={(event) => void handleFileChange(event)}
                type="file"
              />
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-slate-50 text-slate-400">
                <Upload className="h-10 w-10" />
              </div>
              <p className="mb-2 text-base font-bold tracking-tight text-slate-900 uppercase">
                开始导入试卷
              </p>
              <p className="mb-6 text-sm leading-snug text-muted-foreground">
                支持 PDF、Word（docx格式），单文件不超过 20MB
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="h-11 rounded-xl px-6 text-sm font-semibold shadow-sm shadow-primary/20"
              >
                {loading ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                选择文件并识别
              </Button>
            </div>
          </div>
        ) : (
          <ImportReviewWorkspace
            drafts={drafts}
            onChangeDraft={updateDraft}
            onDeleteDraft={removeDraft}
          />
        )}
      </main>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>确认入库试卷</DialogTitle>
            <DialogDescription>
              {enhancementApplied
                ? `已使用「${enhancedRootKnowledgePoint?.name ?? "已选课程"}」完成知识点关联，确认试卷信息后即可入库。`
                : "确认试卷信息并选择主知识点。主知识点可理解为课程名称，用于后续检索和 AI 生成。"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="paper-import-title">试卷名称</Label>
              <Input
                id="paper-import-title"
                value={paperTitle}
                onChange={(event) => setPaperTitle(event.target.value)}
                placeholder="请输入试卷名称"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="paper-import-description">试卷描述（可选）</Label>
              <Textarea
                id="paper-import-description"
                value={paperDescription}
                onChange={(event) => setPaperDescription(event.target.value)}
                placeholder="可填写试卷来源、适用班级、用途等说明"
                className="min-h-24"
              />
            </div>

            {enhancementApplied ? (
              <div className="rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                主知识点：「{enhancedRootKnowledgePoint?.name}」
                {enhancedRootKnowledgePoint?.path ? (
                  <span className="ml-1 text-muted-foreground/70">
                    {enhancedRootKnowledgePoint.path}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <KnowledgePointSelector
                  fetcher={(path, options) => paperApiRequest(path, options)}
                  selectedKnowledgePoints={selectedRootKnowledgePoints}
                  onSelectedKnowledgePointsChange={setSelectedRootKnowledgePoints}
                  storageKey="paper-import-root-knowledge-recent-keywords"
                  label="主知识点"
                  triggerLabel="搜索或展开知识图谱选择课程名称"
                  popoverSide="bottom"
                  popoverContentStyle={{
                    maxHeight: "min(340px, calc(100dvh - 260px))",
                  }}
                  selectionTarget="root"
                  selectionMode="single"
                  showUsageShortcuts={false}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={importing}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={importing || !paperTitle.trim()}
            >
              {importing ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确定入库
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={enhanceDialogOpen}
        onOpenChange={(open) => {
          setEnhanceDialogOpen(open);
          if (!open) setEnhanceSelectedKPs([]);
        }}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>完善答案与关联知识点</AlertDialogTitle>
            <AlertDialogDescription>
              AI 将为您检查/补全题目答案并匹配课程知识点。请先选择主知识点（课程）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <KnowledgePointSelector
              fetcher={(path, options) => paperApiRequest(path, options)}
              selectedKnowledgePoints={enhanceSelectedKPs}
              onSelectedKnowledgePointsChange={setEnhanceSelectedKPs}
              storageKey="paper-import-enhance-knowledge-recent-keywords"
              label="主知识点"
              triggerLabel="搜索或展开知识图谱选择主知识点"
              popoverSide="bottom"
              popoverContentStyle={{
                maxHeight: "min(340px, calc(100dvh - 360px))",
              }}
              selectionTarget="root"
              selectionMode="single"
              showUsageShortcuts={false}
            />
            {enhanceSelectedKPs[0] ? (
              <p className="rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                将从「{enhanceSelectedKPs[0].name}
                」下的子知识点中为题目匹配，同时检查/补全答案。
                <span className="ml-1 text-muted-foreground/70">
                  {enhanceSelectedKPs[0].path}
                </span>
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!enhanceSelectedKPs[0]?.id || enhancing}
              onClick={(event) => {
                event.preventDefault();
                void handleEnhanceDrafts();
              }}
            >
              开始完善
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
