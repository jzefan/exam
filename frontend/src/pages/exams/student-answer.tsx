import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Brain, Check, ChevronLeft, ChevronRight, CircleAlert, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { LatexText, renderLatexInHtml } from "@/components/ui/latex-text";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/pages/grading/api";
import {
  getStudentAnswerCodeLanguage,
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "@/pages/student/utils";
import { getStudentQuestionTypeLabel } from "@/pages/student/i18n";
import type { IExamResult, IExamStudent } from "@/types";
import { cn } from "@/lib/utils";
import { dimensionLabel } from "@/lib/dimension-display";

function getPrimaryStudentTime(student: IExamStudent) {
  return student.submitted_at ?? student.started_at ?? null;
}

interface ManualQuestionScoreResponse {
  question_id: string;
  total_score: number;
  score_awarded: number;
  is_correct: boolean;
  objective_score: number | null;
  subjective_score: number | null;
  exam_score: number | null;
  grading_status: IExamResult["grading_status"];
  feedback: IExamResult["questions"][number]["feedback"];
}

export function StudentAnswerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 返回目标：从结果分析进入则回到结果分析；从考试考生进入则回到考试考生。
  // backState 用于把上一级（如课程详情/考试管理）的返回信息继续向上带。
  const answerNavState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
    backState?: unknown;
  };
  const goBack = () =>
    navigate(answerNavState.backTo ?? "/exams/students", {
      state: answerNavState.backState,
    });
  const { examId, studentId } = useParams<{
    examId: string;
    studentId: string;
  }>();
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [navMode, setNavMode] = useState<"type" | "order">("type");
  const [examStudents, setExamStudents] = useState<IExamStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [aiGradingQuestionId, setAiGradingQuestionId] = useState<string | null>(null);
  const [editingScoreQuestionId, setEditingScoreQuestionId] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const [savingScoreQuestionId, setSavingScoreQuestionId] = useState<string | null>(null);
  const { toast } = useToast();
  const preserveQuestionIndexRef = useRef(false);

  useEffect(() => {
    if (!examId || !studentId) return;
    let alive = true;
    setLoading(true);
    void apiRequest<IExamResult>(
      `/exams/${examId}/students/${studentId}/result`,
    )
      .then((data) => {
        if (alive) setResult(data);
      })
      .catch(() => {
        if (alive) setResult(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [examId, studentId]);

  useEffect(() => {
    if (!examId) return;
    let alive = true;
    setStudentsLoading(true);
    void apiRequest<IExamStudent[]>(`/exams/${examId}/students`)
      .then((payload) => {
        if (!alive) return;
        const sorted = [...payload].sort((left, right) => {
          const leftTime = new Date(getPrimaryStudentTime(left) ?? 0).getTime();
          const rightTime = new Date(
            getPrimaryStudentTime(right) ?? 0,
          ).getTime();
          return rightTime - leftTime;
        });
        setExamStudents(sorted);
      })
      .catch(() => {
        if (alive) setExamStudents([]);
      })
      .finally(() => {
        if (alive) setStudentsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [examId]);

  useEffect(() => {
    if (preserveQuestionIndexRef.current) {
      preserveQuestionIndexRef.current = false;
      return;
    }
    setActiveQuestionIndex(0);
  }, [result?.exam_id, studentId]);

  useEffect(() => {
    setNavMode("type");
  }, [result?.exam_id, studentId]);

  const handleAiGradeFillIn = async (questionId: string) => {
    if (!examId || !studentId) return;
    setAiGradingQuestionId(questionId);
    try {
      const patch = await apiRequest<{
        question_id: string;
        total_score: number;
        score_awarded: number;
        is_correct: boolean;
        feedback: IExamResult["questions"][number]["feedback"];
      }>(
        `/exams/${examId}/students/${studentId}/questions/${questionId}/ai-grade`,
        { method: "POST" },
      );
      setResult((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          questions: previous.questions.map((question) =>
            question.question_id === patch.question_id
              ? {
                  ...question,
                  score_awarded: patch.score_awarded,
                  total_score: patch.total_score,
                  is_correct: patch.is_correct,
                  feedback: patch.feedback,
                }
              : question,
          ),
        };
      });
      toast({
        title: "AI 判题完成",
        description: `本题得分：${patch.score_awarded} / ${patch.total_score}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "请稍后再试";
      toast({ title: "AI 判题失败", description: message, variant: "destructive" });
    } finally {
      setAiGradingQuestionId(null);
    }
  };

  const startEditingScore = (question: IExamResult["questions"][number]) => {
    setEditingScoreQuestionId(question.question_id);
    setScoreDraft(String(question.score_awarded));
  };

  const cancelEditingScore = () => {
    setEditingScoreQuestionId(null);
    setScoreDraft("");
  };

  const saveManualScore = async (question: IExamResult["questions"][number]) => {
    if (!examId || !studentId) return;
    const nextScore = Number(scoreDraft);
    if (!Number.isFinite(nextScore) || nextScore < 0 || nextScore > question.total_score) {
      toast({
        title: "分数不合法",
        description: `请输入 0 到 ${question.total_score} 之间的分数。`,
        variant: "destructive",
      });
      return;
    }

    setSavingScoreQuestionId(question.question_id);
    try {
      const patch = await apiRequest<ManualQuestionScoreResponse>(
        `/exams/${examId}/students/${studentId}/questions/${question.question_id}/score`,
        {
          method: "PATCH",
          body: JSON.stringify({ score_awarded: nextScore }),
        },
      );
      setResult((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          score: patch.exam_score,
          objective_score: patch.objective_score,
          subjective_score: patch.subjective_score,
          grading_status: patch.grading_status,
          questions: previous.questions.map((item) =>
            item.question_id === patch.question_id
              ? {
                  ...item,
                  score_awarded: patch.score_awarded,
                  total_score: patch.total_score,
                  is_correct: patch.is_correct,
                  feedback: patch.feedback,
                }
              : item,
          ),
        };
      });
      setEditingScoreQuestionId(null);
      setScoreDraft("");
      toast({
        title: "分数已更新",
        description: `本题得分：${patch.score_awarded} / ${patch.total_score}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "请稍后再试";
      toast({ title: "保存分数失败", description: message, variant: "destructive" });
    } finally {
      setSavingScoreQuestionId(null);
    }
  };

  const questions = result?.questions ?? [];
  const safeIndex =
    questions.length === 0
      ? 0
      : Math.min(activeQuestionIndex, questions.length - 1);
  const activeQuestion = questions[safeIndex] ?? null;
  const correctCount = questions.filter((q) => q.is_correct).length;

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

  const currentStudentIndex = examStudents.findIndex(
    (student) => student.student_id === studentId,
  );
  const currentStudent =
    currentStudentIndex >= 0 ? examStudents[currentStudentIndex] : null;
  const previousStudent =
    currentStudentIndex > 0 ? examStudents[currentStudentIndex - 1] : null;
  const nextStudent =
    currentStudentIndex >= 0 && currentStudentIndex < examStudents.length - 1
      ? examStudents[currentStudentIndex + 1]
      : null;
  const currentStudentLabel =
    currentStudent?.full_name ||
    currentStudent?.username ||
    currentStudent?.phone ||
    "当前考生";
  const navigateToStudent = (targetStudentId: string) => {
    if (!examId) return;
    preserveQuestionIndexRef.current = true;
    // 保留返回信息，切换上一/下一位考生后「返回」仍指向正确来源。
    navigate(`/exams/${examId}/students/${targetStudentId}/result`, {
      state: answerNavState,
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl border bg-background p-8 text-sm text-muted-foreground">
        加载失败，请返回重试。
      </div>
    );
  }

  const renderQuestionPrompt = (question: IExamResult["questions"][number]) => {
    const content = question.content as { text?: string; description?: string };
    const promptHtml =
      typeof content.text === "string" && content.text.trim()
        ? content.text
        : typeof content.description === "string" && content.description.trim()
          ? content.description
          : "";
    const options =
      question.options && typeof question.options === "object"
        ? Object.entries(question.options)
        : [];

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
              <div
                key={key}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-[12px] font-semibold text-muted-foreground">
                  {key}
                </span>
                <span className="pt-1 text-[14px] leading-6 text-foreground">
                  <LatexText>{String(value)}</LatexText>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderQuestionCard = (question: IExamResult["questions"][number]) => {
    const isObjective = ["choice", "true_false", "fill_in"].includes(
      question.type,
    );
    const modelEvaluation = question.feedback?.model_evaluation;
    const modelMatches = modelEvaluation?.matches?.filter((item) => item.reason?.trim()) ?? [];

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
    const isSql = answerLanguage === "sql";
    const studentCode = renderAnswerAsCode(question.answer_content);
    const standardCode = renderAnswerAsCode(question.standard_answer);
    const shouldRenderStudentCode =
      (question.type === "code" || Boolean(studentCodeLanguage)) &&
      Boolean(studentCode.trim());
    const shouldRenderStandardCode =
      (question.type === "code" || Boolean(standardCodeLanguage)) &&
      Boolean(standardCode.trim());
    const isEditingScore = editingScoreQuestionId === question.question_id;
    const isSavingScore = savingScoreQuestionId === question.question_id;

    return (
      <section
        key={question.question_id}
        className="rounded-2xl border border-border/70 bg-background p-6"
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="rounded-full px-2.5 py-1 font-medium"
              >
                {getStudentQuestionTypeLabel(question.type, "zh")}
              </Badge>
              <span className="text-[12px] text-muted-foreground">
                第 {question.order + 1} 题
              </span>
            </div>
            {question.type === "fill_in" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[12px] font-medium"
                disabled={aiGradingQuestionId === question.question_id}
                onClick={() => handleAiGradeFillIn(question.question_id)}
              >
                {aiGradingQuestionId === question.question_id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" data-icon="inline-start" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" data-icon="inline-start" />
                )}
                AI 判题
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center justify-end gap-2 text-right">
              <span className="text-[12px] text-muted-foreground">得分</span>
              {question.grading_pending ? (
                <span className="text-[13px] font-medium text-amber-600">
                  <Brain className="inline h-3.5 w-3.5 mr-1" />
                  评估中
                </span>
              ) : isEditingScore ? (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Input
                    aria-label="本题得分"
                    type="number"
                    min={0}
                    max={question.total_score}
                    step="0.5"
                    value={scoreDraft}
                    disabled={isSavingScore}
                    onChange={(event) => setScoreDraft(event.target.value)}
                    className="h-8 w-20 text-right text-[13px]"
                  />
                  <span className="text-[13px] text-muted-foreground">
                    / {question.total_score}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="保存分数"
                    className="h-8 w-8 p-0"
                    disabled={isSavingScore}
                    onClick={() => saveManualScore(question)}
                  >
                    {isSavingScore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="取消改分"
                    className="h-8 w-8 p-0"
                    disabled={isSavingScore}
                    onClick={cancelEditingScore}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="text-[16px] font-semibold text-primary">
                    {question.score_awarded} / {question.total_score}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[12px]"
                    disabled={Boolean(savingScoreQuestionId)}
                    onClick={() => startEditingScore(question)}
                  >
                    <Pencil className="h-3.5 w-3.5" data-icon="inline-start" />
                    改分
                  </Button>
                </>
              )}
            </div>
          </div>

          {renderQuestionPrompt(question)}

          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">
                学生答案
              </p>
              {shouldRenderStudentCode ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] capitalize text-muted-foreground">
                    {studentCodeLanguage ?? "code"}
                  </div>
                  <CodeBlock code={studentCode} language={studentCodeLanguage} />
                </div>
              ) : isSql ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] text-muted-foreground">
                    SQL
                  </div>
                  <CodeBlock code={studentCode} language="sql" />
                </div>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  <LatexText>
                    {renderAnswerSummary(question.answer_content)}
                  </LatexText>
                </p>
              )}
            </div>

            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">
                标准答案
              </p>
              {shouldRenderStandardCode ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] capitalize text-muted-foreground">
                    {standardCodeLanguage ?? studentCodeLanguage ?? "code"}
                  </div>
                  <CodeBlock
                    code={standardCode}
                    language={standardCodeLanguage ?? studentCodeLanguage}
                  />
                </div>
              ) : isSql ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] text-muted-foreground">
                    SQL
                  </div>
                  <CodeBlock code={standardCode} language="sql" />
                </div>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  <LatexText>
                    {renderStandardAnswer(question.standard_answer)}
                  </LatexText>
                </p>
              )}
            </div>
          </div>

          {!isObjective ? (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                <Brain className="text-primary" data-icon="inline-start" />
                AI 评分详情
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {question.feedback.dimensions?.map((dim) => (
                  <div key={dim.name} className="rounded-xl bg-background p-4">
                    <div className="flex items-center justify-between text-[14px] font-medium">
                      <span>{dimensionLabel(dim.name)}</span>
                      <span className="text-primary">
                        {dim.score} / {dim.max_score}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                      <LatexText>{dim.comment}</LatexText>
                    </p>
                  </div>
                ))}
              </div>
              {question.feedback.strengths?.length ? (
                <div className="mt-4 rounded-xl bg-background p-4">
                  <p className="text-[13px] font-medium text-foreground">
                    优点
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted-foreground">
                    {question.feedback.strengths.map((line) => (
                      <li key={line}>
                        <LatexText>{line}</LatexText>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {question.feedback.deductions?.length ? (
                <div className="mt-4 flex flex-col gap-2">
                  {question.feedback.deductions.map((line) => (
                    <div
                      key={line}
                      className="flex items-start gap-2 text-[14px] text-amber-700 dark:text-amber-300"
                    >
                      <CircleAlert
                        className="mt-0.5 shrink-0"
                        data-icon="inline-start"
                      />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {question.feedback.suggestions?.length ? (
                <div className="mt-4 rounded-xl bg-background p-4 text-[14px] leading-6 text-muted-foreground">
                  建议：{question.feedback.suggestions.join("；")}
                </div>
              ) : null}
              {question.feedback.evidence_lines?.length ? (
                <div className="mt-4 rounded-xl bg-background p-4">
                  <p className="text-[13px] font-medium text-foreground">
                    AI 摘要
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted-foreground">
                    {question.feedback.evidence_lines.map((line) => (
                      <li key={line}>
                        <LatexText>{line}</LatexText>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {modelEvaluation ? (
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
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "shrink-0 font-medium",
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
                      </div>
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
                <p className="mt-3 text-[13px] text-muted-foreground">
                  模型未返回可展示的详细理由。
                </p>
              )}
            </div>
          ) : null}

          {question.analysis ? (
            <div className="rounded-xl bg-muted/25 p-4">
              <p className="text-[14px] font-medium text-foreground">解析</p>
              <div
                className="mt-2 text-[14px] leading-6 text-muted-foreground [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border/60 [&_img]:object-contain [&_p]:m-0 [&_p+*]:mt-3"
                dangerouslySetInnerHTML={{
                  __html: renderLatexInHtml(question.analysis),
                }}
              />
            </div>
          ) : null}

          {question.appeal_reason ? (
            <div className="rounded-xl border border-border/60 bg-background p-4 text-[14px]">
              <p className="font-medium text-foreground">考生申诉</p>
              <p className="mt-1 text-muted-foreground">
                {question.appeal_reason}
              </p>
              {question.appeal_reply ? (
                <div className="mt-3 rounded-xl bg-muted/30 p-3 text-muted-foreground">
                  教师回复：{question.appeal_reply}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  const renderNavButton = (
    question: IExamResult["questions"][number],
    index: number,
  ) => {
    const isActive = index === safeIndex;
    return (
      <button
        key={question.question_id}
        type="button"
        title={`第 ${question.order + 1} 题 · ${question.score_awarded}/${question.total_score}`}
        onClick={() => setActiveQuestionIndex(index)}
        className={cn(
          "group flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-all",
          isActive
            ? "border-primary/50 bg-primary/10 text-primary shadow-sm ring-2 ring-primary/15"
            : question.grading_pending
              ? "border-amber-200 bg-amber-50/50"
              : "border-border/60 bg-background text-foreground hover:border-primary/25 hover:bg-muted/40",
        )}
      >
        <span className="text-sm font-semibold tabular-nums leading-none">
          {question.order + 1}
        </span>
        {question.grading_pending ? (
          <span className="h-1.5 w-6 rounded-full bg-amber-400/75" />
        ) : question.is_correct ? (
          <span className="h-1.5 w-6 rounded-full bg-emerald-500/75" />
        ) : question.score_awarded > 0 ? (
          <span className="inline-flex h-1.5 w-6 overflow-hidden rounded-full">
            <span
              className="h-full bg-emerald-500/75"
              style={{
                width: `${Math.round(
                  (question.score_awarded / question.total_score) * 100,
                )}%`,
              }}
            />
            <span className="h-full flex-1 bg-destructive/75" />
          </span>
        ) : (
          <span className="h-1.5 w-6 rounded-full bg-destructive/75" />
        )}
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {question.grading_pending
            ? "—"
            : `${question.score_awarded}/${question.total_score}`}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: breadcrumb + submission timestamp */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={goBack}
            className="flex shrink-0 items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft size={15} />
            {answerNavState.backLabel ?? "返回"}
          </button>
          <span className="text-muted-foreground/40">|</span>
          <span className="font-medium text-foreground">答卷详情</span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-muted-foreground">{result.title}</span>
        </div>
        {result.submitted_at ? (
          <div className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            提交于 {new Date(result.submitted_at).toLocaleString("zh-CN")}
          </div>
        ) : null}
      </div>

      {/* Row 2: avatar + student info + score + prev/next nav */}
      <div className="flex items-center rounded-2xl border border-border/70 bg-background px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {(currentStudentLabel[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {currentStudent?.full_name ||
                  currentStudent?.username ||
                  currentStudent?.phone ||
                  "—"}
              </span>
              {currentStudent?.full_name &&
              (currentStudent.username || currentStudent.phone) ? (
                <span className="text-xs text-muted-foreground">
                  {currentStudent.username || currentStudent.phone}
                </span>
              ) : null}
            </div>
            {currentStudentIndex >= 0 && examStudents.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                考生 {currentStudentIndex + 1} / {examStudents.length}
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-x border-border/50 px-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            {result.grading_status === "pending_ai" ? "客观题得分" : "总得分"}
          </p>
          <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-primary">
            {result.grading_status === "pending_ai"
              ? (result.objective_score ?? "—")
              : (result.score ?? 0)}
            {" / "}
            {result.total_score}
          </p>
          {result.grading_status === "pending_ai" ? (
            <p className="mt-1 text-[10px] text-amber-600">
              <Brain className="mr-0.5 inline h-3 w-3" />
              主观题评估中
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pl-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={studentsLoading || !previousStudent}
            onClick={() =>
              previousStudent && navigateToStudent(previousStudent.student_id)
            }
            className="h-8 px-2.5 text-[13px]"
          >
            <ChevronLeft className="size-3.5" />
            上一个
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={studentsLoading || !nextStudent}
            onClick={() =>
              nextStudent && navigateToStudent(nextStudent.student_id)
            }
            className="h-8 px-2.5 text-[13px]"
          >
            下一个
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {!result.can_view ? (
        <div className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-8">
          <p className="text-[14px] text-muted-foreground">
            {result.blocked_reason ?? "暂无答卷数据"}
          </p>
        </div>
      ) : (
        <>
          {result.blocked_reason ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {result.blocked_reason}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="self-start rounded-2xl border border-border/70 bg-background p-4 lg:sticky lg:top-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      题目导航
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      共 {questions.length} 题
                    </p>
                  </div>
                  <div className="inline-flex shrink-0 rounded-lg bg-muted p-1">
                    <button
                      type="button"
                      onClick={() => setNavMode("type")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        navMode === "type"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      按题型
                    </button>
                    <button
                      type="button"
                      onClick={() => setNavMode("order")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        navMode === "order"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      按顺序
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">全部</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {questions.length}
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">答对</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {correctCount}
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">答错</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-destructive">
                      {questions.length - correctCount}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/25 px-3 py-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-emerald-500/75" />
                    答对
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-destructive/75" />
                    答错
                  </span>
                  <span className="ml-auto">点击跳转</span>
                </div>

                <div className="exam-result-nav-scroll mt-4 flex max-h-[min(560px,calc(100vh-280px))] flex-col gap-4 overflow-y-auto pr-1">
                  {navMode === "type" ? (
                    groupedQuestions.map(([type, items]) => (
                      <div key={type} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                            {getStudentQuestionTypeLabel(type, "zh")}
                          </h3>
                          <span className="text-[10px] text-muted-foreground">
                            {items.length} 题
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {items.map(({ question, index }) =>
                            renderNavButton(question, index),
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {questions.map((q, i) => renderNavButton(q, i))}
                    </div>
                  )}
                </div>
              </aside>

              {activeQuestion ? renderQuestionCard(activeQuestion) : null}
            </div>
        </>
      )}
    </div>
  );
}
