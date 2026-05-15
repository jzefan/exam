import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RefreshCw,
  Search,
  FileText,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { LatexText } from "@/components/ui/latex-text";
import { cn } from "@/lib/utils";
import type { IQuestion } from "@/types";
import {
  apiRequest,
  type GradingCandidateDetailResponse,
  type GradingConfirmResponse,
  type GradingInboxExamGroup,
  type GradingInboxQuestionItem,
  type GradingInboxResponse,
  type GradingPromptFollowUpResponse,
  type GradingQuestionCandidate,
  type GradingQuestionDetailResponse,
} from "./api";

type ExpandedStage = "primary" | "review" | "arbiter";
type GradingAttachment = {
  name: string;
  url: string;
};

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

function statusDotClass(status: string) {
  if (status === "待仲裁" || status === "人工改分") return "bg-rose-500";
  if (status === "已完成") return "bg-emerald-500";
  return "bg-blue-500";
}

function candidatePriority(status: string) {
  if (status === "待仲裁") return 0;
  if (status === "人工改分") return 1;
  if (status === "评分中") return 2;
  if (status === "待评分") return 3;
  return 4;
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

export function GradingCenterPage() {
  const [searchText, setSearchText] = useState("");
  const [inbox, setInbox] = useState<GradingInboxResponse | null>(null);
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

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const payload = await apiRequest<GradingInboxResponse>("/grading/inbox");
      setInbox(payload);
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
      setQuestionDetail(payload);
      setReportError(null);
      return payload;
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
      setCandidateDetail(payload);
      const hasAnswer =
        Boolean(payload.student_answer_raw?.trim()) ||
        (payload.attachment_refs?.length ?? 0) > 0;
      if (!hasAnswer) {
        setManualScore("0");
        setAutoScoreReason("该考生未提交答案，评分自动设为0分");
      } else if (payload.suggested_score == null) {
        setManualScore("0");
        setAutoScoreReason(payload.evaluation_note ?? "AI尚未评估，评分自动设为0分");
      } else {
        setManualScore(String(payload.suggested_score));
        setAutoScoreReason(null);
      }
      setReportError(null);
      return payload;
    } catch (error) {
      setCandidateDetail(null);
      setReportError(error instanceof Error ? error.message : "加载评分详情失败");
      return null;
    } finally {
      setLoadingCandidate(false);
      setActionLoading(null);
    }
  };

  useEffect(() => {
    void loadInbox();
  }, []);

  const filteredExamGroups = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!inbox) return [];
    if (!keyword) return inbox.exams;

    return inbox.exams
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
  }, [inbox, searchText]);

  const orderedExamGroups = useMemo(() => {
    const sorted = [...filteredExamGroups].sort(
      (left, right) => new Date(right.exam_date).getTime() - new Date(left.exam_date).getTime(),
    );

    const pending = sorted.filter((exam) => exam.questions.some((question) => question.pending_count > 0));
    const completed = sorted.filter((exam) => exam.questions.every((question) => question.pending_count === 0));

    return {
      pending,
      completed,
      all: [...pending, ...completed],
    };
  }, [filteredExamGroups]);

  useEffect(() => {
    if (selectedQuestionRef || orderedExamGroups.all.length === 0) return;
    const firstExam = orderedExamGroups.all[0];
    const firstQuestion = firstExam.questions[0];
    if (!firstQuestion) return;
    setSelectedQuestionRef(buildQuestionRef(firstExam.exam_id, firstQuestion.question_id));
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
    if (!selectedQuestionRef || !inbox) return;
    const [examIdRaw, questionId] = selectedQuestionRef.split("::");
    const examId = examIdRaw === "standalone" ? null : examIdRaw;
    void loadQuestion(examId, questionId).then((payload) => {
      if (!payload) return;
      const preferredCandidate = [...payload.candidates].sort(
        (left, right) => candidatePriority(left.status) - candidatePriority(right.status),
      )[0];
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
  }, [selectedQuestionRef, inbox]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void loadCandidate(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!showFollowUpWorkspace) return;
    const baseEntry = buildBaseEvaluationEntry(candidateDetail);
    setFollowUpConversation(baseEntry ? [baseEntry] : []);
    setPromptDraft("");
  }, [selectedTaskId, showFollowUpWorkspace, candidateDetail]);

  const summaryStats = useMemo(() => {
    const exams = inbox?.exams ?? [];
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
  }, [inbox]);

  const sortedCandidates = useMemo(() => {
    if (!questionDetail) return [];
    return [...questionDetail.candidates].sort(
      (left, right) => candidatePriority(left.status) - candidatePriority(right.status),
    );
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
    if (!activeCandidate) return;
    if (selectedTaskId !== activeCandidate.task_id) {
      setSelectedTaskId(activeCandidate.task_id);
    }
  }, [activeCandidate, selectedTaskId]);

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

  const finalizeCurrentScore = async () => {
    if (!selectedTaskId || !candidateDetail) return true;
    const scoreValue = Number(manualScore);
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

      await refreshCurrentWorkspace();
      return true;
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "确定分数失败");
      setActionLoading(null);
      return false;
    }
  };

  const handleConfirmScore = async () => {
    const confirmed = await finalizeCurrentScore();
    if (confirmed) {
      navigateCandidateByOffset(1);
    }
  };

  const handleStepCandidate = async (offset: -1 | 1) => {
    const confirmed = await finalizeCurrentScore();
    if (confirmed) {
      navigateCandidateByOffset(offset);
    }
  };

  const refreshCurrentWorkspace = async () => {
    setActionLoading("refresh");
    const nextInbox = await loadInbox();
    if (selectedQuestionRef && nextInbox) {
      const [examIdRaw, questionId] = selectedQuestionRef.split("::");
      const examId = examIdRaw === "standalone" ? null : examIdRaw;
      await loadQuestion(examId, questionId);
    }
    if (selectedTaskId) {
      await loadCandidate(selectedTaskId);
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
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border/70 px-4 pb-4">
          <div className="justify-self-start">
            <h1 className="text-base font-bold tracking-tight">阅卷中心</h1>
          </div>
          <div className="min-w-0 justify-self-center">
            <p className="text-center text-sm text-muted-foreground">
              当前共有 {summaryStats.examCount} 场考试、{summaryStats.questionCount} 道题，
              待处理 {summaryStats.pendingCount} 份，已完成 {summaryStats.completedCount} 份。
            </p>
          </div>
          <div className="justify-self-end">
            <Button variant="outline" size="sm" onClick={() => void refreshCurrentWorkspace()}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        </div>
      ) : null}

      <main
        className={cn(
          "relative grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]",
          showFollowUpWorkspace &&
            "pointer-events-none scale-[0.985] opacity-0 blur-[2px] transition-all duration-200 ease-out",
        )}
      >
        <section className="min-h-0 overflow-hidden border-r border-border dark:border-white/15">
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 pt-4 pb-2">
            <div className="shrink-0 space-y-3 border-b border-border/70 pb-3">
              <h2 className="text-sm font-semibold text-muted-foreground">待阅试卷和题目</h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索题目或考试"
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
                                  onClick={() =>
                                    setExpandedExamGroups((current) => {
                                      const next = new Set(current);
                                      if (next.has(examKey)) {
                                        next.delete(examKey);
                                      } else {
                                        next.add(examKey);
                                      }
                                      return next;
                                    })
                                  }
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

                                {isExpanded ? (
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
                                              ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
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
          {!hasVisibleQuestions ? (
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-0">
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
                <div className="flex items-center justify-between pt-6 pb-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">考生列表</h3>
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
                <div className="flex min-h-0 flex-1 flex-wrap align-top content-start gap-2 overflow-y-auto pr-3 pb-6">
                  {loadingQuestion ? (
                    <div className="w-full rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      正在加载考生...
                    </div>
                  ) : (
                    sortedCandidates.map((candidate: GradingQuestionCandidate) => (
                      <TooltipProvider key={candidate.task_id} delayDuration={120}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                setCandidateTransitionDirection("neutral");
                                setSelectedTaskId(candidate.task_id);
                              }}
                              className={cn(
                                "group flex h-8 items-center gap-2 rounded-full border px-3 text-left transition-all duration-200",
                                candidate.task_id === activeCandidate?.task_id
                                  ? "exam-primary-soft-active shadow-sm"
                                  : "border-transparent bg-muted/40 text-muted-foreground hover:border-border/50 hover:bg-muted hover:text-foreground",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-125",
                                  statusDotClass(candidate.status),
                                  candidate.task_id === activeCandidate?.task_id && "ring-2 ring-primary-foreground/30",
                                )}
                              />
                              <span
                                className={cn(
                                  "whitespace-nowrap text-xs font-semibold tracking-tight",
                                  candidate.task_id === activeCandidate?.task_id ? "text-primary" : "text-foreground/70",
                                )}
                              >
                                {candidate.candidate_name}
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="rounded-lg border border-border bg-background px-3 py-2 text-foreground shadow-lg"
                          >
                            <div className="space-y-1 text-xs">
                              <p className="font-semibold">{candidate.candidate_name}</p>
                              {candidate.candidate_code ? (
                                <p className="text-muted-foreground">学号：{candidate.candidate_code}</p>
                              ) : null}
                              <p className="text-muted-foreground">状态：{candidate.status}</p>
                              <p className="text-muted-foreground">
                                分数：{candidate.score == null ? "未完成" : candidate.score}
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))
                  )}
                </div>
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
                <div className="border-b border-border/70 pt-6 pb-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4">
                    <div className="flex min-w-0 items-center gap-3 text-sm text-foreground/80">
                      <span className="font-medium">{candidateDetail?.candidate_name ?? "-"}</span>
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
                      <Button
                        size="sm"
                        onClick={() => void handleConfirmScore()}
                        disabled={(actionLoading === "manual" || actionLoading === "confirm") || !selectedTaskId}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {actionLoading === "manual" || actionLoading === "confirm" ? "提交中..." : "确定分数"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStepCandidate(-1)}
                        disabled={activeCandidateIndex <= 0}
                      >
                        上一个考生
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStepCandidate(1)}
                        disabled={
                          activeCandidateIndex < 0 ||
                          activeCandidateIndex >= sortedCandidates.length - 1
                        }
                      >
                        下一个考生
                      </Button>
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
                        candidateDetail?.models.map((model) => {
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
                        }) ?? null
                      )}
                    </section>
                  </div>
                </div>
                </div>
              </section>
            </div>

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
                      {sortedCandidates.map((candidate) => (
                        <TooltipProvider key={`followup-${candidate.task_id}`} delayDuration={120}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => {
                                  setCandidateTransitionDirection("neutral");
                                  setSelectedTaskId(candidate.task_id);
                                }}
                                className={cn(
                                  "group mx-2 my-1 flex min-h-11 w-auto items-center gap-3 rounded-lg px-3 text-left transition-all duration-200",
                                  candidate.task_id === activeCandidate?.task_id
                                    ? "bg-accent text-accent-foreground"
                                    : "bg-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 shrink-0 rounded-full transition-transform group-hover:scale-125",
                                    statusDotClass(candidate.status),
                                    candidate.task_id === activeCandidate?.task_id && "ring-2 ring-primary/20",
                                  )}
                                />
                                <div className="min-w-0 flex-1">
                                  <span
                                    className={cn(
                                      "block truncate text-sm",
                                      candidate.task_id === activeCandidate?.task_id ? "font-medium text-accent-foreground" : "text-foreground/80",
                                    )}
                                  >
                                    {candidate.candidate_name}
                                  </span>
                                </div>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground shadow-lg"
                            >
                              <div className="space-y-1 text-xs">
                                <p className="font-semibold">{candidate.candidate_name}</p>
                                {candidate.candidate_code ? (
                                  <p className="text-muted-foreground">学号：{candidate.candidate_code}</p>
                                ) : null}
                                <p className="text-muted-foreground">状态：{candidate.status}</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
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
