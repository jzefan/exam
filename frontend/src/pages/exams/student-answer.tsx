import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, CircleAlert, List, PanelLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { LatexText, renderLatexInHtml } from "@/components/ui/latex-text";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/pages/grading/api";
import {
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "@/pages/student/utils";
import { getStudentQuestionTypeLabel } from "@/pages/student/i18n";
import type { IExamResult } from "@/types";
import { cn } from "@/lib/utils";

export function StudentAnswerPage() {
  const navigate = useNavigate();
  const { examId, studentId } = useParams<{ examId: string; studentId: string }>();
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"nav" | "all">("nav");
  const [navMode, setNavMode] = useState<"type" | "order">("type");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!examId || !studentId) return;
    let alive = true;
    setLoading(true);
    void apiRequest<IExamResult>(`/exams/${examId}/students/${studentId}/result`)
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
    setActiveQuestionIndex(0);
  }, [result?.exam_id]);

  useEffect(() => {
    setExpandedIds({});
  }, [result?.exam_id, viewMode]);

  useEffect(() => {
    setNavMode("type");
  }, [result?.exam_id]);

  const questions = result?.questions ?? [];
  const safeIndex = questions.length === 0 ? 0 : Math.min(activeQuestionIndex, questions.length - 1);
  const activeQuestion = questions[safeIndex] ?? null;
  const correctCount = questions.filter((q) => q.is_correct).length;

  const groupedQuestions = useMemo(() => {
    const groups = new Map<string, Array<{ question: IExamResult["questions"][number]; index: number }>>();
    questions.forEach((question, index) => {
      const key = question.type;
      const current = groups.get(key) ?? [];
      current.push({ question, index });
      groups.set(key, current);
    });
    return Array.from(groups.entries());
  }, [questions]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () =>
    setExpandedIds(Object.fromEntries(questions.map((q) => [q.question_id, true])));
  const collapseAll = () => setExpandedIds({});
  const allExpanded =
    viewMode === "all" &&
    questions.length > 0 &&
    questions.every((q) => expandedIds[q.question_id]);

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
              <div key={key} className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
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

  const renderQuestionCard = (
    question: IExamResult["questions"][number],
    opts?: { collapsible?: boolean },
  ) => {
    const collapsible = opts?.collapsible ?? false;
    const detailsExpanded = !collapsible || Boolean(expandedIds[question.question_id]);
    const isObjective = ["choice", "true_false", "fill_in"].includes(question.type);

    const answerLanguage = inferStudentAnswerLanguage(
      question.title,
      question.content,
      question.answer_content,
    );
    const isSql = answerLanguage === "sql";
    const studentCode = renderAnswerAsCode(question.answer_content);
    const standardCode = renderAnswerAsCode(question.standard_answer);

    return (
      <section key={question.question_id} className="rounded-2xl border border-border/70 bg-background p-6">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full px-2.5 py-1 font-medium">
                {getStudentQuestionTypeLabel(question.type, "zh")}
              </Badge>
              <span className="text-[12px] text-muted-foreground">第 {question.order + 1} 题</span>
            </div>
            {collapsible ? (
              <div className="flex justify-center md:justify-self-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[12px] font-medium text-muted-foreground"
                  onClick={() => toggleExpanded(question.question_id)}
                >
                  {detailsExpanded ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
                  {detailsExpanded
                    ? "收起"
                    : isObjective
                      ? "展开答案详情"
                      : "展开评分详情"}
                </Button>
              </div>
            ) : null}
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">得分</p>
              {question.grading_pending ? (
                <p className="text-[13px] font-medium text-amber-600">
                  <Brain className="inline h-3.5 w-3.5 mr-1" />
                  评估中
                </p>
              ) : (
                <p className="text-[16px] font-semibold text-primary">
                  {question.score_awarded} / {question.total_score}
                </p>
              )}
            </div>
          </div>

          {renderQuestionPrompt(question)}

          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">学生答案</p>
              {question.type === "code" &&
              typeof question.answer_content.code === "string" &&
              question.answer_content.code.trim() ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border bg-slate-950">
                  <div className="border-b border-white/10 px-3 py-2 text-[12px] text-slate-300">
                    {(question.answer_content.language as string | undefined) ?? "code"}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-[13px] leading-6 text-slate-100">
                    {question.answer_content.code as string}
                  </pre>
                </div>
              ) : isSql ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
                  <CodeBlock code={studentCode} language="sql" />
                </div>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  <LatexText>{renderAnswerSummary(question.answer_content)}</LatexText>
                </p>
              )}
            </div>

            <div className="rounded-xl bg-muted/35 p-4">
              <p className="text-[14px] font-medium text-foreground">标准答案</p>
              {isSql ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 text-[12px] text-muted-foreground">SQL</div>
                  <CodeBlock code={standardCode} language="sql" />
                </div>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                  <LatexText>{renderStandardAnswer(question.standard_answer)}</LatexText>
                </p>
              )}
            </div>
          </div>

          {detailsExpanded && !isObjective ? (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                <Brain className="text-primary" data-icon="inline-start" />
                AI 评分详情
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {question.feedback.dimensions?.map((dim) => (
                  <div key={dim.name} className="rounded-xl bg-background p-4">
                    <div className="flex items-center justify-between text-[14px] font-medium">
                      <span>{dim.name}</span>
                      <span className="text-primary">{dim.score} / {dim.max_score}</span>
                    </div>
                    <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
                      <LatexText>{dim.comment}</LatexText>
                    </p>
                  </div>
                ))}
              </div>
              {question.feedback.strengths?.length ? (
                <div className="mt-4 rounded-xl bg-background p-4">
                  <p className="text-[13px] font-medium text-foreground">优点</p>
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
                  建议：{question.feedback.suggestions.join("；")}
                </div>
              ) : null}
              {question.feedback.evidence_lines?.length ? (
                <div className="mt-4 rounded-xl bg-background p-4">
                  <p className="text-[13px] font-medium text-foreground">AI 摘要</p>
                  <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted-foreground">
                    {question.feedback.evidence_lines.map((line) => (
                      <li key={line}><LatexText>{line}</LatexText></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {question.analysis && detailsExpanded ? (
            <div className="rounded-xl bg-muted/25 p-4 text-[14px] leading-6 text-muted-foreground">
              解析：{question.analysis}
            </div>
          ) : null}

          {question.appeal_reason ? (
            <div className="rounded-xl border border-border/60 bg-background p-4 text-[14px]">
              <p className="font-medium text-foreground">考生申诉</p>
              <p className="mt-1 text-muted-foreground">{question.appeal_reason}</p>
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

  const renderNavButton = (question: IExamResult["questions"][number], index: number) => {
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
        <span className="text-sm font-semibold tabular-nums leading-none">{question.order + 1}</span>
        {question.grading_pending ? (
          <span className="h-1.5 w-6 rounded-full bg-amber-400/75" />
        ) : (
          <span
            className={cn(
              "h-1.5 w-6 rounded-full",
              question.is_correct ? "bg-emerald-500/75" : "bg-destructive/75",
            )}
          />
        )}
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {question.grading_pending ? "—" : `${question.score_awarded}/${question.total_score}`}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <h1 className="text-base font-bold tracking-tight text-foreground sm:justify-self-start">
          答卷详情
        </h1>
        {result.submitted_at ? (
          <span className="text-[14px] text-muted-foreground sm:justify-self-center">
            提交时间：{new Date(result.submitted_at).toLocaleString("zh-CN")}
          </span>
        ) : null}
        <button
          onClick={() => navigate("/exams/students")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:justify-self-end"
        >
          <ArrowLeft size={16} />
          返回考试考生
        </button>
      </div>

      <section className="rounded-2xl border border-border/70 bg-background p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[16px] font-semibold text-foreground">{result.title}</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">以下为该考生的作答记录与评分结果。</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {result.grading_status === "pending_ai" && result.objective_score != null ? (
              <>
                <div className="rounded-2xl bg-muted px-5 py-3 text-right">
                  <p className="text-[12px] text-muted-foreground">客观题得分</p>
                  <p className="text-[16px] font-semibold text-emerald-600">
                    {result.objective_score} / {result.total_score}
                  </p>
                </div>
                <p className="text-[12px] text-amber-600 font-medium">
                  <Brain className="inline h-3.5 w-3.5 mr-1" />
                  主观题正在 AI 评估中
                </p>
              </>
            ) : !result.can_view ? null : (
              <div className="rounded-2xl bg-muted px-5 py-4 text-right">
                <p className="text-[12px] text-muted-foreground">总得分</p>
                <p className="mt-1 text-[16px] font-semibold text-primary">
                  {result.score ?? 0} / {result.total_score}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {!result.can_view ? (
        <div className="rounded-2xl border border-[#ebe3f4] bg-white/90 p-8">
          <p className="text-[14px] text-muted-foreground">{result.blocked_reason ?? "暂无答卷数据"}</p>
        </div>
      ) : (
        <>
          {result.blocked_reason ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {result.blocked_reason}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-foreground">查看模式</h2>
              <p className="text-xs text-muted-foreground">选择逐题查看或全部展开</p>
            </div>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "nav" | "all")}>
              <TabsList>
                <TabsTrigger value="nav">
                  <PanelLeft data-icon="inline-start" className="size-4 shrink-0" />
                  逐题导航
                </TabsTrigger>
                <TabsTrigger value="all">
                  <List data-icon="inline-start" className="size-4 shrink-0" />
                  全部展开
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {viewMode === "nav" ? (
            <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="self-start rounded-2xl border border-border/70 bg-background p-4 lg:sticky lg:top-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">题目导航</h2>
                    <p className="mt-1 text-xs text-muted-foreground">共 {questions.length} 题</p>
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
                      按题型
                    </button>
                    <button
                      type="button"
                      onClick={() => setNavMode("order")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        navMode === "order" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      按顺序
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">全部</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{questions.length}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">答对</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{correctCount}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">答错</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-destructive">{questions.length - correctCount}</p>
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
                  {navMode === "type"
                    ? groupedQuestions.map(([type, items]) => (
                        <div key={type} className="flex flex-col gap-2">
                          <div className="flex items-center justify-between px-1">
                            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                              {getStudentQuestionTypeLabel(type, "zh")}
                            </h3>
                            <span className="text-[10px] text-muted-foreground">{items.length} 题</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {items.map(({ question, index }) => renderNavButton(question, index))}
                          </div>
                        </div>
                      ))
                    : (
                        <div className="grid grid-cols-4 gap-2">
                          {questions.map((q, i) => renderNavButton(q, i))}
                        </div>
                      )}
                </div>
              </aside>

              {activeQuestion ? renderQuestionCard(activeQuestion) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-3 text-[13px] text-muted-foreground">
                <span>全部题目展开显示，可收起/展开各题详情</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-[12px]"
                  onClick={allExpanded ? collapseAll : expandAll}
                >
                  {allExpanded ? "全部收起" : "全部展开"}
                </Button>
              </div>
              {questions.map((q) => renderQuestionCard(q, { collapsible: true }))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
