import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Filter,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
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

function getModelLogoSrc(modelLabel: string) {
  const normalized = modelLabel.toLowerCase();
  if (normalized.includes("qwen")) return "/model-logos/qwen.svg";
  if (normalized.includes("deepseek")) return "/model-logos/deepseek.svg";
  if (normalized.includes("claude")) return "/model-logos/claude.svg";
  return null;
}

function toShortModelName(modelLabel: string) {
  return modelLabel.split("/")[0]?.trim() || modelLabel;
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
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const [inbox, setInbox] = useState<GradingInboxResponse | null>(null);
  const [selectedQuestionRef, setSelectedQuestionRef] = useState<string | null>(null);
  const [questionDetail, setQuestionDetail] = useState<GradingQuestionDetailResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<GradingCandidateDetailResponse | null>(null);
  const [manualScore, setManualScore] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [showFollowUpWorkspace, setShowFollowUpWorkspace] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        setShowFollowUpWorkspace(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const handleEnterFullscreen = async () => {
    try {
      setIsTransitioning(true);
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      setShowFollowUpWorkspace(true);
      setTimeout(() => setIsTransitioning(false), 300);
    } catch (err) {
      console.error("Failed to enter fullscreen:", err);
      setIsTransitioning(false);
      setShowFollowUpWorkspace(true);
    }
  };
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
      setManualScore(payload.suggested_score == null ? "" : String(payload.suggested_score));
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

  useEffect(() => {
    if (selectedQuestionRef || filteredExamGroups.length === 0) return;
    const firstExam = filteredExamGroups[0];
    const firstQuestion = firstExam.questions[0];
    if (!firstQuestion) return;
    setSelectedQuestionRef(buildQuestionRef(firstExam.exam_id, firstQuestion.question_id));
  }, [filteredExamGroups, selectedQuestionRef]);

  useEffect(() => {
    if (filteredExamGroups.length > 0) return;
    setSelectedQuestionRef(null);
    setQuestionDetail(null);
    setSelectedTaskId(null);
    setCandidateDetail(null);
    setShowFollowUpWorkspace(false);
  }, [filteredExamGroups.length]);

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
            reason: "教师人工确认",
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-0 py-4">
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
        <div className="flex flex-col gap-4 border-b border-border/70 px-4 pb-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div>
              <h1 className="text-base font-bold tracking-tight">阅卷中心</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                当前共有 {summaryStats.examCount} 场考试、{summaryStats.questionCount} 道题，
                待处理 {summaryStats.pendingCount} 份，已完成 {summaryStats.completedCount} 份。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void refreshCurrentWorkspace()}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            <Button variant="outline" onClick={() => navigate("/grading/analytics")}>
              <Filter className="h-4 w-4" />
              查看统计
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 pt-6 pb-2">
            <div className="shrink-0 space-y-3 border-b border-border/70 pb-4">
              <h2 className="text-sm font-semibold text-muted-foreground">主观题列表</h2>
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
              ) : filteredExamGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  当前没有可展示的题目。
                </div>
              ) : (
                filteredExamGroups.map((exam: GradingInboxExamGroup) => (
                  <div
                    key={exam.exam_id ?? "standalone"}
                    className="space-y-2 border-b border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <h3 className="text-sm text-foreground/90">{exam.exam_label}</h3>
                      <p className="text-xs text-muted-foreground">
                        {new Date(exam.exam_date).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
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
                                  {question.question_content}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                {question.pending_count > 0 ? (
                                  <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                    {question.pending_count}
                                  </span>
                                ) : null}
                                {question.completed_count > 0 ? (
                                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                                    {question.completed_count}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-6 pb-0">
            <section className="space-y-4 border-b border-border/70 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                    {(questionDetail?.knowledge_tags ?? []).map((tag) => (
                      <span key={tag} className="text-xs text-muted-foreground/90">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{questionSummary}</p>
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
                <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
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
                <div className="pt-6 pb-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">考生列表</h3>
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
                                  ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
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
                                  candidate.task_id === activeCandidate?.task_id ? "text-primary-foreground" : "text-foreground/70",
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm text-foreground/80">
                      <span className="font-medium">{candidateDetail?.candidate_name ?? "-"}</span>
                      {candidateDetail?.candidate_code ? (
                        <>
                          <span className="text-muted-foreground/40">/</span>
                          <span className="text-muted-foreground">{candidateDetail.candidate_code}</span>
                        </>
                      ) : null}
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setShowCandidateList((current) => !current)}
                            >
                              {showCandidateList ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{showCandidateList ? "隐藏考生列表" : "显示考生列表"}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {!showCandidateList ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => void handleStepCandidate(-1)}
                            disabled={activeCandidateIndex <= 0}
                          >
                            上一个
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => void handleStepCandidate(1)}
                            disabled={
                              activeCandidateIndex < 0 ||
                              activeCandidateIndex >= sortedCandidates.length - 1
                            }
                          >
                            下一个
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">建议分数</span>
                      <span className="flex h-8 min-w-[40px] items-center justify-center rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground shadow-sm">
                        {candidateDetail?.suggested_score ?? "-"}
                      </span>
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
                        {candidateDetail?.question_type === "code" ? (
                          <CodeBlock code={candidateDetail.student_answer_raw} language="python" />
                        ) : (
                          <p className="text-sm leading-relaxed text-foreground/90">
                            {candidateDetail?.student_answer_raw ?? (loadingCandidate ? "正在加载答案..." : "-")}
                          </p>
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
                                  <span className="text-sm font-bold text-primary">{model.score}</span>
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
                                    <p className="text-sm leading-relaxed text-foreground/80 italic">"{model.summary}"</p>
                                    {model.process.length > 0 ? (
                                      <ul className="space-y-2.5 text-xs text-muted-foreground">
                                        {model.process.map((item) => (
                                          <li key={item} className="flex gap-2">
                                            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                                            <span>{item}</span>
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
                                        <p className="text-sm font-medium text-foreground/90">"{fu.prompt}"</p>
                                        <div className="space-y-3 border-t border-primary/10 pt-3">
                                          <p className="text-sm leading-relaxed text-foreground/80">{fuModel.summary}</p>
                                          <ul className="space-y-2 text-xs text-muted-foreground">
                                            {fuModel.process.map((item) => (
                                              <li key={item} className="flex gap-2">
                                                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />
                                                <span>{item}</span>
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

            <section className="sticky bottom-0 space-y-3 border-t border-border/70 bg-background pt-3 pb-0">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground" htmlFor="manual-score">
                    分数
                  </label>
                  <Input
                    id="manual-score"
                    type="number"
                    value={manualScore}
                    onChange={(event) => setManualScore(event.target.value)}
                    className="h-10 w-24 rounded-lg"
                  />
                </div>
                <Button
                  onClick={() => void handleConfirmScore()}
                  disabled={(actionLoading === "manual" || actionLoading === "confirm") || !selectedTaskId}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {actionLoading === "manual" || actionLoading === "confirm" ? "提交中..." : "确定分数"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleStepCandidate(-1)}
                  disabled={activeCandidateIndex <= 0}
                >
                  上一个考生
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleStepCandidate(1)}
                  disabled={
                    activeCandidateIndex < 0 ||
                    activeCandidateIndex >= sortedCandidates.length - 1
                  }
                >
                  下一个考生
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowFollowUpWorkspace(true);
                  }}
                >
                  追加 Prompt 复评
                </Button>
              </div>
            </section>
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
                  {candidateDetail?.suggested_score != null ? ` ｜ 建议分数 ${candidateDetail.suggested_score}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {questionSummary || questionDetail?.question_label || "当前题目"}
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
                                        <span className="text-sm text-primary">{model.score}</span>
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
