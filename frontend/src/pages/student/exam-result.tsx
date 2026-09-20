import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { LatexText, renderLatexInHtml } from "@/components/ui/latex-text";
import { CodeBlock } from "@/components/ui/code-block";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, CircleAlert, List, PanelLeft, RotateCcw, Send } from "lucide-react";
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
import {
  formatStudentDate,
  getStudentAnswerCodeLanguage,
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "./utils";
import { getStudentLocale, getStudentQuestionTypeLabel, tStudent } from "./i18n";
import { resolveStudentReturnHref } from "./wrong-answer-shared";
import { useIsMobile } from "@/hooks/use-viewport";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function ExamResultPage() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const isMobile = useIsMobile();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // 从错题本的强化练习进来时，返回键回到错题本而不是「我的考试」。
  const returnHref = resolveStudentReturnHref(searchParams);
  const retakeSearch = (() => {
    const params = new URLSearchParams(searchParams);
    params.set("retake", "1");
    return params.toString();
  })();
  const backLabel =
    returnHref === "/my-exams"
      ? tStudent("result_back_to_exams", undefined, locale)
      : tStudent("wrong_answers_back", undefined, locale);
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [appealQuestionId, setAppealQuestionId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [regradingQuestionId, setRegradingQuestionId] = useState<string | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"nav" | "all">("nav");
  const [navMode, setNavMode] = useState<"type" | "order">("type");
  const [expandedQuestionDetails, setExpandedQuestionDetails] = useState<Record<string, boolean>>({});
  const [activeViewAllQuestionIndex, setActiveViewAllQuestionIndex] = useState(0);

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
    setActiveViewAllQuestionIndex(0);
  }, [result?.exam_id]);

  useEffect(() => {
    setExpandedQuestionDetails({});
  }, [result?.exam_id, viewMode]);

  useEffect(() => {
    setNavMode("type");
  }, [result?.exam_id]);

  useEffect(() => {
    if (!result?.questions.length) return;
    if (!isMobile && viewMode !== "all") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const targetId = visible[0].target.id;
          const idx = result.questions.findIndex(
            (q) => `exam-q-${q.order + 1}` === targetId,
          );
          if (idx >= 0) setActiveViewAllQuestionIndex(idx);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    result.questions.forEach((q) => {
      const el = document.getElementById(`exam-q-${q.order + 1}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [isMobile, viewMode, result?.exam_id]);

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

  const scrollToQuestion = (index: number) => {
    const question = questions[index];
    if (!question) return;
    const element = document.getElementById(`exam-q-${question.order + 1}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveViewAllQuestionIndex(index);
    }
  };

  const allQuestionDetailsExpanded =
    viewMode === "all" && questions.length > 0 && questions.every((question) => expandedQuestionDetails[question.question_id]);
  const correctCount = questions.filter((question) => question.is_correct).length;
  const incorrectCount = questions.length - correctCount;
  const handleRetake = () => {
    if (!result?.can_retake) return;
    navigate(`/my-exams/${result.exam_id}/take?${retakeSearch}`);
  };

  const renderRetakeButton = (className?: string) => {
    if (!result?.can_retake) return null;
    return (
      <Button type="button" variant="outline" size="sm" className={className} onClick={handleRetake}>
        <RotateCcw data-icon="inline-start" />
        重考
      </Button>
    );
  };

  const requestRegrade = async (questionId: string) => {
    if (!id) return;
    setRegradingQuestionId(questionId);
    try {
      await api.post(`/api/student/exams/${id}/questions/${questionId}/regrade`);
      await loadResult();
    } catch {
      // surface failure by re-loading so the banner stays
      await loadResult();
    } finally {
      setRegradingQuestionId(null);
    }
  };

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
            onClick={() => navigate(returnHref)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            {backLabel}
          </button>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-[#ebe3f4] bg-white/90 p-8">
          <p className="text-[14px] text-muted-foreground">{result.blocked_reason ?? tStudent("result_no_permission", undefined, locale)}</p>
          {renderRetakeButton("w-fit")}
        </div>
      </div>
    );
  }

  const renderQuestionPrompt = (question: IExamResult["questions"][number]) => {
    const content = question.content as { html?: string; text?: string; description?: string };
    const promptHtml = typeof content.html === "string" && content.html.trim()
      ? content.html
      : typeof content.text === "string" && content.text.trim()
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
            dangerouslySetInnerHTML={{ __html: renderLatexInHtml(promptHtml) }}
          />
        ) : null}
        {question.type === "choice" && options.length > 0 ? (
          <div className="grid gap-2">
            {options.map(([key, value]) => (
              <div key={key} className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold text-muted-foreground">
                  {key}
                </span>
                <span className="pt-1 text-[14px] leading-6 text-foreground"><LatexText>{String(value)}</LatexText></span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const getAnswerRenderInfo = (
    question: IExamResult["questions"][number],
  ) => {
    const answerLanguage = inferStudentAnswerLanguage(
      question.title,
      question.content,
      question.answer_content,
    );
    const studentCodeLanguage = getStudentAnswerCodeLanguage(
      question.type,
      question.title,
      question.content,
      question.answer_content,
    );
    const standardCodeLanguage = getStudentAnswerCodeLanguage(
      question.type,
      question.title,
      question.content,
      question.standard_answer,
    );
    const isSqlAnswer = answerLanguage === "sql";
    const studentCode = renderAnswerAsCode(question.answer_content);
    const standardCode = renderAnswerAsCode(question.standard_answer);
    const shouldRenderStudentCode =
      (question.type === "code" || Boolean(studentCodeLanguage)) &&
      Boolean(studentCode.trim());
    const shouldRenderStandardCode =
      (question.type === "code" || Boolean(standardCodeLanguage)) &&
      Boolean(standardCode.trim());

    return {
      isSqlAnswer,
      studentCode,
      standardCode,
      studentCodeLanguage,
      standardCodeLanguage,
      shouldRenderStudentCode,
      shouldRenderStandardCode,
    };
  };

  const renderStudentAnswerContent = (question: IExamResult["questions"][number]) => {
    const info = getAnswerRenderInfo(question);
    if (info.shouldRenderStudentCode) {
      return (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="mb-2 text-[12px] capitalize text-muted-foreground">
            {info.studentCodeLanguage ?? "code"}
          </div>
          <CodeBlock code={info.studentCode} language={info.studentCodeLanguage} />
        </div>
      );
    }
    if (info.isSqlAnswer) {
      return (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
          <CodeBlock code={info.studentCode} language="sql" />
        </div>
      );
    }
    return (
      <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
        <LatexText>{renderAnswerSummary(question.answer_content)}</LatexText>
      </p>
    );
  };

  const renderStandardAnswerContent = (question: IExamResult["questions"][number]) => {
    const info = getAnswerRenderInfo(question);
    if (info.shouldRenderStandardCode) {
      return (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="mb-2 text-[12px] capitalize text-muted-foreground">
            {info.standardCodeLanguage ?? info.studentCodeLanguage ?? "code"}
          </div>
          <CodeBlock
            code={info.standardCode}
            language={info.standardCodeLanguage ?? info.studentCodeLanguage}
          />
        </div>
      );
    }
    if (info.isSqlAnswer) {
      return (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
          <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
          <CodeBlock code={info.standardCode} language="sql" />
        </div>
      );
    }
    return (
      <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
        <LatexText>{renderStandardAnswer(question.standard_answer)}</LatexText>
      </p>
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
    const modelEvaluation = question.feedback?.model_evaluation;
    const modelMatches = modelEvaluation?.matches?.filter((item) => item.reason?.trim()) ?? [];

    return (
      <section key={question.question_id} id={`exam-q-${question.order + 1}`} className="scroll-mt-24 rounded-2xl border border-border/70 bg-background p-6">
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
            {result.show_score ? (
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">{tStudent("result_score", undefined, locale)}</p>
              {question.grading_pending ? (
                <p className="text-[13px] font-medium text-amber-600">
                  <Brain className="inline h-3.5 w-3.5 mr-1" />
                  {tStudent("result_grading_pending", undefined, locale) || "评估中"}
                </p>
              ) : question.needs_human_review ? (
                <p className="text-[13px] font-medium text-amber-600">
                  <CircleAlert className="inline h-3.5 w-3.5 mr-1" />
                  等待人工复核
                </p>
              ) : question.grading_failed ? (
                <p className="text-[13px] font-medium text-destructive">
                  <CircleAlert className="inline h-3.5 w-3.5 mr-1" />
                  评分失败
                </p>
              ) : (
                <p className="text-[16px] font-semibold text-primary">
                  {question.score_awarded} / {question.total_score}
                </p>
              )}
            </div>
            ) : null}
          </div>

          {renderQuestionPrompt(question)}

          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">{tStudent("result_your_answer", undefined, locale)}</p>
              {renderStudentAnswerContent(question)}
            </div>
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">{tStudent("result_standard_answer", undefined, locale)}</p>
              {renderStandardAnswerContent(question)}
            </div>
          </div>

          {question.grading_failed ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-2 text-[14px] text-destructive">
                <CircleAlert className="mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">本题 AI 评分未完成</p>
                  <p className="mt-1 text-[13px] text-destructive/85">
                    系统在评分过程中遇到错误。你可以重新触发评分，或联系老师人工评分。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={regradingQuestionId === question.question_id}
                  onClick={() => requestRegrade(question.question_id)}
                >
                  {regradingQuestionId === question.question_id ? "正在重新评分..." : "重新评分"}
                </Button>
              </div>
            </div>
          ) : null}

          {question.needs_human_review ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 p-4 text-[14px] text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 shrink-0" />
                <p>本题 AI 评分结果存在分歧，正在等待教师人工复核。</p>
              </div>
            </div>
          ) : null}

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
                      <p className="mt-2 text-[14px] leading-6 text-muted-foreground"><LatexText>{dimension.comment}</LatexText></p>
                    </div>
                  ))}
                </div>
                {question.feedback.strengths?.length ? (
                  <div className="mt-4 rounded-xl bg-background p-4">
                    <p className="text-[13px] font-medium text-foreground">
                      {tStudent("result_strengths", undefined, locale)}
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted-foreground">
                      {question.feedback.strengths.map((line) => (
                        <li key={line}><LatexText>{line}</LatexText></li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
                {question.feedback.evidence_lines?.length ? (
                  <div className="mt-4 rounded-xl bg-background p-4">
                    <p className="text-[13px] font-medium text-foreground">
                      {tStudent("result_ai_summary", undefined, locale)}
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted-foreground">
                      {question.feedback.evidence_lines.map((line) => (
                        <li key={line}><LatexText>{line}</LatexText></li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                </div>
              </>
            ) : null}

            {question.analysis && detailsExpanded ? (
              <div className="rounded-xl bg-muted/25 p-4">
                <p className="text-[14px] font-medium text-foreground">
                  {tStudent("result_analysis_section", undefined, locale)}
                </p>
                <div
                  className="mt-2 text-[14px] leading-6 text-muted-foreground [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border/60 [&_img]:object-contain [&_p]:m-0 [&_p+*]:mt-3"
                  dangerouslySetInnerHTML={{
                    __html: renderLatexInHtml(question.analysis),
                  }}
                />
              </div>
            ) : null}

            {detailsExpanded && modelEvaluation ? (
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                    <Brain className="text-primary" data-icon="inline-start" />
                    模型评估输出
                  </div>
                  {modelEvaluation.model ? (
                    <Badge variant="secondary" className="rounded-full text-[11px]">
                      {modelEvaluation.model}
                    </Badge>
                  ) : null}
                </div>
                {modelMatches.length ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {modelMatches.map((match, index) => (
                      <div
                        key={`${match.index ?? index}-${match.reason}`}
                        className="rounded-lg bg-background px-3 py-2 text-[13px] leading-6 text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "font-medium",
                            match.is_correct
                              ? "text-emerald-600"
                              : (match.score ?? 0) > 0
                                ? "text-amber-600"
                                : "text-rose-600",
                          )}
                        >
                          {`第 ${match.index ?? index + 1} 空 · ${
                            match.is_correct
                              ? "可接受"
                              : (match.score ?? 0) > 0
                                ? `部分得分 (${match.score})`
                                : "未命中"
                          }`}
                        </span>
                        {match.expected ? (
                          <div className="mt-1 text-[12px] text-muted-foreground/80">
                            标准答案：<LatexText>{match.expected}</LatexText>
                          </div>
                        ) : null}
                        <div className="mt-1">
                          <LatexText>{match.reason || ""}</LatexText>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] text-muted-foreground">模型未返回可展示的详细理由。</p>
                )}
              </div>
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

  const renderMobileQuestionCard = (question: IExamResult["questions"][number], index: number) => {
    const isObjectiveQuestion =
      question.type === "choice" || question.type === "true_false" || question.type === "fill_in";
    return (
      <section key={question.question_id} id={`exam-q-${question.order + 1}`} className="scroll-mt-28 rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">
              {getStudentQuestionTypeLabel(question.type, locale)}
            </Badge>
            <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
              第 {index + 1} 题
            </span>
          </div>
          {result.show_score ? (
          <span className="shrink-0 text-[13px] font-semibold tabular-nums">
            {question.grading_pending ? (
              <span className="text-amber-600">评分中</span>
            ) : question.needs_human_review ? (
              <span className="text-amber-600">待复核</span>
            ) : question.grading_failed ? (
              <span className="text-destructive">评分失败</span>
            ) : (
              <span className={question.is_correct ? "text-emerald-600" : "text-destructive"}>
                {question.score_awarded}/{question.total_score}
              </span>
            )}
          </span>
          ) : (
          <span className="shrink-0 text-[13px] font-semibold tabular-nums">
            {question.grading_pending ? (
              <span className="text-amber-600">评分中</span>
            ) : question.needs_human_review ? (
              <span className="text-amber-600">待复核</span>
            ) : question.grading_failed ? (
              <span className="text-destructive">评分失败</span>
            ) : (
              <span className={question.is_correct ? "text-emerald-600" : "text-destructive"}>
                {tStudent(question.is_correct ? "result_correct" : "result_incorrect", undefined, locale)}
              </span>
            )}
          </span>
          )}
        </div>

        <div className="flex flex-col gap-3 px-3 pb-3">
          <div className="rounded-xl bg-muted/20 px-3 py-2.5">
            {renderQuestionPrompt(question)}
          </div>

          <div className="grid gap-2">
            <div className="rounded-xl bg-muted/30 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-foreground">
                {tStudent("result_your_answer", undefined, locale)}
              </p>
              {renderStudentAnswerContent(question)}
            </div>
            <div className="rounded-xl bg-muted/30 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-foreground">
                {tStudent("result_standard_answer", undefined, locale)}
              </p>
              {renderStandardAnswerContent(question)}
            </div>
          </div>

          {question.analysis ? (
            <div className="rounded-xl bg-muted/20 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-foreground">
                {tStudent("result_analysis_section", undefined, locale)}
              </p>
              <div
                className="mt-1.5 text-[13px] leading-6 text-muted-foreground [&_img]:max-h-64 [&_img]:max-w-full [&_img]:rounded-lg [&_p]:m-0 [&_p+*]:mt-2"
                dangerouslySetInnerHTML={{
                  __html: renderLatexInHtml(question.analysis),
                }}
              />
            </div>
          ) : null}

          {!isObjectiveQuestion && question.feedback?.dimensions?.length ? (
            <div className="rounded-xl bg-muted/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <Brain className="h-3.5 w-3.5 text-primary" />
                {tStudent("result_feedback", undefined, locale)}
              </div>
              <div className="mt-2 grid gap-2">
                {question.feedback.dimensions.map((dimension) => (
                  <div key={dimension.name} className="rounded-lg bg-background px-2.5 py-2 text-[12px]">
                    <div className="flex items-center justify-between gap-2 font-medium">
                      <span>{dimension.name}</span>
                      <span className="text-primary">{dimension.score}/{dimension.max_score}</span>
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">
                      <LatexText>{dimension.comment}</LatexText>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  const renderNavQuestionButton = (question: IExamResult["questions"][number], index: number) => {
    const isActive = index === safeQuestionIndex;
    const statusLabel = question.grading_pending
      ? (tStudent("result_grading_pending", undefined, locale) || "评估中")
      : question.needs_human_review
        ? "待人工复核"
        : question.grading_failed
          ? "评分失败"
          : question.is_correct
            ? tStudent("result_correct", undefined, locale)
            : tStudent("result_incorrect", undefined, locale);
    const showAttentionState = question.grading_pending || question.needs_human_review || question.grading_failed;

    return (
      <button
        key={question.question_id}
        type="button"
        aria-label={`${tStudent("result_jump_to_question", { number: question.order + 1 }, locale)}，${getStudentQuestionTypeLabel(question.type, locale)}，${statusLabel}，${result.show_score ? `${question.score_awarded}/${question.total_score}` : statusLabel}`}
        title={`${tStudent("result_question_number", { number: question.order + 1 }, locale)} · ${statusLabel} · ${result.show_score ? `${question.score_awarded}/${question.total_score}` : statusLabel}`}
        onClick={() => setActiveQuestionIndex(index)}
        className={cn(
          "group flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-all",
          isActive
            ? "border-primary/50 bg-primary/10 text-primary shadow-sm ring-2 ring-primary/15"
            : question.grading_failed
              ? "border-destructive/30 bg-destructive/5"
              : showAttentionState
                ? "border-amber-200 bg-amber-50/50"
                : "border-border/60 bg-background text-foreground hover:border-primary/25 hover:bg-muted/40",
        )}
      >
        <span className="text-sm font-semibold tabular-nums leading-none">{question.order + 1}</span>
        {question.grading_pending || question.needs_human_review ? (
          <span className="h-1.5 w-6 rounded-full bg-amber-400/75" />
        ) : question.grading_failed ? (
          <span className="h-1.5 w-6 rounded-full bg-destructive/75" />
        ) : (
          <span
            className={cn(
              "h-1.5 w-6 rounded-full",
              question.is_correct ? "bg-emerald-500/75" : "bg-destructive/75",
            )}
          />
        )}
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {question.grading_pending ? "—" : result.show_score ? `${question.score_awarded}/${question.total_score}` : (question.is_correct ? tStudent("result_correct", undefined, locale) : tStudent("result_incorrect", undefined, locale))}
        </span>
      </button>
    );
  };

  const renderQuickNavButton = (
    question: IExamResult["questions"][number],
    index: number,
    size: "sm" | "md" = "md",
  ) => {
    const isActive = index === activeViewAllQuestionIndex;
    const showAttentionState =
      question.grading_pending || question.needs_human_review || question.grading_failed;
    return (
      <button
        key={question.question_id}
        type="button"
        aria-label={tStudent("result_jump_to_question", { number: question.order + 1 }, locale)}
        title={`${tStudent("result_question_number", { number: question.order + 1 }, locale)} · ${question.grading_pending ? "—" : (result.show_score ? `${question.score_awarded}/${question.total_score}` : (question.is_correct ? tStudent("result_correct", undefined, locale) : tStudent("result_incorrect", undefined, locale)))}`}
        onClick={() => scrollToQuestion(index)}
        className={cn(
          size === "sm"
            ? "flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-all"
            : "flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-all",
          isActive
            ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/15"
            : question.grading_failed
              ? "border-destructive/30 bg-destructive/5 text-foreground hover:bg-destructive/10"
              : showAttentionState
                ? "border-amber-200 bg-amber-50/50 text-foreground hover:bg-amber-50"
                : question.is_correct
                  ? "border-emerald-200 bg-emerald-50/50 text-foreground hover:bg-emerald-50"
                  : "border-destructive/30 bg-destructive/5 text-foreground hover:bg-destructive/10",
        )}
      >
        {question.order + 1}
      </button>
    );
  };

  if (isMobile) {
    return (
      <div className="flex min-h-screen flex-col bg-muted/20">
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-3">
          <button onClick={() => navigate(returnHref)} className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{result.title}</h1>
        </header>

        <div className="flex flex-col gap-3 px-3 py-3">
          {result.show_score ? (
          <section className="rounded-2xl bg-card px-3 py-3 shadow-sm ring-1 ring-border/60">
            {result.grading_status === "pending_ai" && result.objective_score != null ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">客观题得分</p>
                  <p className="mt-0.5 text-[12px] text-amber-600">
                    <Brain className="mr-0.5 inline h-3 w-3" />主观题AI评分中…
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span className="text-3xl font-bold leading-none text-primary">{result.objective_score}</span>
                  <span className="text-base font-semibold text-muted-foreground">/{result.total_score}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {tStudent("result_total_score", undefined, locale)}
                  </p>
                  {result.submitted_at ? (
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {formatStudentDate(result.submitted_at)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span className="text-3xl font-bold leading-none text-primary">{result.score ?? 0}</span>
                  <span className="text-base font-semibold text-muted-foreground">/{result.total_score}</span>
                </div>
              </div>
            )}
            {renderRetakeButton("mt-3 h-9 w-full text-sm font-semibold")}
          </section>
          ) : (
            <section className="rounded-2xl bg-card px-3 py-3 shadow-sm ring-1 ring-border/60">
              {result.submitted_at ? (
                <p className="text-[12px] text-muted-foreground">
                  {formatStudentDate(result.submitted_at)}
                </p>
              ) : null}
              {renderRetakeButton("mt-3 h-9 w-full text-sm font-semibold")}
            </section>
          )}

          {questions.length > 1 ? (
            <div className="sticky top-12 z-10 rounded-2xl bg-background/95 px-3 py-2 shadow-sm ring-1 ring-border/60 backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">{tStudent("result_quick_nav", undefined, locale)}</span>
                <span className="text-[10px] text-muted-foreground">{tStudent("result_quick_nav_hint", undefined, locale)}</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {questions.map((question, index) => renderQuickNavButton(question, index, "sm"))}
              </div>
            </div>
          ) : null}

          {questions.map((question, index) => renderMobileQuestionCard(question, index))}
        </div>
      </div>
    );
  }

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
          onClick={() => navigate(returnHref)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:justify-self-end"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </button>
      </div>

      <section className="rounded-2xl border border-border/70 bg-background p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-foreground">{result.title}</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">{tStudent("result_intro", undefined, locale)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {result.show_score ? (
            result.grading_status === "pending_ai" && result.objective_score != null ? (
              <>
                <div className="rounded-2xl bg-muted px-5 py-3 text-right">
                  <p className="text-[12px] text-muted-foreground">{tStudent("result_objective_score", undefined, locale) || "客观题得分"}</p>
                  <p className="text-[16px] font-semibold text-emerald-600">
                    {result.objective_score} / {result.total_score}
                  </p>
                </div>
                <p className="text-[12px] text-amber-600 font-medium">
                  <Brain className="inline h-3.5 w-3.5 mr-1" />
                  {tStudent("result_subjective_pending", undefined, locale) || "主观题正在AI评估中"}
                </p>
              </>
            ) : (
              <div className="rounded-2xl bg-muted px-5 py-4 text-right">
                <p className="text-[12px] text-muted-foreground">{tStudent("result_total_score", undefined, locale)}</p>
                <p className="mt-1 text-[16px] font-semibold text-primary">
                  {result.score ?? 0} / {result.total_score}
                </p>
              </div>
            )
            ) : null}
            {renderRetakeButton()}
          </div>
        </div>
      </section>

      {result.blocked_reason ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {result.blocked_reason}
        </div>
      ) : null}

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
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl border border-border/70 bg-background p-4 lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{tStudent("result_question_nav", undefined, locale)}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{tStudent("result_question_count", { count: result.questions.length }, locale)}</p>
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

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Total" : "全部"}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{questions.length}</p>
              </div>
              <div className="rounded-xl bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{tStudent("result_correct", undefined, locale)}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{correctCount}</p>
              </div>
              <div className="rounded-xl bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{tStudent("result_incorrect", undefined, locale)}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-destructive">{incorrectCount}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/25 px-3 py-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500/75" />
                {tStudent("result_correct", undefined, locale)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-destructive/75" />
                {tStudent("result_incorrect", undefined, locale)}
              </span>
              <span className="ml-auto">{locale === "en" ? "Click to jump" : "点击跳转"}</span>
            </div>

            <div className="exam-result-nav-scroll mt-4 flex max-h-[min(560px,calc(100vh-280px))] flex-col gap-4 overflow-y-auto pr-1">
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
                      <div className="grid grid-cols-4 gap-2">
                        {items.map(({ question, index }) => renderNavQuestionButton(question, index))}
                      </div>
                    </div>
                  ))
                : (
                    <div className="grid grid-cols-4 gap-2">
                      {questions.map((question, index) => renderNavQuestionButton(question, index))}
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
          {questions.length > 1 ? (
            <div className="sticky top-2 z-10 rounded-2xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{tStudent("result_quick_nav", undefined, locale)}</span>
                <span className="text-[10px] text-muted-foreground">{tStudent("result_quick_nav_hint", undefined, locale)}</span>
                <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-emerald-500/75" />
                    {tStudent("result_correct", undefined, locale)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-destructive/75" />
                    {tStudent("result_incorrect", undefined, locale)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {questions.map((question, index) => renderQuickNavButton(question, index))}
              </div>
            </div>
          ) : null}
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
