import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FileDown,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RefreshCw,
  Search,
  FileText,
  Users,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { LatexText } from "@/components/ui/latex-text";
import { cn } from "@/lib/utils";
import { dimensionLabel } from "@/lib/dimension-display";
import type { IQuestion } from "@/types";
import {
  apiRequest,
  type CandidateGroup,
  type ExamCandidateScore,
  type ExamCandidateScoresResponse,
  type GradingCandidateDetailResponse,
  type GradingConfirmResponse,
  type GradingExportExam,
  type GradingExportExamListResponse,
  type GradingExportScoreResponse,
  type GradingInboxExamGroup,
  type GradingInboxQuestionItem,
  type GradingInboxResponse,
  type GradingPromptFollowUpResponse,
  type GradingQuestionCandidate,
  type GradingQuestionDetailResponse,
} from "./api";
import { WholePaperView } from "./whole-paper-view";

type ExpandedStage = "primary" | "review" | "arbiter";
type GradingAttachment = {
  name: string;
  url: string;
};
type SpreadsheetCell = string | number | null | undefined;
type GradingRouteState = {
  backTo?: string;
  backLabel?: string;
} | null;

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "阅卷成绩";
}

function safeSpreadsheetText(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return text;
}

function spreadsheetCellWidth(value: SpreadsheetCell): number {
  const text = value === null || value === undefined ? "" : String(value);
  return Math.min(
    36,
    Math.max(
      10,
      [...text].reduce((width, char) => width + (/[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 2 : 1), 0) + 2,
    ),
  );
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function getAttachmentExtension(nameOrUrl: string) {
  const match = nameOrUrl.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  return match ? match[1].toLowerCase() : "";
}

function isImageAttachment(attachment: GradingAttachment) {
  const ext = getAttachmentExtension(attachment.name || attachment.url);
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}

function isDocxAttachment(attachment: GradingAttachment) {
  const ext = getAttachmentExtension(attachment.name || attachment.url);
  return ext === "docx";
}

function AttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: {
  attachment: GradingAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment || !open || !isDocxAttachment(attachment)) {
      setDocxHtml(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(attachment.url, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
          },
        });
        if (!response.ok) throw new Error(`文档加载失败: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setDocxHtml(result.value);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "文档预览失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment, open]);

  if (!attachment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">{attachment.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-muted/10">
          {isImageAttachment(attachment) ? (
            <div className="flex h-full items-center justify-center bg-background p-4">
              <img src={attachment.url} alt={attachment.name} className="max-h-[68vh] max-w-full object-contain" />
            </div>
          ) : isDocxAttachment(attachment) ? (
            loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                正在加载文档预览...
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <p>{error}</p>
                <Button variant="outline" onClick={() => window.open(attachment.url, "_blank")}>
                  在新标签页打开
                </Button>
              </div>
            ) : (
              <div className="h-full overflow-auto bg-white p-6 dark:bg-background">
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: docxHtml ?? "" }}
                />
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>该附件格式暂不支持在线预览</p>
              <Button variant="outline" onClick={() => window.open(attachment.url, "_blank")}>
                在新标签页打开
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getModelLogoSrc(modelLabel: string) {
  const normalized = modelLabel.toLowerCase();
  if (normalized.includes("qwen")) return "/model-logos/qwen.svg";
  if (normalized.includes("deepseek")) return "/model-logos/deepseek.svg";
  if (normalized.includes("claude")) return "/model-logos/claude.svg";
  return null;
}

function toShortModelName(modelLabel: string) {
  const displayLabel = modelLabel.split("/")[0]?.trim() || modelLabel;
  return displayLabel
    .replace(/\bGrader\b/gi, "评分模型")
    .replace(/\bReviewer\b/gi, "复核模型")
    .replace(/\bArbiter\b/gi, "仲裁模型");
}

function buildBaseEvaluationEntry(candidateDetail: GradingCandidateDetailResponse | null) {
  if (!candidateDetail || candidateDetail.models.length === 0) return null;
  return {
    prompt: "初始评估",
    pending: false,
    models: candidateDetail.models,
    system: true,
  };
}

function questionTypeLabel(questionType: "short_answer" | "code") {
  return questionType === "code" ? "代码题" : "主观题";
}

function isConfirmedCandidateStatus(status: string) {
  return ["人工改分", "已确认", "已审核", "已复核"].includes(status);
}

function statusDotClass(status: string) {
  if (isConfirmedCandidateStatus(status)) {
    return "bg-emerald-500";
  }
  if (status === "待仲裁" || status === "评估失败") return "bg-rose-500";
  return "bg-slate-400";
}

function isViewedIntermediateStatus(status: string, viewed: boolean) {
  return viewed && !isConfirmedCandidateStatus(status);
}

function formatQuestionSummary(question: GradingQuestionDetailResponse | null) {
  if (!question) return "";
  return question.question_content;
}

function toQuestionPreview(detail: GradingQuestionDetailResponse | null): IQuestion | null {
  if (!detail) return null;
  return {
    id: detail.question_id,
    type: detail.question_type,
    title: detail.question_label,
    content: { text: detail.question_content },
    options: null,
    answer: {},
    analysis: null,
    difficulty: 3,
    score: detail.max_score,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: detail.knowledge_tags.map((tag, index) => ({
      id: `${detail.question_id}-knowledge-${index}`,
      name: tag,
      parent_id: null,
      description: null,
      created_at: "",
    })),
    created_by: "",
    created_by_name: "",
    created_at: "",
    updated_at: "",
  };
}

function buildQuestionRef(examId: string | null, questionId: string) {
  return `${examId ?? "standalone"}::${questionId}`;
}

function getUiLocale(): string {
  if (typeof document !== "undefined") {
    const pageLocale = document.documentElement.lang?.trim();
    if (pageLocale?.toLowerCase().startsWith("en")) return pageLocale;
  }
  return "zh-CN";
}

function safeInternalBackTo(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function GradingCenterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedExamId = searchParams.get("examId")?.trim() || null;
  // 从课程详情「批改」进入时携带的一次性默认模式（消费后从 URL 移除，避免刷新覆盖手动状态）。
  const initialModeParam = searchParams.get("mode");
  const routeState = (location.state ?? null) as GradingRouteState;
  const backTo = safeInternalBackTo(
    typeof routeState?.backTo === "string" ? routeState.backTo : searchParams.get("backTo"),
  );
  const backLabel =
    typeof routeState?.backLabel === "string"
      ? routeState.backLabel
      : (searchParams.get("backLabel") ?? "返回");
  const [searchText, setSearchText] = useState("");
  const [inbox, setInbox] = useState<GradingInboxResponse | null>(null);
  const [questionCountOverrides, setQuestionCountOverrides] = useState<
    Record<string, { pending_count: number; completed_count: number }>
  >({});
  const [selectedQuestionRef, setSelectedQuestionRef] = useState<string | null>(null);
  const [questionDetail, setQuestionDetail] = useState<GradingQuestionDetailResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<GradingCandidateDetailResponse | null>(null);
  const [manualScore, setManualScore] = useState("");
  const [autoScoreReason, setAutoScoreReason] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [showFollowUpWorkspace, setShowFollowUpWorkspace] = useState(false);
  const [followUpConversation, setFollowUpConversation] = useState<
    Array<{
      prompt: string;
      pending: boolean;
      models: Array<GradingPromptFollowUpResponse["models"][number] & { streamingText?: string }>;
      system?: boolean;
    }>
  >([]);
  const [questionExpanded, setQuestionExpanded] = useState(false);
  const [showCandidateList, setShowCandidateList] = useState(true);
  const [candidateTransitionDirection, setCandidateTransitionDirection] = useState<"prev" | "next" | "neutral">("neutral");
  const [expandedExamGroups, setExpandedExamGroups] = useState<Set<string>>(new Set());
  const [previewAttachment, setPreviewAttachment] = useState<GradingAttachment | null>(null);
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [exportExamSearch, setExportExamSearch] = useState("");
  const [exportExams, setExportExams] = useState<GradingExportExam[]>([]);
  const [loadingExportExams, setLoadingExportExams] = useState(false);
  const [exportingExamId, setExportingExamId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [actionLoading, setActionLoading] = useState<null | "manual" | "run" | "refresh" | "confirm">(null);
  const [followUpStreaming, setFollowUpStreaming] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<ExpandedStage, boolean>>({
    primary: true,
    review: false,
    arbiter: false,
  });
  const viewedTaskIdsRef = useRef<Set<string>>(new Set());

  // ——— 按考生阅卷模式 ———
  const [gradingMode, setGradingMode] = useState<"question" | "candidate">(() => {
    if (initialModeParam === "candidate" || initialModeParam === "question") return initialModeParam;
    return (localStorage.getItem("grading_mode") as "question" | "candidate") || "question";
  });
  useEffect(() => {
    localStorage.setItem("grading_mode", gradingMode);
  }, [gradingMode]);
  // 左栏显示/隐藏：按考生阅卷时自动淡出隐藏，按题目阅卷时自动显示；分隔线上的按钮也可手动切换。
  // 优先级：本次导航携带的 mode 参数 > 上次手动记忆的左栏状态 > 当前模式默认值。
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    if (initialModeParam === "candidate") return true;
    if (initialModeParam === "question") return false;
    const persisted = localStorage.getItem("grading_sidebar_hidden");
    if (persisted !== null) return persisted === "true";
    return ((localStorage.getItem("grading_mode") as "question" | "candidate") || "question") === "candidate";
  });
  useEffect(() => {
    localStorage.setItem("grading_sidebar_hidden", String(sidebarHidden));
  }, [sidebarHidden]);
  // 消费完一次性 mode 参数后从 URL 移除：刷新时改由记忆的左栏状态接管。
  useEffect(() => {
    if (!searchParams.get("mode")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("mode");
    setSearchParams(next, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [candidateExamKey, setCandidateExamKey] = useState<string | null>(null); // exam_id ?? "standalone"
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  // 选中考试每道题的考生列表缓存：questionId -> 该题详情（含 candidates）
  const [examQuestionCandidates, setExamQuestionCandidates] = useState<
    Record<string, GradingQuestionDetailResponse>
  >({});
  const [loadingCandidateGroups, setLoadingCandidateGroups] = useState(false);
  const [candidateScoreMap, setCandidateScoreMap] = useState<Map<string, ExamCandidateScore>>(new Map());
  // 按考生阅卷下的内容区视图：逐题工作流 vs 整卷视图
  const [candidatePaneView, setCandidatePaneView] = useState<"workflow" | "paper">(
    () => (localStorage.getItem("grading_candidate_view") as "workflow" | "paper") || "workflow",
  );
  useEffect(() => {
    localStorage.setItem("grading_candidate_view", candidatePaneView);
  }, [candidatePaneView]);

  const markCandidateViewed = async (taskId: string) => {
    if (viewedTaskIdsRef.current.has(taskId)) return;
    const alreadyViewed =
      questionDetail?.candidates.some((candidate) => candidate.task_id === taskId && candidate.viewed) ||
      (candidateDetail?.task_id === taskId && candidateDetail.viewed);
    if (alreadyViewed) {
      viewedTaskIdsRef.current.add(taskId);
      return;
    }

    viewedTaskIdsRef.current.add(taskId);
    setQuestionDetail((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((candidate) =>
              candidate.task_id === taskId ? { ...candidate, viewed: true } : candidate,
            ),
          }
        : current,
    );
    setCandidateDetail((current) =>
      current?.task_id === taskId ? { ...current, viewed: true } : current,
    );

    try {
      await apiRequest<{ viewed: boolean }>(`/grading/tasks/${taskId}/viewed`, {
        method: "POST",
      });
    } catch {
      viewedTaskIdsRef.current.delete(taskId);
      setQuestionDetail((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.map((candidate) =>
                candidate.task_id === taskId ? { ...candidate, viewed: false } : candidate,
              ),
            }
          : current,
      );
      setCandidateDetail((current) =>
        current?.task_id === taskId ? { ...current, viewed: false } : current,
      );
    }
  };

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const inboxUrl = scopedExamId ? `/grading/inbox?exam_id=${scopedExamId}` : "/grading/inbox";
      const payload = await apiRequest<GradingInboxResponse>(inboxUrl);
      setInbox(payload);
      setQuestionCountOverrides({});
      setReportError(null);
      return payload;
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "加载主观题列表失败");
      return null;
    } finally {
      setLoadingInbox(false);
      setActionLoading(null);
    }
  };

  const loadQuestion = async (examId: string | null, questionId: string) => {
    setLoadingQuestion(true);
    try {
      const payload = await apiRequest<GradingQuestionDetailResponse>(
        `/grading/inbox/questions/${examId ?? "standalone"}/${questionId}`,
      );
      const hydratedPayload = {
        ...payload,
        candidates: payload.candidates.map((candidate) =>
          viewedTaskIdsRef.current.has(candidate.task_id) ? { ...candidate, viewed: true } : candidate,
        ),
      };
      setQuestionDetail(hydratedPayload);
      setReportError(null);
      return hydratedPayload;
    } catch (error) {
      setQuestionDetail(null);
      setReportError(error instanceof Error ? error.message : "加载考生列表失败");
      return null;
    } finally {
      setLoadingQuestion(false);
    }
  };

  const loadCandidate = async (taskId: string) => {
    setLoadingCandidate(true);
    try {
      const payload = await apiRequest<GradingCandidateDetailResponse>(
        `/grading/inbox/tasks/${taskId}`,
      );
      const hydratedPayload = viewedTaskIdsRef.current.has(taskId) ? { ...payload, viewed: true } : payload;
      setCandidateDetail(hydratedPayload);
      const hasAnswer =
        Boolean(hydratedPayload.student_answer_raw?.trim()) ||
        (hydratedPayload.attachment_refs?.length ?? 0) > 0;
      if (!hasAnswer) {
        setManualScore("0");
        setAutoScoreReason("该考生未提交答案，评分自动设为0分");
      } else if (hydratedPayload.suggested_score == null) {
        setManualScore("0");
        setAutoScoreReason(hydratedPayload.evaluation_note ?? "AI尚未评估，评分自动设为0分");
      } else {
        setManualScore(String(hydratedPayload.suggested_score));
        setAutoScoreReason(null);
      }
      setReportError(null);
      return hydratedPayload;
    } catch (error) {
      setCandidateDetail(null);
      setReportError(error instanceof Error ? error.message : "加载评分详情失败");
      return null;
    } finally {
      setLoadingCandidate(false);
      setActionLoading(null);
    }
  };

  const loadExportExams = async () => {
    setLoadingExportExams(true);
    setExportError(null);
    try {
      const payload = await apiRequest<GradingExportExamListResponse>("/grading/export/exams");
      setExportExams(payload.exams);
      return payload.exams;
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "加载可导出考试失败");
      return [];
    } finally {
      setLoadingExportExams(false);
    }
  };

  const exportExamScores = async (exam: GradingExportExam) => {
    setExportingExamId(exam.exam_id);
    setExportError(null);
    try {
      const payload = await apiRequest<GradingExportScoreResponse>(
        `/grading/export/exams/${exam.exam_id}/scores`,
      );
      const XLSX = await import("xlsx");
      const rows: SpreadsheetCell[][] = [
        ["学生名称", "学号", "客观题", "主观题", "总分"],
        ...payload.students.map((student) => [
          safeSpreadsheetText(student.candidate_name),
          safeSpreadsheetText(student.candidate_code),
          student.objective_score ?? 0,
          student.subjective_score ?? 0,
          student.total_score,
        ]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!cols"] = rows[0].map((_, columnIndex) => ({
        wch: Math.max(...rows.map((row) => spreadsheetCellWidth(row[columnIndex]))),
      }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "阅卷成绩");
      XLSX.writeFile(workbook, `${sanitizeFileName(payload.exam_label)}-阅卷成绩-${exportDateStamp()}.xlsx`);
      setExportPanelOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出成绩失败");
    } finally {
      setExportingExamId(null);
    }
  };

  useEffect(() => {
    void loadInbox();
  }, []);

  useEffect(() => {
    if (!exportPanelOpen) return;
    void loadExportExams();
  }, [exportPanelOpen]);

  const scopedExamGroups = useMemo(() => {
    if (!inbox) return [];
    return scopedExamId
      ? inbox.exams.filter((exam) => exam.exam_id === scopedExamId)
      : inbox.exams;
  }, [inbox, scopedExamId]);

  const filteredExamGroups = useMemo(() => {
    // 考生模式：考试列表保持完整（关键词在渲染处过滤考生行），避免按题干过滤导致考试整组消失
    if (gradingMode === "candidate") return scopedExamGroups;

    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return scopedExamGroups;

    return scopedExamGroups
      .map((exam) => ({
        ...exam,
        questions: exam.questions.filter((question) =>
          [exam.exam_label, question.question_label, question.question_content]
            .join(" ")
            .toLowerCase()
            .includes(keyword),
        ),
      }))
      .filter((exam) => exam.questions.length > 0);
  }, [scopedExamGroups, searchText, gradingMode]);

  const filteredExportExams = useMemo(() => {
    const keyword = exportExamSearch.trim().toLowerCase();
    const scoped = scopedExamId
      ? exportExams.filter((exam) => exam.exam_id === scopedExamId)
      : exportExams;
    if (!keyword) return scoped;
    return scoped.filter((exam) =>
      [exam.exam_label, exam.exam_id].join(" ").toLowerCase().includes(keyword),
    );
  }, [exportExams, exportExamSearch, scopedExamId]);

  const orderedExamGroups = useMemo(() => {
    const sorted = [...filteredExamGroups].sort(
      (left, right) => new Date(right.exam_date).getTime() - new Date(left.exam_date).getTime(),
    );

    const applyCountOverrides = (exam: GradingInboxExamGroup): GradingInboxExamGroup => ({
      ...exam,
      questions: exam.questions.map((question) => {
        const override = questionCountOverrides[buildQuestionRef(exam.exam_id, question.question_id)];
        return override ? { ...question, ...override } : question;
      }),
    });

    const pending = sorted
      .filter((exam) => exam.questions.some((question) => question.pending_count > 0))
      .map(applyCountOverrides);
    const completed = sorted
      .filter((exam) => exam.questions.every((question) => question.pending_count === 0))
      .map(applyCountOverrides);

    return {
      pending,
      completed,
      all: [...pending, ...completed],
    };
  }, [filteredExamGroups, questionCountOverrides]);

  useEffect(() => {
    const questions = orderedExamGroups.all.flatMap((exam) =>
      exam.questions.map((question) => ({
        ref: buildQuestionRef(exam.exam_id, question.question_id),
      })),
    );
    if (questions.length === 0) return;
    if (selectedQuestionRef && questions.some((question) => question.ref === selectedQuestionRef)) {
      return;
    }
    setSelectedQuestionRef(questions[0].ref);
  }, [orderedExamGroups, selectedQuestionRef]);

  useEffect(() => {
    if (filteredExamGroups.length > 0) return;
    setSelectedQuestionRef(null);
    setQuestionDetail(null);
    setSelectedTaskId(null);
    setCandidateDetail(null);
    setShowFollowUpWorkspace(false);
  }, [filteredExamGroups.length]);

  useEffect(() => {
    if (orderedExamGroups.all.length === 0) {
      setExpandedExamGroups(new Set());
      return;
    }

    const validExamKeys = new Set(orderedExamGroups.all.map((exam) => exam.exam_id ?? "standalone"));
    const selectedExamKey = selectedQuestionRef?.split("::")[0] ?? null;

    setExpandedExamGroups((current) => {
      const next = new Set(Array.from(current).filter((key) => validExamKeys.has(key)));
      if (next.size === 0) {
        next.add(orderedExamGroups.all[0].exam_id ?? "standalone");
      }
      if (selectedExamKey && validExamKeys.has(selectedExamKey)) {
        next.add(selectedExamKey);
      }
      return next;
    });
  }, [orderedExamGroups, selectedQuestionRef]);

  useEffect(() => {
    // 仅题目模式按 selectedQuestionRef 加载题目并选定 task；考生模式由考生导航策略掌控 selectedTaskId
    if (gradingMode !== "question") return;
    if (!selectedQuestionRef || !inbox) return;
    const [examIdRaw, questionId] = selectedQuestionRef.split("::");
    const examId = examIdRaw === "standalone" ? null : examIdRaw;
    void loadQuestion(examId, questionId).then((payload) => {
      if (!payload) return;
      const preferredCandidate = payload.candidates[0];
      if (preferredCandidate) {
        setSelectedTaskId((current) =>
          payload.candidates.some((candidate) => candidate.task_id === current)
            ? current
            : preferredCandidate.task_id,
        );
      } else {
        setSelectedTaskId(null);
      }
    });
  }, [selectedQuestionRef, inbox, gradingMode]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void loadCandidate(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void markCandidateViewed(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!showFollowUpWorkspace) return;
    const baseEntry = buildBaseEvaluationEntry(candidateDetail);
    setFollowUpConversation(baseEntry ? [baseEntry] : []);
    setPromptDraft("");
  }, [selectedTaskId, showFollowUpWorkspace, candidateDetail]);

  const summaryStats = useMemo(() => {
    const exams = scopedExamGroups.map((exam) => ({
      ...exam,
      questions: exam.questions.map((question) => {
        const override = questionCountOverrides[buildQuestionRef(exam.exam_id, question.question_id)];
        return override ? { ...question, ...override } : question;
      }),
    }));
    const examCount = exams.length;
    const questionCount = exams.reduce((total, exam) => total + exam.questions.length, 0);
    const pendingCount = exams.reduce(
      (total, exam) =>
        total +
        exam.questions.reduce((questionTotal, question) => questionTotal + question.pending_count, 0),
      0,
    );
    const completedCount = exams.reduce(
      (total, exam) =>
        total +
        exam.questions.reduce((questionTotal, question) => questionTotal + question.completed_count, 0),
      0,
    );

    return { examCount, questionCount, pendingCount, completedCount };
  }, [scopedExamGroups, questionCountOverrides]);

  const sortedCandidates = useMemo(() => {
    if (!questionDetail) return [];
    return questionDetail.candidates;
  }, [questionDetail]);

  const activeCandidate = useMemo(
    () => sortedCandidates.find((candidate) => candidate.task_id === selectedTaskId) ?? sortedCandidates[0] ?? null,
    [sortedCandidates, selectedTaskId],
  );

  const activeCandidateIndex = useMemo(
    () => sortedCandidates.findIndex((candidate) => candidate.task_id === activeCandidate?.task_id),
    [sortedCandidates, activeCandidate],
  );

  useEffect(() => {
    // 仅题目模式做此对齐；考生模式的 selectedTaskId 由考生导航策略掌控
    if (gradingMode !== "question") return;
    if (!activeCandidate) return;
    if (selectedTaskId !== activeCandidate.task_id) {
      setSelectedTaskId(activeCandidate.task_id);
    }
  }, [activeCandidate, selectedTaskId, gradingMode]);

  const navigateCandidateByOffset = (offset: -1 | 1) => {
    if (!activeCandidate) return;
    setCandidateTransitionDirection(offset === 1 ? "next" : "prev");
    const ids = sortedCandidates.map((candidate) => candidate.task_id);
    const currentIndex = ids.indexOf(activeCandidate.task_id);
    const nextIndex = currentIndex + offset;
    if (nextIndex >= 0 && nextIndex < ids.length) {
      setSelectedTaskId(ids[nextIndex]);
      return;
    }

    if (offset === 1) {
      const questions = filteredExamGroups.flatMap((exam) =>
        exam.questions.map((question) => ({
          ref: buildQuestionRef(exam.exam_id, question.question_id),
        })),
      );
      const questionIndex = questions.findIndex((item) => item.ref === selectedQuestionRef);
      if (questionIndex >= 0 && questionIndex < questions.length - 1) {
        setSelectedQuestionRef(questions[questionIndex + 1].ref);
      }
    }
  };

  const finalizeCurrentScore = async (scoreOverride?: number) => {
    if (!selectedTaskId || !candidateDetail) return true;
    const currentTaskId = selectedTaskId;
    const wasAlreadyConfirmed = isConfirmedCandidateStatus(
      activeCandidate?.status ?? candidateDetail.status,
    );
    const scoreValue = scoreOverride !== undefined ? scoreOverride : Number(manualScore);
    if (Number.isNaN(scoreValue)) return false;

    const suggestedScore = candidateDetail.suggested_score;
    const scoreChanged = suggestedScore == null || scoreValue !== suggestedScore;

    try {
      if (scoreChanged) {
        setActionLoading("manual");
        await apiRequest(`/grading/tasks/${selectedTaskId}/manual-score`, {
          method: "POST",
          body: JSON.stringify({
            score_total: scoreValue,
            reason: autoScoreReason ?? "教师人工确认",
          }),
        });
      }

      setActionLoading("confirm");
      await apiRequest<GradingConfirmResponse>(`/grading/tasks/${selectedTaskId}/confirm`, {
        method: "POST",
      });

      const confirmedStatus = scoreChanged ? "人工改分" : "已确认";
      setQuestionDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          candidates: current.candidates.map((candidate) =>
            candidate.task_id === currentTaskId
              ? {
                  ...candidate,
                  status: confirmedStatus,
                  score: scoreValue,
                  manual_override: candidate.manual_override || scoreChanged,
                }
              : candidate,
          ),
        };
      });
      setCandidateDetail((current) =>
        current?.task_id === currentTaskId
          ? { ...current, status: confirmedStatus, suggested_score: scoreValue }
          : current,
      );
      if (gradingMode === "question" && !wasAlreadyConfirmed && questionDetail) {
        const questionRef = buildQuestionRef(questionDetail.exam_id, questionDetail.question_id);
        const baseQuestion = inbox?.exams
          .find((exam) => (exam.exam_id ?? "standalone") === (questionDetail.exam_id ?? "standalone"))
          ?.questions.find((question) => question.question_id === questionDetail.question_id);
        setQuestionCountOverrides((current) => {
          const counts = current[questionRef] ?? {
            pending_count: baseQuestion?.pending_count ?? 0,
            completed_count: baseQuestion?.completed_count ?? 0,
          };
          return {
            ...current,
            [questionRef]: {
              pending_count: Math.max(0, counts.pending_count - 1),
              completed_count: counts.completed_count + 1,
            },
          };
        });
      }
      setAutoScoreReason(null);
      setActionLoading(null);
      return true;
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "确定分数失败");
      setActionLoading(null);
      return false;
    }
  };

  const handleStepCandidate = (offset: -1 | 1) => {
    navigateCandidateByOffset(offset);
  };

  // ——— 按考生阅卷：聚合与导航（纯前端，复用现有接口）———
  const loadExamCandidateMatrix = async (examKey: string) => {
    const examGroup = orderedExamGroups.all.find(
      (exam) => (exam.exam_id ?? "standalone") === examKey,
    );
    if (!examGroup) return;
    setLoadingCandidateGroups(true);
    try {
      const examId = examGroup.exam_id; // null => standalone
      const entries = await Promise.all(
        examGroup.questions.map(async (question) => {
          const payload = await apiRequest<GradingQuestionDetailResponse>(
            `/grading/inbox/questions/${examId ?? "standalone"}/${question.question_id}`,
          );
          const hydrated: GradingQuestionDetailResponse = {
            ...payload,
            candidates: payload.candidates.map((candidate) =>
              viewedTaskIdsRef.current.has(candidate.task_id)
                ? { ...candidate, viewed: true }
                : candidate,
            ),
          };
          return [question.question_id, hydrated] as const;
        }),
      );
      setExamQuestionCandidates(Object.fromEntries(entries));
      if (examId) {
        try {
          const scorePayload = await apiRequest<ExamCandidateScoresResponse>(
            `/grading/exams/${examId}/candidate-scores`,
          );
          setCandidateScoreMap(
            new Map(scorePayload.candidates.map((candidate) => [candidate.candidate_key, candidate])),
          );
        } catch {
          // 非阻塞：分数加载失败不影响主流程
        }
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "加载考生列表失败");
    } finally {
      setLoadingCandidateGroups(false);
    }
  };

  // 进入考生模式 / 切换展开的考试 / 刷新数据时，加载该考试的考生矩阵
  useEffect(() => {
    if (gradingMode !== "candidate") return;
    if (orderedExamGroups.all.length === 0) return;
    const exists = orderedExamGroups.all.some(
      (exam) => (exam.exam_id ?? "standalone") === candidateExamKey,
    );
    if (!candidateExamKey || !exists) {
      setCandidateExamKey(orderedExamGroups.all[0].exam_id ?? "standalone");
      return; // 下一轮再加载
    }
    void loadExamCandidateMatrix(candidateExamKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradingMode, candidateExamKey, inbox]);

  const candidateGroups = useMemo<CandidateGroup[]>(() => {
    const examGroup = orderedExamGroups.all.find(
      (exam) => (exam.exam_id ?? "standalone") === candidateExamKey,
    );
    if (!examGroup) return [];
    const map = new Map<string, CandidateGroup>();
    for (const question of examGroup.questions) {
      const detail = examQuestionCandidates[question.question_id];
      if (!detail) continue;
      for (const task of detail.candidates) {
        const key = task.candidate_code ?? task.candidate_name;
        if (!map.has(key)) {
          map.set(key, {
            candidateKey: key,
            candidateName: task.candidate_name,
            candidateCode: task.candidate_code,
            studentId: task.student_id,
            cells: [],
            pendingCount: 0,
            completedCount: 0,
          });
        }
        map.get(key)!.cells.push({
          questionId: question.question_id,
          questionLabel: question.question_label,
          questionContent: question.question_content,
          questionType: question.question_type,
          maxScore: question.max_score,
          task,
        });
      }
    }
    const order = examGroup.questions.map((question) => question.question_id);
    for (const group of map.values()) {
      group.cells.sort((a, b) => order.indexOf(a.questionId) - order.indexOf(b.questionId));
      group.completedCount = group.cells.filter((cell) =>
        isConfirmedCandidateStatus(cell.task.status),
      ).length;
      group.pendingCount = group.cells.length - group.completedCount;
    }
    return Array.from(map.values());
  }, [orderedExamGroups, candidateExamKey, examQuestionCandidates]);

  const visibleCandidateGroups = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return candidateGroups;
    return candidateGroups.filter((group) =>
      [group.candidateName, group.candidateCode ?? ""].join(" ").toLowerCase().includes(keyword),
    );
  }, [candidateGroups, searchText]);

  const activeCandidateGroup = useMemo(
    () =>
      candidateGroups.find((group) => group.candidateKey === selectedCandidateKey) ??
      candidateGroups[0] ??
      null,
    [candidateGroups, selectedCandidateKey],
  );

  const currentCellIndex = useMemo(
    () => activeCandidateGroup?.cells.findIndex((cell) => cell.task.task_id === selectedTaskId) ?? -1,
    [activeCandidateGroup, selectedTaskId],
  );
  const currentCell = currentCellIndex >= 0 ? activeCandidateGroup!.cells[currentCellIndex] : null;

  // 整卷视图所需：真实考试 UUID + 考生 UUID（standalone 或缺 ID 时不可用）
  const resolvedExamId =
    candidateExamKey && candidateExamKey !== "standalone" ? candidateExamKey : scopedExamId;
  const paperViewAvailable =
    gradingMode === "candidate" && Boolean(resolvedExamId) && Boolean(activeCandidateGroup?.studentId);
  const showPaperView = paperViewAvailable && candidatePaneView === "paper";
  const activeCandidateGroupIndex = candidateGroups.findIndex(
    (group) => group.candidateKey === activeCandidateGroup?.candidateKey,
  );

  const pickFirstPendingTask = (group: CandidateGroup | null) => {
    if (!group) return;
    const firstPending = group.cells.find((cell) => !isConfirmedCandidateStatus(cell.task.status));
    setSelectedTaskId((firstPending ?? group.cells[0])?.task.task_id ?? null);
  };

  // 选中考生（或考生组重建）后，若当前 task 不属于该考生则定位到首道待评题
  useEffect(() => {
    if (gradingMode !== "candidate") return;
    if (!activeCandidateGroup) return;
    const belongs = activeCandidateGroup.cells.some((cell) => cell.task.task_id === selectedTaskId);
    if (!belongs) pickFirstPendingTask(activeCandidateGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradingMode, activeCandidateGroup]);

  const stepCandidateQuestion = (offset: -1 | 1) => {
    if (!activeCandidateGroup || currentCellIndex < 0) return;
    const next = currentCellIndex + offset;
    if (next < 0 || next >= activeCandidateGroup.cells.length) return;
    setCandidateTransitionDirection(offset === 1 ? "next" : "prev");
    setSelectedTaskId(activeCandidateGroup.cells[next].task.task_id);
  };

  const stepCandidatePerson = (offset: -1 | 1) => {
    const index = candidateGroups.findIndex(
      (group) => group.candidateKey === activeCandidateGroup?.candidateKey,
    );
    const next = index + offset;
    if (next < 0 || next >= candidateGroups.length) return;
    const group = candidateGroups[next];
    setCandidateTransitionDirection(offset === 1 ? "next" : "prev");
    setSelectedCandidateKey(group.candidateKey);
    pickFirstPendingTask(group);
  };

  // 确定分数：两种模式共用。考生模式下同步缓存状态并自动跳到本考生下一道待评题
  const handleConfirmScoreSmart = async (scoreOverride?: number) => {
    const confirmedTaskId = selectedTaskId;
    const cellQuestionId = currentCell?.questionId ?? null;
    const effectiveScore = scoreOverride !== undefined ? scoreOverride : Number(manualScore);
    const scoreChanged =
      candidateDetail?.suggested_score == null ||
      effectiveScore !== candidateDetail.suggested_score;
    const ok = await finalizeCurrentScore(scoreOverride);
    if (!ok) return;
    if (gradingMode === "question") {
      navigateCandidateByOffset(1);
      return;
    }
    if (confirmedTaskId && cellQuestionId) {
      const confirmedStatus = scoreChanged ? "人工改分" : "已确认";
      setExamQuestionCandidates((current) => {
        const detail = current[cellQuestionId];
        if (!detail) return current;
        return {
          ...current,
          [cellQuestionId]: {
            ...detail,
            candidates: detail.candidates.map((candidate) =>
              candidate.task_id === confirmedTaskId
                ? {
                    ...candidate,
                    status: confirmedStatus,
                    manual_override: candidate.manual_override || scoreChanged,
                  }
                : candidate,
            ),
          },
        };
      });
    }
    const rest = (activeCandidateGroup?.cells ?? []).filter(
      (cell) =>
        cell.task.task_id !== confirmedTaskId && !isConfirmedCandidateStatus(cell.task.status),
    );
    if (rest[0]) {
      setCandidateTransitionDirection("next");
      setSelectedTaskId(rest[0].task.task_id);
    }
  };

  const handlePromptFollowUp = async () => {
    if (!selectedTaskId || !promptDraft.trim()) return;
    const nextPrompt = promptDraft.trim();
    setFollowUpStreaming(true);
    setReportError(null);
    setPromptDraft("");
    setFollowUpConversation((current) => [...current, { prompt: nextPrompt, pending: true, models: [] }]);

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch(`/api/grading/tasks/${selectedTaskId}/follow-up/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: nextPrompt, locale: getUiLocale() }),
      });
      if (!response.ok || !response.body) {
        throw new Error(await response.text() || `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const dataLine = eventText
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.replace(/^data:\s*/, "")) as {
            event: string;
            stage?: "primary" | "review" | "arbiter";
            model_label?: string;
            content?: string;
            model?: GradingPromptFollowUpResponse["models"][number];
            message?: string;
          };

          if (event.event === "model_start" && event.stage && event.model_label) {
            setFollowUpConversation((current) =>
              current.map((item, index) =>
                index === current.length - 1
                  ? {
                      ...item,
                      models: [
                        ...item.models,
                        {
                          stage: event.stage!,
                          model_label: event.model_label!,
                          score: 0,
                          summary: "",
                          process: [],
                          risk_flags: [],
                          streamingText: "",
                        },
                      ],
                    }
                  : item,
              ),
            );
          }

          if (event.event === "model_delta" && event.stage && event.content) {
            setFollowUpConversation((current) =>
              current.map((item, index) =>
                index === current.length - 1
                  ? {
                      ...item,
                      models: item.models.map((model) =>
                        model.stage === event.stage
                          ? { ...model, streamingText: `${model.streamingText ?? ""}${event.content}` }
                          : model,
                      ),
                    }
                  : item,
              ),
            );
          }

          if (event.event === "model_done" && event.stage && event.model) {
            setFollowUpConversation((current) =>
              current.map((item, index) =>
                index === current.length - 1
                  ? {
                      ...item,
                      models: item.models.map((model) =>
                        model.stage === event.stage ? event.model! : model,
                      ),
                    }
                  : item,
              ),
            );
          }

          if (event.event === "model_error") {
            throw new Error(event.message || "模型复评失败");
          }

          if (event.event === "done") {
            setFollowUpConversation((current) =>
              current.map((item, index) =>
                index === current.length - 1 ? { ...item, pending: false } : item,
              ),
            );
          }
        }
      }
      await loadCandidate(selectedTaskId);
    } catch (error) {
      setFollowUpConversation((current) =>
        current.map((item, index) =>
          index === current.length - 1 ? { ...item, pending: false } : item,
        ),
      );
      setReportError(error instanceof Error ? error.message : "追加 Prompt 复评失败");
    } finally {
      setFollowUpStreaming(false);
    }
  };

  const questionSummary = formatQuestionSummary(questionDetail);
  const questionPreview = useMemo(() => toQuestionPreview(questionDetail), [questionDetail]);
  const hasVisibleQuestions = filteredExamGroups.length > 0;
  const hasAnswerAttachment = (candidateDetail?.attachment_refs?.length ?? 0) > 0;
  const hasAnswerText = Boolean(candidateDetail?.student_answer_raw?.trim());

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-0 py-4">
      <AttachmentPreviewDialog
        attachment={previewAttachment}
        open={!!previewAttachment}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      />
      {actionLoading === "run" && !followUpStreaming && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-background px-8 py-10 shadow-2xl border border-border/50">
            <RefreshCw className="h-10 w-10 animate-spin text-primary" />
            <div className="space-y-1 text-center">
              <p className="text-lg font-semibold">正在重新评分</p>
              <p className="text-sm text-muted-foreground">AI 正在根据您的 Prompt 重新审阅答案，请稍候...</p>
            </div>
          </div>
        </div>
      )}
      {!showFollowUpWorkspace ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border/70 px-4 pb-4">
          <div className="min-w-0 justify-self-start">
            {(() => {
              const fullTitle = scopedExamId
                ? (scopedExamGroups[0]?.exam_label ?? "阅卷中心")
                : "阅卷中心";
              const isLong = fullTitle.length > 30;
              const display = isLong ? `${fullTitle.slice(0, 30)}…` : fullTitle;
              if (!isLong) {
                return (
                  <h1 className="truncate text-base font-bold tracking-tight">{display}</h1>
                );
              }
              return (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <h1 className="cursor-default truncate text-base font-bold tracking-tight">
                        {display}
                      </h1>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-md">
                      {fullTitle}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {scopedExamId
                ? `共 ${summaryStats.questionCount} 道主观题，待处理 ${summaryStats.pendingCount} 份，已完成 ${summaryStats.completedCount} 份`
                : `当前共有 ${summaryStats.examCount} 场考试、${summaryStats.questionCount} 道题，待处理 ${summaryStats.pendingCount} 份，已完成 ${summaryStats.completedCount} 份`}
            </p>
          </div>
          <div className="justify-self-center">
            <div className="inline-flex items-center gap-0.5 rounded-[10px] bg-muted p-1">
              {(
                [
                  { key: "question", label: "按题目阅卷", Icon: List },
                  { key: "candidate", label: "按考生阅卷", Icon: Users },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setGradingMode(key);
                    setSidebarHidden(key === "candidate");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[7px] px-[18px] py-2 text-[13.5px] font-semibold transition-all",
                    gradingMode === key
                      ? "bg-primary text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.35)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-self-end items-center gap-2">
            {backTo ? (
              <Button variant="outline" size="sm" onClick={() => navigate(backTo)}>
                <ArrowLeft className="h-4 w-4" />
                {backLabel}
              </Button>
            ) : null}
            <Popover
              open={exportPanelOpen}
              onOpenChange={(open) => {
                setExportPanelOpen(open);
                if (!open) {
                  setExportExamSearch("");
                  setExportError(null);
                }
              }}
            >
              <TooltipProvider delayDuration={500}>
                <Tooltip>
                  <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FileDown className="h-4 w-4" />
                        导出
                      </Button>
                    </TooltipTrigger>
                  </PopoverTrigger>
                  <TooltipContent side="bottom">
                    导出本场考试下所有考生的分数
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <PopoverContent align="end" side="bottom" sideOffset={10} className="w-[420px] p-0">
                <div className="flex flex-col gap-3 p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={exportExamSearch}
                      onChange={(event) => setExportExamSearch(event.target.value)}
                      placeholder="搜索考试名称或考试编号"
                      className="pl-9"
                    />
                  </div>

                  {exportError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {exportError}
                    </div>
                  ) : null}

                  <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border/70">
                    {loadingExportExams ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">正在加载考试...</div>
                    ) : filteredExportExams.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">没有找到可导出的考试。</div>
                    ) : (
                      <div className="divide-y divide-border/70">
                        {filteredExportExams.map((exam) => (
                          <button
                            key={exam.exam_id}
                            type="button"
                            onClick={() => void exportExamScores(exam)}
                            disabled={exportingExamId !== null}
                            className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{exam.exam_label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {new Date(exam.exam_date).toLocaleDateString("zh-CN")} · {exam.question_count} 道题 · {exam.candidate_count} 位考生
                              </p>
                            </div>
                            <span className="shrink-0 text-xs font-medium text-primary">
                              {exportingExamId === exam.exam_id ? "导出中..." : "导出"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {gradingMode === "candidate" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    {candidatePaneView === "paper" ? "整卷视图" : "逐题批改"}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuRadioGroup
                    value={candidatePaneView}
                    onValueChange={(value) => setCandidatePaneView(value as "workflow" | "paper")}
                  >
                    <DropdownMenuRadioItem value="workflow">逐题批改</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="paper" disabled={!paperViewAvailable}>
                      整卷视图
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}

      <main
        className={cn(
          "relative grid min-h-0 flex-1 gap-0 overflow-hidden transition-[grid-template-columns] duration-500 ease-in-out",
          sidebarHidden ? "xl:grid-cols-[0px_minmax(0,1fr)]" : "xl:grid-cols-[360px_minmax(0,1fr)]",
          showFollowUpWorkspace &&
            "pointer-events-none scale-[0.985] opacity-0 blur-[2px] transition-all duration-200 ease-out",
        )}
      >
        {/* 左右栏分隔线中部的显示/隐藏左栏按钮 */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSidebarHidden((prev) => !prev)}
                aria-label={sidebarHidden ? "显示左栏" : "隐藏左栏"}
                style={{ left: sidebarHidden ? 14 : 360 }}
                className="absolute top-1/2 z-20 hidden h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/35 bg-primary/12 text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.18),0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-300 ease-in-out hover:scale-110 hover:border-primary/60 hover:bg-primary/20 hover:shadow-[0_4px_14px_hsl(var(--primary)/0.28),0_2px_4px_rgba(0,0,0,0.08)] active:scale-95 xl:flex"
              >
                {sidebarHidden ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {sidebarHidden ? "显示左栏" : "隐藏左栏"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <section
          className={cn(
            "min-h-0 min-w-0 overflow-hidden border-r border-border transition-opacity duration-500 ease-in-out dark:border-white/15",
            sidebarHidden && "pointer-events-none border-r-0 opacity-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 pt-4 pb-2">
            <div className="shrink-0 space-y-3 border-b border-border/70 pb-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {gradingMode === "candidate" ? "待阅试卷和考生" : "待阅试卷和题目"}
              </h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder={gradingMode === "candidate" ? "搜索考生或考试" : "搜索题目或考试"}
                  className="h-10 rounded-lg pl-9"
                />
              </div>
            </div>

            <div className="grading-sidebar-scroll min-h-0 flex-1 overflow-y-scroll pt-4 pr-2">
              {loadingInbox ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  正在加载题目列表...
                </div>
              ) : orderedExamGroups.all.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  当前没有可展示的题目。
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { key: "pending", label: "待确定试卷", exams: orderedExamGroups.pending, completed: false },
                    { key: "completed", label: "已确定试卷", exams: orderedExamGroups.completed, completed: true },
                  ].map((section) =>
                    section.exams.length > 0 ? (
                      <div key={section.key} className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                          {section.label}
                        </p>
                        <div className="space-y-0">
                          {section.exams.map((exam: GradingInboxExamGroup) => {
                            const examKey = exam.exam_id ?? "standalone";
                            const isExpanded = expandedExamGroups.has(examKey);

                            return (
                              <div
                                key={examKey}
                                className="space-y-2 border-b border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (gradingMode === "candidate") {
                                      // 考生模式：单开手风琴，并把展开的考试设为当前考生矩阵来源
                                      setExpandedExamGroups((current) =>
                                        current.has(examKey) && candidateExamKey === examKey
                                          ? new Set()
                                          : new Set([examKey]),
                                      );
                                      setCandidateExamKey(examKey);
                                      return;
                                    }
                                    setExpandedExamGroups((current) => {
                                      const next = new Set(current);
                                      if (next.has(examKey)) {
                                        next.delete(examKey);
                                      } else {
                                        next.add(examKey);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="flex w-full items-start justify-between gap-3 rounded-md text-left transition-colors hover:bg-accent/20"
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <h3 className="text-sm text-foreground/90">{exam.exam_label}</h3>
                                      {section.completed ? (
                                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                          已确定
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {new Date(exam.exam_date).toLocaleDateString("zh-CN")}
                                    </p>
                                  </div>
                                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </span>
                                </button>

                                {isExpanded && gradingMode === "candidate" ? (
                                  <div className="space-y-2">
                                    {examKey !== candidateExamKey ? null : loadingCandidateGroups ? (
                                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                                        正在加载考生...
                                      </div>
                                    ) : visibleCandidateGroups.length === 0 ? (
                                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                                        {candidateGroups.length === 0 ? "暂无考生。" : "没有匹配的考生。"}
                                      </div>
                                    ) : (
                                      visibleCandidateGroups.map((group) => {
                                        const selected = group.candidateKey === activeCandidateGroup?.candidateKey;
                                        return (
                                          <button
                                            key={group.candidateKey}
                                            type="button"
                                            onClick={() => {
                                              setCandidateTransitionDirection("neutral");
                                              setSelectedCandidateKey(group.candidateKey);
                                              pickFirstPendingTask(group);
                                            }}
                                            className={cn(
                                              "w-full rounded-lg border px-3 py-3 text-left transition-all",
                                              selected
                                                ? "border-primary/60 bg-primary/8"
                                                : "border-transparent bg-background hover:border-border hover:bg-accent/30",
                                            )}
                                          >
                                            {(() => {
                                              const scoreEntry = candidateScoreMap.get(group.candidateKey);
                                              const subjConfirmed = group.cells.reduce(
                                                (sum, cell) =>
                                                  sum + (isConfirmedCandidateStatus(cell.task.status) ? (cell.task.score ?? 0) : 0),
                                                0,
                                              );
                                              return (
                                                <>
                                                  <div className="flex items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-1.5">
                                                      <span className="truncate text-sm font-semibold text-foreground/85">
                                                        {group.candidateName}
                                                      </span>
                                                      {group.pendingCount > 0 ? (
                                                        <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                                          {group.pendingCount}
                                                        </span>
                                                      ) : null}
                                                      {group.completedCount > 0 ? (
                                                        <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                                          {group.completedCount}
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                    <span className="shrink-0 text-xs text-muted-foreground">
                                                      主观题 {subjConfirmed} 分
                                                    </span>
                                                  </div>
                                                  <div className="mt-1 flex items-center justify-between gap-2">
                                                    <span className="text-xs text-muted-foreground">
                                                      共 {group.cells.length} 题 · 待评 {group.pendingCount}
                                                    </span>
                                                    {scoreEntry ? (
                                                      <span className="shrink-0 text-[11px] text-muted-foreground">
                                                        客观题 {scoreEntry.objective_score ?? "—"} 分 · 总得 {scoreEntry.objective_score != null ? scoreEntry.objective_score + subjConfirmed : "—"} 分
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                </>
                                              );
                                            })()}
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                ) : isExpanded ? (
                                  <div className="space-y-2">
                                    {exam.questions.map((question: GradingInboxQuestionItem) => {
                                      const selected = selectedQuestionRef === buildQuestionRef(exam.exam_id, question.question_id);
                                      return (
                                        <button
                                          key={question.question_key}
                                          type="button"
                                          onClick={() =>
                                            setSelectedQuestionRef(buildQuestionRef(exam.exam_id, question.question_id))
                                          }
                                          className={cn(
                                            "w-full rounded-lg border border-transparent px-3 py-3 text-left transition-all hover:border-border hover:bg-accent/30",
                                            selected
                                              ? "border-primary/60 bg-primary/8"
                                              : "bg-background",
                                          )}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 space-y-1">
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                  {questionTypeLabel(question.question_type)}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                  总分 {question.max_score}
                                                </span>
                                              </div>
                                              <p className="truncate text-xs text-muted-foreground">
                                                <LatexText>{question.question_content}</LatexText>
                                              </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                              {question.pending_count > 0 ? (
                                                <TooltipProvider delayDuration={120}>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                                        {question.pending_count}
                                                      </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>待处理人数</TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              ) : null}
                                              {question.completed_count > 0 ? (
                                                <TooltipProvider delayDuration={120}>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                                                        {question.completed_count}
                                                      </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>已完成人数</TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              ) : null}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-180px)] flex-col">
          {loadingInbox && !hasVisibleQuestions ? (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center px-8">
              <div className="flex flex-col items-center gap-3 text-center">
                <RefreshCw className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在加载阅卷数据...</p>
              </div>
            </div>
          ) : !hasVisibleQuestions ? (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center px-8">
              <div className="max-w-md space-y-3 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Search className="h-5 w-5" />
                </div>
                <h2 className="text-base font-semibold text-foreground">暂无可阅卷题目</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  当前筛选条件下没有主观题或代码题。你可以调整搜索条件，或等待考试提交后再回来查看。
                </p>
              </div>
            </div>
          ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              showPaperView ? "" : "px-4 pt-2 pb-0",
            )}
          >
            {showPaperView ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <WholePaperView
                  examId={resolvedExamId!}
                  studentId={activeCandidateGroup!.studentId!}
                  candidateName={activeCandidateGroup?.candidateName}
                  candidateCode={activeCandidateGroup?.candidateCode}
                  onScoreSaved={() => {
                    if (candidateExamKey) void loadExamCandidateMatrix(candidateExamKey);
                  }}
                  onPrevCandidate={() => stepCandidatePerson(-1)}
                  onNextCandidate={() => stepCandidatePerson(1)}
                  canPrevCandidate={activeCandidateGroupIndex > 0}
                  canNextCandidate={
                    activeCandidateGroupIndex >= 0 && activeCandidateGroupIndex < candidateGroups.length - 1
                  }
                />
              </div>
            ) : (
            <>
            {gradingMode === "candidate" ? null : (
            <section className="space-y-2 border-b border-border/70 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {(questionDetail?.knowledge_tags ?? []).map((tag) => (
                      <span key={tag} className="text-xs text-muted-foreground/90">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    题目：<LatexText>{questionSummary}</LatexText>
                  </p>
                </div>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setQuestionExpanded((current) => !current)}
                        aria-label={questionExpanded ? "收起题目" : "展开题目"}
                      >
                        {questionExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{questionExpanded ? "收起题目" : "展开题目"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {questionExpanded && questionDetail ? (
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  {questionPreview ? (
                    <QuestionPreviewCard
                      question={questionPreview}
                      mode="compact"
                      defaultExpanded
                      className="border-0 bg-transparent p-0 shadow-none"
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
            )}

            <div
              className={cn(
                "grid min-h-0 flex-1 gap-0 overflow-hidden",
                showCandidateList
                  ? "xl:grid-cols-[300px_minmax(0,1fr)]"
                  : "xl:grid-cols-[minmax(0,1fr)]",
              )}
            >
              {showCandidateList ? (
                <section className="flex min-h-0 flex-col border-r border-border/70 pr-6 dark:border-white/15">
                <div className="flex items-center justify-between pb-4 pt-1.5">
                  {gradingMode === "candidate" && activeCandidateGroup ? (
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground leading-none">
                          {activeCandidateGroup.candidateName}
                        </span>
                        {activeCandidateGroup.candidateCode ? (
                          <span className="text-xs text-muted-foreground">
                            {activeCandidateGroup.candidateCode}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        主观题{" "}
                        {activeCandidateGroup.cells.reduce(
                          (sum, cell) =>
                            sum + (isConfirmedCandidateStatus(cell.task.status) ? (cell.task.score ?? 0) : 0),
                          0,
                        )}
                        {" / "}
                        {activeCandidateGroup.cells.reduce((sum, cell) => sum + cell.maxScore, 0)}{" 分"}
                        {activeCandidateGroup.pendingCount > 0
                          ? ` · 待批改 ${activeCandidateGroup.pendingCount} 题`
                          : " · 已全部批改"}
                      </span>
                    </div>
                  ) : (
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      {gradingMode === "candidate" ? "该考生题目" : "考生列表"}
                    </h3>
                  )}
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                          onClick={() => setShowCandidateList(false)}
                          aria-label="隐藏考生列表"
                        >
                          <PanelLeftClose className="h-4 w-4" />
                          隐藏
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>隐藏考生列表</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {gradingMode === "candidate" ? (
                  <>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-6">
                    {loadingCandidateGroups ? (
                      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                        正在加载题目...
                      </div>
                    ) : !activeCandidateGroup ? (
                      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                        请选择左侧考生。
                      </div>
                    ) : (
                      activeCandidateGroup.cells.map((cell, index) => {
                        const active = cell.task.task_id === selectedTaskId;
                        const confirmed = isConfirmedCandidateStatus(cell.task.status);
                        return (
                          <button
                            key={cell.task.task_id}
                            type="button"
                            onClick={() => {
                              setCandidateTransitionDirection("neutral");
                              setSelectedTaskId(cell.task.task_id);
                            }}
                            className={cn(
                              "rounded-[10px] border p-3 text-left transition-all",
                              active
                                ? "border-primary/60 bg-primary/8"
                                : "border-border/80 bg-background hover:border-border hover:bg-accent/30",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-xs font-semibold text-foreground/85">
                                <span
                                  className={cn("h-[7px] w-[7px] rounded-full", statusDotClass(cell.task.status))}
                                />
                                第 {index + 1} 题 · 总分 {cell.maxScore}
                              </span>
                              <span
                                className={cn(
                                  "text-[11px] font-semibold",
                                  confirmed
                                    ? "text-emerald-600"
                                    : cell.task.viewed
                                      ? "text-amber-600"
                                      : "text-rose-600",
                                )}
                              >
                                {confirmed ? "已确定" : cell.task.viewed ? "已查看" : "待批改"}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                              <LatexText>{cell.questionContent}</LatexText>
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-border/70 pt-3 pr-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={
                        !activeCandidateGroup ||
                        candidateGroups.findIndex(
                          (group) => group.candidateKey === activeCandidateGroup.candidateKey,
                        ) <= 0
                      }
                      onClick={() => stepCandidatePerson(-1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一位考生
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={
                        !activeCandidateGroup ||
                        candidateGroups.findIndex(
                          (group) => group.candidateKey === activeCandidateGroup.candidateKey,
                        ) >=
                          candidateGroups.length - 1
                      }
                      onClick={() => stepCandidatePerson(1)}
                    >
                      下一位考生
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  </>
                ) : (
                <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto pr-3 pb-6">
                  {loadingQuestion ? (
                    <div className="col-span-full rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      正在加载考生...
                    </div>
                  ) : (
                    sortedCandidates.map((candidate: GradingQuestionCandidate) => {
                      const isActiveCandidate = candidate.task_id === activeCandidate?.task_id;
                      const showViewedHint =
                        !isActiveCandidate && isViewedIntermediateStatus(candidate.status, candidate.viewed);
                      const candidateButton = (
                        <button
                          key={candidate.task_id}
                          type="button"
                          onClick={() => {
                            setCandidateTransitionDirection("neutral");
                            setSelectedTaskId(candidate.task_id);
                          }}
                          className={cn(
                            "group flex h-8 w-full min-w-0 items-center gap-2 rounded-full border px-3 text-left transition-all duration-200",
                            isActiveCandidate
                              ? "exam-primary-soft-active shadow-sm"
                              : "border-transparent bg-muted/40 text-muted-foreground hover:border-border/50 hover:bg-muted hover:text-foreground",
                            showViewedHint &&
                              "border-dashed border-primary/35 bg-primary/5 hover:border-primary/35 dark:border-primary/45 dark:hover:border-primary/45",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-125",
                              statusDotClass(candidate.status),
                              isActiveCandidate && "ring-2 ring-primary-foreground/30",
                            )}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold tracking-tight",
                              isActiveCandidate ? "text-primary" : "text-foreground/70",
                            )}
                          >
                            {candidate.candidate_name}
                          </span>
                        </button>
                      );

                      return showViewedHint ? (
                        <TooltipProvider key={candidate.task_id} delayDuration={750} skipDelayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>{candidateButton}</TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="duration-300 ease-out data-[state=closed]:duration-75"
                            >
                              您已经查看过但还没确定
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        candidateButton
                      );
                    })
                  )}
                </div>
                )}
                </section>
              ) : null}

              <section className={cn("flex min-h-0 flex-col", showCandidateList ? "pl-6" : "pl-0")}>
                <div
                  key={selectedTaskId ?? "empty-candidate"}
                  className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    candidateTransitionDirection === "next" &&
                      "animate-in fade-in-0 slide-in-from-right-2 duration-200",
                    candidateTransitionDirection === "prev" &&
                      "animate-in fade-in-0 slide-in-from-left-2 duration-200",
                    candidateTransitionDirection === "neutral" &&
                      "animate-in fade-in-0 duration-150",
                  )}
                >
                <div className="border-b border-border/70 py-1.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4">
                    <div className="flex min-w-0 items-center gap-3 text-sm text-foreground/80">
                      {gradingMode === "candidate" ? (
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            第 {currentCellIndex >= 0 ? currentCellIndex + 1 : "-"} 题
                          </span>
                          {currentCell ? (
                            <span className="text-xs text-muted-foreground">
                              总分 {currentCell.maxScore}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="font-medium">{candidateDetail?.candidate_name ?? "-"}</span>
                      )}
                      {!showCandidateList ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 px-2 text-xs"
                                onClick={() => setShowCandidateList(true)}
                              >
                                <PanelLeftOpen className="h-4 w-4" />
                                显示
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>显示考生列表</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => {
                          setShowFollowUpWorkspace(true);
                        }}
                      >
                        追加 Prompt 复评
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground" htmlFor="manual-score-inline">
                          分数
                        </label>
                        <div className="flex flex-col items-start gap-1">
                          <Input
                            id="manual-score-inline"
                            type="number"
                            value={manualScore}
                            onChange={(event) => {
                              setManualScore(event.target.value);
                              setAutoScoreReason(null);
                            }}
                            className="h-8 w-24 rounded-lg"
                          />
                          {autoScoreReason ? (
                            <span className="pl-1 text-[11px] leading-4 text-amber-600">
                              {autoScoreReason}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex">
                        <Button
                          size="sm"
                          onClick={() => void handleConfirmScoreSmart()}
                          disabled={(actionLoading === "manual" || actionLoading === "confirm") || !selectedTaskId}
                          className="rounded-r-none"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {actionLoading === "manual" || actionLoading === "confirm" ? "提交中..." : "确定分数"}
                        </Button>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const score = candidateDetail?.max_score ?? 0;
                                  setManualScore(String(score));
                                  setAutoScoreReason(null);
                                  void handleConfirmScoreSmart(score);
                                }}
                                disabled={(actionLoading === "manual" || actionLoading === "confirm") || !selectedTaskId}
                                className="rounded-none border-l-0"
                              >
                                满分
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              满分 {candidateDetail?.max_score ?? ""} 分，一键确认
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setManualScore("0");
                                  setAutoScoreReason(null);
                                  void handleConfirmScoreSmart(0);
                                }}
                                disabled={(actionLoading === "manual" || actionLoading === "confirm") || !selectedTaskId}
                                className="rounded-l-none border-l-0"
                              >
                                未得分
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>0 分，一键确认</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      {gradingMode === "candidate" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => stepCandidateQuestion(-1)}
                            disabled={currentCellIndex <= 0}
                          >
                            上一题
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => stepCandidateQuestion(1)}
                            disabled={
                              currentCellIndex < 0 ||
                              currentCellIndex >= (activeCandidateGroup?.cells.length ?? 0) - 1
                            }
                          >
                            下一题
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStepCandidate(-1)}
                            disabled={activeCandidateIndex <= 0}
                          >
                            上一个考生
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStepCandidate(1)}
                            disabled={
                              activeCandidateIndex < 0 ||
                              activeCandidateIndex >= sortedCandidates.length - 1
                            }
                          >
                            下一个考生
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {reportError ? (
                    <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {reportError}
                    </p>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto py-6">
                  <div className="space-y-8">
                    <section className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">考生答案</p>
                      <div className="rounded-xl border border-border/50 bg-muted/10 p-4 shadow-sm">
                        {!hasAnswerText && !hasAnswerAttachment ? (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            该考生本题未提供答案。
                          </p>
                        ) : (
                          <div className="space-y-4">
                            {hasAnswerText ? (
                              candidateDetail?.question_type === "code" ? (
                                <CodeBlock code={candidateDetail.student_answer_raw} language="python" />
                              ) : (
                                <p className="text-sm leading-relaxed text-foreground/90">
                                  <LatexText>
                                    {candidateDetail?.student_answer_raw ?? (loadingCandidate ? "正在加载答案..." : "-")}
                                  </LatexText>
                                </p>
                              )
                            ) : null}

                            {hasAnswerAttachment ? (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">附件答案</p>
                                <div className="space-y-2">
                                  {candidateDetail?.attachment_refs.map((attachment) => (
                                    <button
                                      key={`${attachment.name}-${attachment.url}`}
                                      type="button"
                                      onClick={() => setPreviewAttachment(attachment)}
                                      className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 text-left transition-colors hover:bg-accent/40"
                                    >
                                      {isImageAttachment(attachment) ? (
                                        <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                                      ) : (
                                        <FileText className="h-4 w-4 shrink-0 text-primary" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="truncate text-sm text-foreground">{attachment.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {isImageAttachment(attachment) ? "图片附件，点击在线查看" : "Word 附件，点击在线查看"}
                                        </p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </section>

                    {candidateDetail?.student_feedback || candidateDetail?.teacher_feedback_reply ? (
                      <section className="space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">学生反馈</p>
                        <div className="rounded-xl border border-border/50 bg-muted/10 p-4 shadow-sm">
                          <div className="flex flex-col gap-3">
                            {candidateDetail.student_feedback ? (
                              <p className="text-sm leading-relaxed text-foreground/90">
                                {candidateDetail.student_feedback}
                              </p>
                            ) : null}
                            {candidateDetail.feedback_created_at ? (
                              <p className="text-xs text-muted-foreground">
                                提交时间：{new Date(candidateDetail.feedback_created_at).toLocaleString("zh-CN", {
                                  month: "numeric",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            ) : null}
                            {candidateDetail.teacher_feedback_reply ? (
                              <div className="rounded-lg border border-border/60 bg-background px-3 py-3 text-sm leading-relaxed text-muted-foreground">
                                教师回复：{candidateDetail.teacher_feedback_reply}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </section>
                    ) : null}

                    <section className="space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">LLM 评分意见</p>
                      {loadingCandidate ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                          正在分析评分详情...
                        </div>
                      ) : !hasAnswerText && !hasAnswerAttachment ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                          该考生本题未提交答案，暂无 LLM 评分意见。
                        </div>
                      ) : (
                        <>
                          {candidateDetail?.feedback && candidateDetail.feedback.dimensions.length > 0 ? (
                            <div className="rounded-xl border border-border/50 bg-muted/10 p-4 shadow-sm">
                              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Brain className="h-4 w-4 text-primary" />
                                AI 评分详情
                              </div>
                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {candidateDetail.feedback.dimensions.map((dim) => (
                                  <div key={dim.name} className="rounded-xl bg-background p-4">
                                    <div className="flex items-center justify-between text-sm font-medium">
                                      <span>{dimensionLabel(dim.name)}</span>
                                      <span className="text-primary">
                                        {dim.score} / {dim.max_score}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                      <LatexText>{dim.comment}</LatexText>
                                    </p>
                                  </div>
                                ))}
                              </div>
                              {candidateDetail.feedback.strengths.length > 0 ? (
                                <div className="mt-4 rounded-xl bg-background p-4">
                                  <p className="text-xs font-medium text-foreground">优点</p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                                    {candidateDetail.feedback.strengths.map((line) => (
                                      <li key={line}>
                                        <LatexText>{line}</LatexText>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {candidateDetail.feedback.deductions.length > 0 ? (
                                <div className="mt-4 flex flex-col gap-2">
                                  {candidateDetail.feedback.deductions.map((line) => (
                                    <div
                                      key={line}
                                      className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300"
                                    >
                                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                      <span>
                                        <LatexText>{line}</LatexText>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {candidateDetail.feedback.suggestions.length > 0 ? (
                                <div className="mt-4 rounded-xl bg-background p-4 text-sm leading-6 text-muted-foreground">
                                  建议：{candidateDetail.feedback.suggestions.join("；")}
                                </div>
                              ) : null}
                              {candidateDetail.feedback.evidence_lines.length > 0 ? (
                                <div className="mt-4 rounded-xl bg-background p-4">
                                  <p className="text-xs font-medium text-foreground">AI 摘要</p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                                    {candidateDetail.feedback.evidence_lines.map((line) => (
                                      <li key={line}>
                                        <LatexText>{line}</LatexText>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {candidateDetail?.models.map((model) => {
                          const modelLogoSrc = getModelLogoSrc(model.model_label);
                          const stage = model.stage as ExpandedStage;
                          return (
                            <div key={model.stage} className="rounded-xl border border-border/40 bg-background/50 p-1 transition-colors hover:border-border/70">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedStages((current) => ({
                                    ...current,
                                    [stage]: !current[stage],
                                  }))
                                }
                                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border/50">
                                    {modelLogoSrc ? (
                                      <img
                                        src={modelLogoSrc}
                                        alt={model.model_label}
                                        className="h-5 w-5 object-contain"
                                      />
                                    ) : (
                                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold">{toShortModelName(model.model_label)}</p>
                                    <p className="text-[10px] text-muted-foreground uppercase">{stage}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-bold text-primary">建议分数 {model.score}</span>
                                  {expandedStages[stage] ? (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                              </button>
                              {expandedStages[stage] ? (
                                <div className="space-y-5 px-4 pt-1 pb-5 pl-16">
                                  <div className="space-y-4">
                                    <p className="text-sm leading-relaxed text-foreground/80 italic">
                                      <LatexText>{`"${model.summary}"`}</LatexText>
                                    </p>
                                    {model.process.length > 0 ? (
                                      <ul className="space-y-2.5 text-xs text-muted-foreground">
                                        {model.process.map((item) => (
                                          <li key={item} className="flex gap-2">
                                            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                                            <LatexText>{item}</LatexText>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>

                                  {(candidateDetail?.follow_ups ?? []).map((fu) => {
                                    const fuModel = fu.models.find((m) => m.stage === stage);
                                    if (!fuModel) return null;
                                    return (
                                      <div key={fu.prompt} className="relative space-y-3 rounded-lg border-l-2 border-primary/30 bg-primary/5 p-4 transition-all">
                                        <div className="flex items-center gap-2">
                                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                          <p className="text-[10px] font-bold uppercase tracking-tight text-primary/70">
                                            追加复评指令
                                          </p>
                                        </div>
                                        <p className="text-sm font-medium text-foreground/90">
                                          <LatexText>{`"${fu.prompt}"`}</LatexText>
                                        </p>
                                        <div className="space-y-3 border-t border-primary/10 pt-3">
                                          <p className="text-sm leading-relaxed text-foreground/80">
                                            <LatexText>{fuModel.summary}</LatexText>
                                          </p>
                                          <ul className="space-y-2 text-xs text-muted-foreground">
                                            {fuModel.process.map((item) => (
                                              <li key={item} className="flex gap-2">
                                                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />
                                                <LatexText>{item}</LatexText>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        }) ?? null}
                        </>
                      )}
                    </section>
                  </div>
                </div>
                </div>
              </section>
            </div>
            </>
            )}

          </div>
          )}
        </section>
      </main>

      {showFollowUpWorkspace && hasVisibleQuestions ? (
        <section className="fixed inset-0 z-[120] animate-in fade-in-0 zoom-in-[0.985] duration-300 bg-background">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground/90">
                  {candidateDetail?.candidate_name ?? "-"}
                  {candidateDetail?.candidate_code ? ` ｜ ${candidateDetail.candidate_code}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <LatexText>
                    {questionSummary || questionDetail?.question_label || "当前题目"}
                  </LatexText>
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowFollowUpWorkspace(false)} aria-label="退出 Prompt 复评">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
              <aside className="animate-in slide-in-from-left-2 duration-300 flex min-h-0 flex-col border-r border-border/70 bg-muted/10 dark:border-white/15 dark:bg-white/[0.02]">
                <div className="border-b border-border/70 px-5 py-4">
                  <div className="text-sm font-medium">考生列表</div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {loadingQuestion ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
                      正在加载考生...
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {sortedCandidates.map((candidate) => {
                        const isActiveCandidate = candidate.task_id === activeCandidate?.task_id;
                        const showViewedHint =
                          !isActiveCandidate && isViewedIntermediateStatus(candidate.status, candidate.viewed);
                        const candidateButton = (
                          <button
                            key={`followup-${candidate.task_id}`}
                            type="button"
                            onClick={() => {
                              setCandidateTransitionDirection("neutral");
                              setSelectedTaskId(candidate.task_id);
                            }}
                            className={cn(
                              "group mx-2 my-1 flex min-h-11 w-auto items-center gap-3 rounded-lg border border-transparent px-3 text-left transition-all duration-200",
                              isActiveCandidate
                                ? "bg-accent text-accent-foreground"
                                : "bg-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                              showViewedHint &&
                                "border-dashed border-primary/35 bg-primary/5 hover:border-primary/35 dark:border-primary/45 dark:hover:border-primary/45",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full transition-transform group-hover:scale-125",
                                statusDotClass(candidate.status),
                                isActiveCandidate && "ring-2 ring-primary/20",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block truncate text-sm",
                                  isActiveCandidate ? "font-medium text-accent-foreground" : "text-foreground/80",
                                )}
                              >
                                {candidate.candidate_name}
                              </span>
                            </div>
                          </button>
                        );

                        return showViewedHint ? (
                          <TooltipProvider key={`followup-${candidate.task_id}`} delayDuration={750} skipDelayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>{candidateButton}</TooltipTrigger>
                              <TooltipContent
                                side="right"
                                className="duration-300 ease-out data-[state=closed]:duration-75"
                              >
                                您已经查看过但还没确定
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          candidateButton
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>

              <section className="animate-in slide-in-from-right-2 duration-300 flex min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  {followUpConversation.length > 0 ? (
                    <div className="space-y-8">
                      {followUpConversation.map((entry, entryIndex) => (
                        <div key={`${entry.prompt}-${entryIndex}`} className="space-y-5">
                          {entry.system ? (
                            <div className="flex justify-start">
                              <div className="max-w-3xl rounded-2xl border border-border/70 bg-muted/20 px-5 py-4 text-sm leading-7 text-foreground/80 shadow-sm">
                                当前考生既有模型评估
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <div className="max-w-3xl rounded-2xl bg-primary px-5 py-4 text-sm leading-7 text-primary-foreground shadow-sm">
                                {entry.prompt}
                              </div>
                            </div>
                          )}

                          <div className="space-y-6">
                            {(entry.pending && entry.models.length === 0
                              ? (candidateDetail?.models ?? []).map((model) => ({
                                  stage: model.stage,
                                  model_label: model.model_label,
                                  score: model.score,
                                  summary: "",
                                  process: [],
                                  risk_flags: [],
                                  streamingText: "",
                                }))
                              : entry.models
                            ).map((model) => {
                              const modelLogoSrc = getModelLogoSrc(model.model_label);
                              return (
                                <div key={`${entry.prompt}-${model.stage}`} className="space-y-3 border-b border-border/60 pb-5 last:border-b-0">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border/50">
                                      {modelLogoSrc ? (
                                        <img src={modelLogoSrc} alt={model.model_label} className="h-5 w-5 object-contain" />
                                      ) : (
                                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div className="flex items-baseline gap-3">
                                      <p className="text-sm font-semibold">{toShortModelName(model.model_label)}</p>
                                      {entry.pending ? (
                                        <span className="text-xs text-muted-foreground">等待回复</span>
                                      ) : (
                                        <span className="text-sm text-primary">建议分数 {model.score}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-3 pl-11">
                                    {entry.pending ? (
                                      model.streamingText ? (
                                        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">
                                          {model.streamingText}
                                        </p>
                                      ) : (
                                        <>
                                          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                                          <div className="h-4 w-full animate-pulse rounded bg-muted/80" />
                                          <div className="h-4 w-5/6 animate-pulse rounded bg-muted/80" />
                                        </>
                                      )
                                    ) : (
                                      <>
                                        <p className="text-sm leading-7 text-foreground/85">{model.summary}</p>
                                        {model.process.length > 0 ? (
                                          <ul className="space-y-2 text-sm text-muted-foreground">
                                            {model.process.map((item) => (
                                              <li key={item} className="flex gap-2">
                                                <ChevronRight className="mt-1 h-4 w-4 shrink-0 opacity-50" />
                                                <span>{item}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/10 px-6 text-center text-sm text-muted-foreground">
                      当前考生还没有复评会话，直接在底部输入 Prompt 开始。
                    </div>
                  )}
                </div>

                <div className="border-t border-border/70 bg-background px-6 py-4">
                  <div className="mx-auto flex max-w-4xl flex-col gap-3">
                    <Textarea
                      value={promptDraft}
                      onChange={(event) => setPromptDraft(event.target.value)}
                      placeholder="继续追问这道题或这位考生的评分依据、知识点覆盖和边界情况。"
                      className="min-h-[104px] resize-none rounded-2xl border-border/70 bg-muted/15"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">这会分别发送给各模型，并保留为本次复评记录。</p>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setShowFollowUpWorkspace(false)}>
                          返回评分
                        </Button>
                        <Button
                          onClick={handlePromptFollowUp}
                          disabled={!promptDraft.trim() || followUpStreaming || !selectedTaskId}
                        >
                          <ArrowUp className="h-4 w-4" />
                          {followUpStreaming ? "发送中..." : "发送给各模型"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
