import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Send,
  Map,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import type { IExamTaking, ISubmitExamResponse } from "@/types";
import { CountdownTimer } from "./components/countdown-timer";
import { SwitchCounter } from "./components/switch-counter";
import { QuestionNav } from "./components/question-nav";
import { QuestionRenderer } from "./components/question-renderer";
import { getStudentLocale, tStudent, translateStudentError } from "./i18n";
import { useExamTaking } from "@/hooks/use-exam-taking";
import { useVisibilityDetection } from "@/hooks/use-visibility-detection";

/* ------------------------------------------------------------------ */
/*  API client                                                         */
/* ------------------------------------------------------------------ */

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TYPE_LABELS: Record<string, string> = {
  true_false: "判断",
  choice: "选择",
  fill_in: "填空",
  short_answer: "简答",
  essay: "论述",
  code: "编程",
};

function isAnswered(ans: Record<string, unknown> | undefined): boolean {
  if (!ans) return false;
  return Object.values(ans).some((v) =>
    Array.isArray(v)
      ? v.length > 0 && v.some(Boolean)
      : v !== "" && v !== null && v !== undefined,
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ExamTaking() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const locale = getStudentLocale();
  const isRetake = searchParams.get("retake") === "1";

  /* ---- State ---- */
  const [examData, setExamData] = useState<IExamTaking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchCount, setSwitchCount] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [showNavHint, setShowNavHint] = useState(true);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [switchWarning, setSwitchWarning] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitStatusMessage, setSubmitStatusMessage] = useState("");
  const [timeUpCountdown, setTimeUpCountdown] = useState<number | null>(null);
  const handleSubmitRef = useRef<((reason?: "time-up" | "switch-limit") => Promise<void>) | null>(null);
  const submitInFlightRef = useRef(false);

  /* ---- Load exam data (once, with jitter to smooth the enrollment burst) ---- */
  useEffect(() => {
    let cancelled = false;
    // Stagger 150 concurrent students across ~3s so the /start endpoint isn't hit in lockstep.
    const jitterMs = import.meta.env.MODE === "test" ? 0 : Math.random() * 3000;
    const timer = setTimeout(() => {
      if (cancelled) return;
      api
        .post<IExamTaking>(`/api/student/exams/${id}/start`, isRetake ? { retake: true } : {})
        .then((res) => {
          if (!cancelled) {
            setExamData(res.data);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setLoadError(
              translateStudentError(err?.response?.data?.detail, locale),
            );
            setIsLoading(false);
          }
        });
    }, jitterMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, isRetake]);

  /* ---- Exam taking hook ---- */
  const {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    saveState,
    saveMessage,
    updateAnswer,
    flushQuestion,
    submitExam,
    reportSwitch,
  } = useExamTaking({ examData });

  /* ---- Switch count init ---- */
  useEffect(() => {
    if (examData) setSwitchCount(examData.switch_count);
  }, [examData?.switch_count]);

  /* ---- Visibility detection ---- */
  const handleSwitch = useCallback(
    (count: number) => {
      setSwitchCount(count);
      reportSwitch(count);
    },
    [reportSwitch],
  );

  const handleMaxReached = useCallback(() => {
    if (submitInFlightRef.current || submitted) return;
    setSwitchWarning(tStudent("switch_limit_countdown", { seconds: 2 }, locale));
    setTimeout(() => {
      void handleSubmitRef.current?.("switch-limit");
    }, 2000);
  }, [locale, submitted]);

  const handleWarning = useCallback((remaining: number) => {
    setSwitchWarning(tStudent("switch_remaining_warning", { remaining }, locale));
    setTimeout(() => setSwitchWarning(null), 4000);
  }, [locale]);

  const { setCount: setVisibilityCount } = useVisibilityDetection({
    maxSwitchCount: examData?.max_switch_count ?? 0,
    onSwitch: handleSwitch,
    onMaxReached: handleMaxReached,
    onWarning: handleWarning,
    enabled: !!examData && !submitted,
  });

  useEffect(() => {
    if (examData) setVisibilityCount(examData.switch_count);
  }, [examData?.switch_count, setVisibilityCount]);

  useEffect(() => {
    if (navOpen) {
      setShowNavHint(false);
    }
  }, [navOpen]);

  /* ---- Submit ---- */
  const handleSubmit = useCallback(async (reason?: "time-up" | "switch-limit") => {
    if (submitInFlightRef.current || submitted) return;

    submitInFlightRef.current = true;
    setShowSubmitDialog(false);

    if (reason === "time-up") {
      setSwitchWarning(tStudent("time_up_submitting", undefined, locale));
    } else if (reason === "switch-limit") {
      setSwitchWarning(tStudent("switch_limit_submitting", undefined, locale));
    }

    try {
      const submitResult = (await submitExam()) as ISubmitExamResponse | undefined;
      setSubmitted(true);
      setSwitchWarning(null);
      const gradingStatus = submitResult?.grading_status;
      if (gradingStatus === "pending_ai") {
        setSubmitStatusMessage("主观题已提交，正在等待 AI 评分...");
        setTimeout(() => navigate("/my-exams"), 1500);
      } else if (gradingStatus === "reviewed" && examData) {
        setSubmitStatusMessage("考试已提交，正在打开考试结果...");
        setTimeout(() => navigate(`/my-exams/${examData.exam_id}/result`), 1200);
      } else {
        setSubmitStatusMessage("考试已提交，正在返回考试列表...");
        setTimeout(() => navigate("/my-exams"), 1500);
      }
    } catch (error) {
      submitInFlightRef.current = false;
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.detail
        : null;
      setSwitchWarning(
        typeof detail === "string" && detail
          ? translateStudentError(detail, locale)
          : reason === "time-up"
            ? tStudent("auto_submit_failed", undefined, locale)
            : tStudent("submit_failed", undefined, locale),
      );
    }
  }, [examData?.exam_id, locale, navigate, submitExam, submitted]);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleTimeUp = useCallback(() => {
    if (submitInFlightRef.current || submitted) return;
    setTimeUpCountdown((prev) => prev ?? 3);
  }, [submitted]);

  useEffect(() => {
    if (timeUpCountdown === null) return;
    if (timeUpCountdown <= 0) {
      setTimeUpCountdown(null);
      void handleSubmitRef.current?.("time-up");
      return;
    }

    setSwitchWarning(
      tStudent("time_up_countdown", { seconds: timeUpCountdown }, locale),
    );
    const timer = setTimeout(() => {
      setTimeUpCountdown((prev) => (prev === null ? null : prev - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [locale, timeUpCountdown]);

  const questions = examData?.questions ?? [];
  const currentQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) =>
    isAnswered(answers[q.question_id]),
  ).length;
  const progressPct =
    questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const isCodeQuestion = !showAll && currentQuestion?.type === "code";

  const navigateToQuestion = useCallback(
    async (nextIndex: number) => {
      if (!questions[nextIndex] || !currentQuestion) return;
      await flushQuestion(currentQuestion.question_id);
      setCurrentIndex(nextIndex);
    },
    [currentQuestion, flushQuestion, questions, setCurrentIndex],
  );

  /* ---- Keyboard navigation ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showAll || !examData) return;
      if (e.key === "ArrowLeft" && currentIndex > 0) {
        void navigateToQuestion(currentIndex - 1);
      } else if (
        e.key === "ArrowRight" &&
        currentIndex < examData.questions.length - 1
      ) {
        void navigateToQuestion(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAll, examData, currentIndex, navigateToQuestion]);

  /* ---------------------------------------------------------------- */
  /*  Render states                                                    */
  /* ---------------------------------------------------------------- */

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">加载考试中...</p>
        </div>
      </div>
    );
  }

  if (loadError || !examData) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center max-w-sm px-6">
          <p className="text-sm text-muted-foreground mb-4">
            {loadError ?? "无法加载考试数据"}
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/my-exams")}>
            返回考试列表
          </Button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-600 dark:text-emerald-400"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-foreground">考试已提交</p>
          <p className="text-sm text-muted-foreground mt-1">
            {submitStatusMessage || "正在返回考试列表..."}
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Main exam UI                                                     */
  /* ---------------------------------------------------------------- */

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      {/* ── Switch warning banner ── */}
      {switchWarning && (
        <div className="absolute top-0 left-0 right-0 z-[60] bg-red-600 text-white text-center py-2.5 text-sm font-medium">
          {switchWarning}
        </div>
      )}

      {/* ── Progress strip (2px) ── */}
      <div className="h-0.5 bg-muted shrink-0 z-50 relative">
        <div
          className="h-full bg-primary/30 transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ── Top control bar ── */}
      <header className="z-50 grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border/60 bg-background px-4 sm:px-6">
        {/* Left: nav toggle + title */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/my-exams")}
            className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground"
          >
            <ArrowLeft data-icon="inline-start" />
            <span className="sm:hidden">返回</span>
            <span className="hidden sm:inline">返回我的考试</span>
          </Button>
          <div className="hidden h-4 w-px shrink-0 bg-border sm:block" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNavOpen(true)}
            className="size-8 shrink-0 text-muted-foreground"
            title="答题卡"
            aria-label="打开答题卡"
          >
            <Map />
          </Button>
          <h1 className="max-w-[160px] truncate text-sm font-semibold text-foreground sm:max-w-xs">
            {examData.title}
          </h1>
        </div>

        {/* Center: question counter (hidden on mobile) */}
        {!showAll && isCodeQuestion && questions.length > 1 ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={currentIndex === 0}
              onClick={() => {
                void navigateToQuestion(currentIndex - 1);
              }}
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft data-icon="inline-start" />
              上一题
            </Button>
            <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {currentIndex + 1}
              </span>
              <span>/</span>
              <span className="tabular-nums">{questions.length}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={currentIndex === questions.length - 1}
              onClick={() => {
                void navigateToQuestion(currentIndex + 1);
              }}
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              下一题
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        ) : !showAll && (
          <div className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground md:flex">
            <span className="font-semibold text-foreground tabular-nums">
              {currentIndex + 1}
            </span>
            <span>/</span>
            <span className="tabular-nums">{questions.length}</span>
          </div>
        )}

        {/* Right: controls */}
        <div className="flex shrink-0 items-center justify-end gap-3">
          {saveMessage ? (
            <div
              className={`hidden text-xs sm:block ${
                saveState === "error" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {saveMessage}
            </div>
          ) : null}
          <SwitchCounter
            switchCount={switchCount}
            maxSwitchCount={examData.max_switch_count}
          />
          <CountdownTimer
            startedAt={examData.started_at}
            durationMinutes={examData.duration_minutes}
            endTime={examData.end_time}
            onTimeUp={handleTimeUp}
          />
          <Button
            size="sm"
            onClick={() => setShowSubmitDialog(true)}
            className="h-8 px-3 text-xs gap-1.5"
          >
            <Send size={12} />
            <span className="hidden sm:inline">交卷</span>
          </Button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Navigation drawer overlay */}
        {navOpen && (
          <div
            className="absolute inset-0 z-40 bg-black/20 dark:bg-black/40"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* Navigation drawer */}
        <div
          className={`absolute top-0 left-0 h-full z-50 w-64 bg-background border-r border-border shadow-xl transition-transform duration-300 ease-out ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <QuestionNav
            questions={questions}
            answers={answers}
            currentIndex={currentIndex}
            onNavigate={(index) => {
              void navigateToQuestion(index);
            }}
            onClose={() => setNavOpen(false)}
          />
        </div>

        {/* Question area */}
        <main className={isCodeQuestion ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}>
          <div
            data-testid="exam-content-shell"
            className={
              isCodeQuestion
                ? "h-full w-full px-0 py-0"
                : "mx-auto max-w-4xl px-5 py-6 sm:px-8 sm:py-10 xl:px-10"
            }
          >
            {showNavHint && !isCodeQuestion ? (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                <p>
                  右上角的答题卡可以快速跳转到任意题目，适合回看和检查未完成的题。
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setNavOpen(true)}
                >
                  打开答题卡
                </Button>
              </div>
            ) : null}

            {/* View mode toggle */}
            {!isCodeQuestion ? (
              <div className="mb-6 flex items-center justify-between">
                {!showAll && currentQuestion ? (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {TYPE_LABELS[currentQuestion.type] ?? currentQuestion.type}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60">
                      {currentQuestion.score} 分
                    </span>
                  </div>
                ) : (
                  <div />
                )}
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAll ? <List size={13} /> : <LayoutGrid size={13} />}
                  {showAll ? "单题模式" : "全部显示"}
                </button>
              </div>
            ) : null}

            {showAll ? (
              /* ── All questions ── */
              <div className="space-y-10">
                {questions.map((q, i) => (
                  <section key={q.question_id}>
                    {/* Question header */}
                    <div className="flex items-center gap-2.5 mb-4">
                      <span className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-xs font-bold tabular-nums text-foreground/70">
                        {i + 1}
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {TYPE_LABELS[q.type] ?? q.type}
                      </span>
                      <span className="text-[11px] text-muted-foreground/60">
                        {q.score} 分
                      </span>
                      {isAnswered(answers[q.question_id]) && (
                        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-500" />
                      )}
                    </div>
                    <QuestionRenderer
                      question={q}
                      answer={answers[q.question_id] ?? {}}
                      onChange={(ans) => updateAnswer(q.question_id, ans)}
                    />
                    {i < questions.length - 1 && (
                      <div className="border-b border-border/40 mt-10" />
                    )}
                  </section>
                ))}
              </div>
            ) : currentQuestion ? (
              /* ── Single question ── */
              <div className={isCodeQuestion ? "h-full min-h-0" : undefined}>
                <QuestionRenderer
                  question={currentQuestion}
                  answer={answers[currentQuestion.question_id] ?? {}}
                  onChange={(ans) =>
                    updateAnswer(currentQuestion.question_id, ans)
                  }
                />

                {/* Prev / Next */}
                {!isCodeQuestion ? (
                <div className="flex items-center justify-between mt-10 pt-6 border-t border-border/40">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={currentIndex === 0}
                    onClick={() => {
                      void navigateToQuestion(currentIndex - 1);
                    }}
                    className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ChevronLeft data-icon="inline-start" />
                    上一题
                  </Button>

                  {/* Dot indicators for nearby questions */}
                  <div className="hidden sm:flex items-center gap-1">
                    {questions.slice(
                      Math.max(0, currentIndex - 3),
                      Math.min(questions.length, currentIndex + 4),
                    ).map((q, i) => {
                      const realIdx = Math.max(0, currentIndex - 3) + i;
                      return (
                        <button
                          key={q.question_id}
                          onClick={() => {
                            void navigateToQuestion(realIdx);
                          }}
                          className={`w-1.5 h-1.5 rounded-full transition-all ${
                            realIdx === currentIndex
                              ? "bg-primary w-4"
                              : isAnswered(answers[q.question_id])
                                ? "bg-primary/30"
                                : "bg-muted-foreground/20"
                          }`}
                        />
                      );
                    })}
                  </div>

                  {currentIndex === questions.length - 1 ? (
                    <Button
                      type="button"
                      onClick={() => setShowSubmitDialog(true)}
                      variant="ghost"
                      size="sm"
                      className="h-9 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <Send data-icon="inline-start" />
                      交卷
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigateToQuestion(currentIndex + 1);
                      }}
                      className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      下一题
                      <ChevronRight data-icon="inline-end" />
                    </Button>
                  )}
                </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {/* ── Submit confirmation ── */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>确认交卷</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>提交后将无法修改答案。</p>
                <div className="flex items-center justify-between py-2.5 px-3.5 rounded-lg bg-muted text-sm">
                  <span className="text-muted-foreground">已答题目</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {answeredCount}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      / {questions.length}
                    </span>
                  </span>
                </div>
                {answeredCount < questions.length && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    还有 {questions.length - answeredCount} 题未作答
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续答题</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSubmit()}>
              确认交卷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
