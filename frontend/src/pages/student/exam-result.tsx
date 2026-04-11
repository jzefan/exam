import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, CircleAlert, List, PanelLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { IAppealResponse, IExamResult } from "@/types";
import { cn } from "@/lib/utils";
import { formatStudentDate, renderAnswerSummary, renderStandardAnswer } from "./utils";
import { getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "./i18n";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function ExamResultPage() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [appealQuestionId, setAppealQuestionId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"nav" | "all">("nav");
  const [navMode, setNavMode] = useState<"type" | "order">("type");
  const [expandedQuestionDetails, setExpandedQuestionDetails] = useState<Record<string, boolean>>({});

  const loadResult = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await api.get<IExamResult>(`/api/student/exams/${id}/result`);
      setResult(response.data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadResult();
  }, [id]);

  useEffect(() => {
    setActiveQuestionIndex(0);
  }, [result?.exam_id]);

  useEffect(() => {
    setExpandedQuestionDetails({});
  }, [result?.exam_id, viewMode]);

  useEffect(() => {
    setNavMode("type");
  }, [result?.exam_id]);

  const questions = result?.questions ?? [];
  const safeQuestionIndex = questions.length === 0 ? 0 : Math.min(activeQuestionIndex, questions.length - 1);
  const activeQuestion = questions[safeQuestionIndex] ?? null;
  const dialogQuestion = questions.find((item) => item.question_id === appealQuestionId) ?? null;
  const groupedQuestions = useMemo(() => {
    const groups = new Map<
      string,
      Array<{ question: IExamResult["questions"][number]; index: number }>
    >();
    questions.forEach((question, index) => {
      const key = question.type;
      const current = groups.get(key) ?? [];
      current.push({ question, index });
      groups.set(key, current);
    });
    return Array.from(groups.entries());
  }, [questions]);

  const toggleQuestionDetails = (questionId: string) => {
    setExpandedQuestionDetails((current) => ({
      ...current,
      [questionId]: !current[questionId],
    }));
  };

  const expandAllQuestionDetails = () => {
    setExpandedQuestionDetails(
      Object.fromEntries(questions.map((question) => [question.question_id, true])),
    );
  };

  const collapseAllQuestionDetails = () => {
    setExpandedQuestionDetails({});
  };

  const allQuestionDetailsExpanded =
    viewMode === "all" && questions.length > 0 && questions.every((question) => expandedQuestionDetails[question.question_id]);

  const submitAppeal = async () => {
    if (!id || !appealQuestionId || !appealReason.trim()) return;
    setSubmitting(true);
    try {
      await api.post<IAppealResponse>(`/api/student/exams/${id}/appeals`, {
        question_id: appealQuestionId,
        reason: appealReason.trim(),
      });
      setAppealReason("");
      setAppealQuestionId(null);
      await loadResult();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="h-72 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!result) {
    return <div className="rounded-2xl border bg-white/90 p-8 text-[14px] text-muted-foreground">{tStudent("result_not_loaded", undefined, locale)}</div>;
  }

  if (!result.can_view) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-foreground tracking-tight">{result.title}</h1>
          <button
            onClick={() => navigate("/my-exams")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            {tStudent("result_back_to_exams", undefined, locale)}
          </button>
        </div>
        <div className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-8">
          <p className="text-[14px] text-muted-foreground">{result.blocked_reason ?? tStudent("result_no_permission", undefined, locale)}</p>
        </div>
      </div>
    );
  }

  const renderQuestionPrompt = (question: IExamResult["questions"][number]) => {
    const content = question.content as { text?: string; description?: string };
    const promptHtml = typeof content.text === "string" && content.text.trim()
      ? content.text
      : typeof content.description === "string" && content.description.trim()
        ? content.description
        : "";
    const options =
      question.options && typeof question.options === "object" ? Object.entries(question.options) : [];

    return (
      <div className="flex flex-col gap-3">
        {promptHtml ? (
          <div
            className="text-[15px] leading-7 text-foreground [&_p]:m-0 [&_p+*]:mt-3"
            dangerouslySetInnerHTML={{ __html: promptHtml }}
          />
        ) : null}
        {question.type === "choice" && options.length > 0 ? (
          <div className="grid gap-2">
            {options.map(([key, value]) => (
              <div key={key} className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold text-muted-foreground">
                  {key}
                </span>
                <span className="pt-1 text-[14px] leading-6 text-foreground">{String(value)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderQuestionCard = (question: IExamResult["questions"][number], options?: { collapsible?: boolean }) => {
    const collapsible = options?.collapsible ?? false;
    const detailsExpanded = !collapsible || Boolean(expandedQuestionDetails[question.question_id]);
    const isObjectiveQuestion =
      question.type === "choice" || question.type === "true_false" || question.type === "fill_in";
    const detailToggleLabel = isObjectiveQuestion
      ? tStudent("result_show_feedback_details", undefined, locale)
      : tStudent("result_show_details", undefined, locale);

    return (
      <section key={question.question_id} className="rounded-2xl border border-border/70 bg-background p-6">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 font-medium">
                  {getStudentQuestionTypeLabel(question.type, locale)}
                </Badge>
                <span className="text-[12px] text-muted-foreground">
                  {tStudent("result_question_number", { number: question.order + 1 }, locale)}
                </span>
              </div>
            </div>
            {collapsible ? (
              <div className="flex justify-center md:justify-self-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[12px] font-medium text-muted-foreground"
                  onClick={() => toggleQuestionDetails(question.question_id)}
                >
                  {detailsExpanded ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
                  {detailsExpanded
                    ? tStudent("result_hide_details", undefined, locale)
                    : detailToggleLabel}
                </Button>
              </div>
            ) : null}
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">{tStudent("result_score", undefined, locale)}</p>
              <p className="text-[16px] font-semibold text-primary">
                {question.score_awarded} / {question.total_score}
              </p>
            </div>
          </div>

          {renderQuestionPrompt(question)}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">{tStudent("result_your_answer", undefined, locale)}</p>
              {question.type === "code" && typeof question.answer_content.code === "string" && question.answer_content.code.trim() ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border bg-slate-950">
                  <div className="border-b border-white/10 px-3 py-2 text-[12px] text-slate-300">
                    {(question.answer_content.language as string | undefined) ?? "code"}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-[13px] leading-6 text-slate-100">
                    {question.answer_content.code as string}
                  </pre>
                </div>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  {renderAnswerSummary(question.answer_content)}
                </p>
              )}
            </div>
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">{tStudent("result_standard_answer", undefined, locale)}</p>
              <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                {renderStandardAnswer(question.standard_answer)}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {detailsExpanded && !isObjectiveQuestion ? (
              <>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                  <Brain className="text-primary" data-icon="inline-start" />
                  {tStudent("result_feedback", undefined, locale)}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {question.feedback.dimensions?.map((dimension) => (
                    <div key={dimension.name} className="rounded-xl bg-background p-4">
                      <div className="flex items-center justify-between text-[14px] font-medium">
                        <span>{dimension.name}</span>
                        <span className="text-primary">
                          {dimension.score} / {dimension.max_score}
                        </span>
                      </div>
                      <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{dimension.comment}</p>
                    </div>
                  ))}
                </div>
                {question.feedback.deductions?.length ? (
                  <div className="mt-4 flex flex-col gap-2">
                    {question.feedback.deductions.map((line) => (
                      <div key={line} className="flex items-start gap-2 text-[14px] text-amber-700 dark:text-amber-300">
                        <CircleAlert className="mt-0.5 shrink-0" data-icon="inline-start" />
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {question.feedback.suggestions?.length ? (
                  <div className="mt-4 rounded-xl bg-background p-4 text-[14px] leading-6 text-muted-foreground">
                    {tStudent("result_suggestions", { text: question.feedback.suggestions.join("；") }, locale)}
                  </div>
                ) : null}
                </div>
              </>
            ) : null}

            {question.analysis ? (
              <>
                {detailsExpanded ? (
                  <div className="rounded-xl bg-muted/25 p-4 text-[14px] leading-6 text-muted-foreground">
                    {tStudent("result_analysis", { text: question.analysis }, locale)}
                  </div>
                ) : null}
              </>
            ) : null}

            {detailsExpanded ? (
              <div className="rounded-xl border border-dashed border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-[14px] font-medium text-foreground">{tStudent("result_send_feedback", undefined, locale)}</p>
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      {question.appeal_reason
                        ? tStudent("result_appeal_reason", { text: question.appeal_reason }, locale)
                        : tStudent("result_feedback_empty", undefined, locale)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-[14px]"
                    disabled={Boolean(question.appeal_reason)}
                    onClick={() => setAppealQuestionId(question.question_id)}
                  >
                    <Send data-icon="inline-start" />
                    {question.appeal_reason
                      ? tStudent("result_feedback_sent", undefined, locale)
                      : tStudent("result_send_feedback", undefined, locale)}
                  </Button>
                </div>
                {question.appeal_reply ? (
                  <div className="mt-4 rounded-xl bg-background p-4 text-[14px] leading-6 text-muted-foreground">
                    {tStudent("result_teacher_reply", { text: question.appeal_reply }, locale)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <h1 className="text-base font-bold tracking-tight text-foreground sm:justify-self-start">
          {tStudent("result_title", undefined, locale)}
        </h1>
        <span className="text-[14px] text-muted-foreground sm:justify-self-center">
          {tStudent("result_submitted_at", { time: formatStudentDate(result.submitted_at) }, locale)}
        </span>
        <button
          onClick={() => navigate("/my-exams")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:justify-self-end"
        >
          <ArrowLeft size={16} />
          {tStudent("result_back_to_exams", undefined, locale)}
        </button>
      </div>

      <section className="rounded-2xl border border-border/70 bg-background p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-foreground">{result.title}</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">{tStudent("result_intro", undefined, locale)}</p>
          </div>
          <div className="rounded-2xl bg-muted px-5 py-4 text-right">
            <p className="text-[12px] text-muted-foreground">{tStudent("result_total_score", undefined, locale)}</p>
            <p className="mt-1 text-[16px] font-semibold text-primary">
              {result.score ?? 0} / {result.total_score}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">{tStudent("result_view_mode_title", undefined, locale)}</h2>
          <p className="text-xs text-muted-foreground">{tStudent("result_view_mode_desc", undefined, locale)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "nav" | "all")}>
            <TabsList>
              <TabsTrigger value="nav">
                <PanelLeft data-icon="inline-start" className="size-4 shrink-0" />
                {tStudent("result_view_mode_nav", undefined, locale)}
              </TabsTrigger>
              <TabsTrigger value="all">
                <List data-icon="inline-start" className="size-4 shrink-0" />
                {tStudent("result_view_mode_all", undefined, locale)}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {viewMode === "nav" ? (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{tStudent("result_question_nav", undefined, locale)}</h2>
              </div>
              <div className="inline-flex shrink-0 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setNavMode("type")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    navMode === "type" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tStudent("result_nav_group_type", undefined, locale)}
                </button>
                <button
                  type="button"
                  onClick={() => setNavMode("order")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    navMode === "order" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tStudent("result_nav_group_order", undefined, locale)}
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{tStudent("result_question_count", { count: result.questions.length }, locale)}</p>
            <div className="exam-result-nav-scroll mt-4 flex max-h-[520px] flex-col gap-4 overflow-y-auto pr-1">
              {navMode === "type"
                ? groupedQuestions.map(([type, items]) => (
                    <div key={type} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                          {getStudentQuestionTypeLabel(type, locale)}
                        </h3>
                        <span className="text-[10px] text-muted-foreground">
                          {tStudent("result_question_count", { count: items.length }, locale)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.map(({ question, index }) => {
                          const isActive = index === safeQuestionIndex;
                          return (
                            <button
                              key={question.question_id}
                              type="button"
                              aria-label={tStudent("result_jump_to_question", { number: question.order + 1 }, locale)}
                              onClick={() => setActiveQuestionIndex(index)}
                              className={cn(
                                "flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors",
                                isActive
                                  ? "border-primary/30 bg-primary/10"
                                  : "border-border/60 bg-background hover:border-primary/20 hover:bg-muted/40",
                              )}
                            >
                              <div className="flex min-w-0 flex-col gap-1">
                                <span className="text-xs font-medium text-muted-foreground">
                                  {tStudent("result_question_number", { number: question.order + 1 }, locale)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={question.is_correct ? "success" : "destructive"}
                                    className="rounded-md px-1.5 py-0 text-[10px] font-semibold"
                                  >
                                    {question.is_correct
                                      ? tStudent("result_correct", undefined, locale)
                                      : tStudent("result_incorrect", undefined, locale)}
                                  </Badge>
                                  <span className="shrink-0 text-sm font-semibold text-primary">
                                    {question.score_awarded} / {question.total_score}
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                : (
                    <div className="flex flex-col gap-2">
                      {questions.map((question, index) => {
                        const isActive = index === safeQuestionIndex;
                        return (
                          <button
                            key={question.question_id}
                            type="button"
                            aria-label={tStudent("result_jump_to_question", { number: question.order + 1 }, locale)}
                            onClick={() => setActiveQuestionIndex(index)}
                            className={cn(
                              "flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors",
                              isActive
                                ? "border-primary/30 bg-primary/10"
                                : "border-border/60 bg-background hover:border-primary/20 hover:bg-muted/40",
                            )}
                          >
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">
                                  {tStudent("result_question_number", { number: question.order + 1 }, locale)}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {getStudentQuestionTypeLabel(question.type, locale)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={question.is_correct ? "success" : "destructive"}
                                  className="rounded-md px-1.5 py-0 text-[10px] font-semibold"
                                >
                                  {question.is_correct
                                    ? tStudent("result_correct", undefined, locale)
                                    : tStudent("result_incorrect", undefined, locale)}
                                </Badge>
                                <span className="shrink-0 text-sm font-semibold text-primary">
                                  {question.score_awarded} / {question.total_score}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
            </div>
          </aside>

          {activeQuestion ? renderQuestionCard(activeQuestion) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-3 text-[13px] text-muted-foreground">
            <span>{tStudent("result_all_view_hint", undefined, locale)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-[12px]"
              onClick={allQuestionDetailsExpanded ? collapseAllQuestionDetails : expandAllQuestionDetails}
            >
              {allQuestionDetailsExpanded
                ? tStudent("result_collapse_all", undefined, locale)
                : tStudent("result_expand_all", undefined, locale)}
            </Button>
          </div>
          {result.questions.map((question) => renderQuestionCard(question, { collapsible: true }))}
        </div>
      )}

      <AlertDialog open={Boolean(appealQuestionId)} onOpenChange={(open) => !open && setAppealQuestionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tStudent("result_appeal_dialog_title", undefined, locale)}</AlertDialogTitle>
            <AlertDialogDescription>
              {tStudent("result_appeal_dialog_desc", undefined, locale)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 text-[14px] text-muted-foreground">
              {dialogQuestion?.title}
            </div>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder={tStudent("result_appeal_placeholder", undefined, locale)}
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3 py-3 text-[14px] outline-none focus:border-[#8a6fe2]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{tStudent("common_cancel", undefined, locale)}</AlertDialogCancel>
            <AlertDialogAction disabled={submitting || appealReason.trim().length < 3} onClick={submitAppeal}>
              {tStudent("result_submit_appeal", undefined, locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
