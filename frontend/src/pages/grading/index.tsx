import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  apiRequest,
  type GradingCandidateDetailResponse,
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

function buildQuestionRef(examId: string | null, questionId: string) {
  return `${examId ?? "standalone"}::${questionId}`;
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
  const [showPromptBox, setShowPromptBox] = useState(false);
  const [modelFollowUps, setModelFollowUps] = useState<Record<string, { prompt: string; summary: string; process: string[] }>>({});
  const [questionExpanded, setQuestionExpanded] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [actionLoading, setActionLoading] = useState<null | "manual" | "run" | "refresh">(null);
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
    setModelFollowUps({});
  }, [selectedTaskId]);

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

  const commitScore = async () => {
    if (!selectedTaskId || !candidateDetail) return true;
    const scoreValue = Number(manualScore);
    if (Number.isNaN(scoreValue)) return false;

    const suggestedScore = candidateDetail.suggested_score;
    const scoreChanged = suggestedScore == null || scoreValue !== suggestedScore;

    if (!scoreChanged) {
      return true;
    }

    setActionLoading("manual");
    try {
      await apiRequest(`/grading/tasks/${selectedTaskId}/manual-score`, {
        method: "POST",
        body: JSON.stringify({
          score_total: scoreValue,
          reason: "教师人工确认",
        }),
      });
      await refreshCurrentWorkspace();
      return true;
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "保存分数失败");
      setActionLoading(null);
      return false;
    }
  };

  const handleConfirmScore = async () => {
    const confirmed = await commitScore();
    if (confirmed) {
      navigateCandidateByOffset(1);
    }
  };

  const handleStepCandidate = async (offset: -1 | 1) => {
    const confirmed = await commitScore();
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

  const handleRerun = async () => {
    if (!selectedTaskId) return;
    setActionLoading("run");
    try {
      await apiRequest(`/grading/tasks/${selectedTaskId}/run`, { method: "POST" });
      await refreshCurrentWorkspace();
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "重新评分失败");
      setActionLoading(null);
    }
  };

  const handlePromptFollowUp = () => {
    if (!selectedTaskId || !promptDraft.trim()) return;
    setActionLoading("run");
    setReportError(null);
    void apiRequest<GradingPromptFollowUpResponse>(`/grading/tasks/${selectedTaskId}/follow-up`, {
      method: "POST",
      body: JSON.stringify({ prompt: promptDraft.trim() }),
    })
      .then(async () => {
        await loadCandidate(selectedTaskId);
        setPromptDraft("");
      })
      .catch((error: unknown) => {
        setReportError(error instanceof Error ? error.message : "追加 Prompt 复评失败");
      })
      .finally(() => {
        setActionLoading(null);
      });
  };

  const questionSummary = formatQuestionSummary(questionDetail);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-0 py-4">
      {actionLoading === "run" && (
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

      <main className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="border-r border-border dark:border-white/15">
          <div className="flex h-full min-h-0 flex-col px-4 pt-6 pb-2">
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

            <div className="min-h-0 flex-1 overflow-y-auto pt-4 pr-1">
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
                  <p className="text-sm leading-7">{questionDetail.question_content}</p>
                </div>
              ) : null}
            </section>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)]">
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
                              onClick={() => setSelectedTaskId(candidate.task_id)}
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
                              <p className="text-muted-foreground">编号：{candidate.candidate_code}</p>
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

              <section className="flex min-h-0 flex-col pl-6">
                <div className="border-b border-border/70 pt-6 pb-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm text-foreground/80">
                      <span className="font-medium">{candidateDetail?.candidate_name ?? "-"}</span>
                      <span className="text-muted-foreground/40">/</span>
                      <span className="text-muted-foreground">{candidateDetail?.candidate_code ?? "-"}</span>
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
                  disabled={actionLoading === "manual" || !selectedTaskId}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {actionLoading === "manual" ? "提交中..." : "确定分数"}
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
                <Button variant="ghost" onClick={() => setShowPromptBox((current) => !current)}>
                  {showPromptBox ? "关闭 Prompt" : "追加 Prompt 复评"}
                </Button>
              </div>

              {showPromptBox ? (
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
                  <Textarea
                    value={promptDraft}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    placeholder="补充告诉各模型这次你想重点复查什么。"
                    className="min-h-[96px]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={handlePromptFollowUp}
                      disabled={!promptDraft.trim() || actionLoading === "run" || !selectedTaskId}
                    >
                      发送给各模型
                    </Button>
                    <Button variant="outline" onClick={() => void handleRerun()} disabled={actionLoading === "run" || !selectedTaskId}>
                      <RefreshCw className="h-4 w-4" />
                      {actionLoading === "run" ? "评分中..." : "重新评分"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
