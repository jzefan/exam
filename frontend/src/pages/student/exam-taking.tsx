import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
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
import type { IExamTaking } from "@/types";
import { CountdownTimer } from "./components/countdown-timer";
import { SwitchCounter } from "./components/switch-counter";
import { QuestionNav } from "./components/question-nav";
import { QuestionRenderer } from "./components/question-renderer";
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

  /* ---- State ---- */
  const [examData, setExamData] = useState<IExamTaking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchCount, setSwitchCount] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [switchWarning, setSwitchWarning] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const handleSubmitRef = useRef<() => void>(() => {});

  /* ---- Load exam data (once) ---- */
  useEffect(() => {
    let cancelled = false;
    api
      .post<IExamTaking>(`/api/student/exams/${id}/start`)
      .then((res) => {
        if (!cancelled) {
          setExamData(res.data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err?.response?.data?.detail ?? "无法加载考试数据",
          );
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ---- Exam taking hook ---- */
  const {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    updateAnswer,
    flushAnswers,
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
    setSwitchWarning("切屏次数已达上限，考试将自动提交");
    setTimeout(() => handleSubmitRef.current(), 2000);
  }, []);

  const handleWarning = useCallback((remaining: number) => {
    setSwitchWarning(`注意：切屏机会仅剩 ${remaining} 次`);
    setTimeout(() => setSwitchWarning(null), 4000);
  }, []);

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

  /* ---- Submit ---- */
  const handleSubmit = useCallback(async () => {
    flushAnswers();
    await submitExam();
    setSubmitted(true);
    setShowSubmitDialog(false);
    setTimeout(() => navigate("/my-exams"), 1500);
  }, [flushAnswers, submitExam, navigate]);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleTimeUp = useCallback(() => {
    setSwitchWarning("考试时间到，正在自动提交...");
    setTimeout(() => handleSubmitRef.current(), 1500);
  }, []);

  /* ---- Keyboard navigation ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showAll || !examData) return;
      if (e.key === "ArrowLeft" && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      } else if (
        e.key === "ArrowRight" &&
        currentIndex < examData.questions.length - 1
      ) {
        setCurrentIndex(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAll, examData, currentIndex, setCurrentIndex]);

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
            正在返回考试列表...
          </p>
        </div>
      </div>
    );
  }

  const questions = examData.questions;
  const currentQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) =>
    isAnswered(answers[q.question_id]),
  ).length;
  const progressPct =
    questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

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
          className="h-full bg-foreground/30 transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ── Top control bar ── */}
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-border/60 bg-background z-50">
        {/* Left: nav toggle + title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setNavOpen(true)}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="答题卡"
          >
            <Map size={16} />
          </button>
          <h1 className="text-sm font-semibold text-foreground truncate max-w-[200px] sm:max-w-xs">
            {examData.title}
          </h1>
        </div>

        {/* Center: question counter (hidden on mobile) */}
        {!showAll && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {currentIndex + 1}
            </span>
            <span>/</span>
            <span className="tabular-nums">{questions.length}</span>
          </div>
        )}

        {/* Right: controls */}
        <div className="flex items-center gap-4">
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
            onNavigate={setCurrentIndex}
            onClose={() => setNavOpen(false)}
          />
        </div>

        {/* Question area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10">
            {/* View mode toggle */}
            <div className="flex items-center justify-between mb-6">
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
              <div>
                <QuestionRenderer
                  question={currentQuestion}
                  answer={answers[currentQuestion.question_id] ?? {}}
                  onChange={(ans) =>
                    updateAnswer(currentQuestion.question_id, ans)
                  }
                />

                {/* Prev / Next */}
                <div className="flex items-center justify-between mt-10 pt-6 border-t border-border/40">
                  <button
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex(currentIndex - 1)}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={16} />
                    上一题
                  </button>

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
                          onClick={() => setCurrentIndex(realIdx)}
                          className={`w-1.5 h-1.5 rounded-full transition-all ${
                            realIdx === currentIndex
                              ? "bg-foreground w-4"
                              : isAnswered(answers[q.question_id])
                                ? "bg-foreground/30"
                                : "bg-foreground/10"
                          }`}
                        />
                      );
                    })}
                  </div>

                  <button
                    disabled={currentIndex === questions.length - 1}
                    onClick={() => setCurrentIndex(currentIndex + 1)}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    下一题
                    <ChevronRight size={16} />
                  </button>
                </div>
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
            <AlertDialogAction onClick={handleSubmit}>
              确认交卷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
