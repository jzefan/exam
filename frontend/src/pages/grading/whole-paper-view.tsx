import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, MessageSquareText, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LatexText, renderLatexInHtml } from "@/components/ui/latex-text";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { dimensionLabel } from "@/lib/dimension-display";
import { apiRequest } from "@/pages/grading/api";
import { getStudentQuestionTypeLabel } from "@/pages/student/i18n";
import {
  getStudentAnswerCodeLanguage,
  inferStudentAnswerLanguage,
  renderAnswerAsCode,
  renderAnswerSummary,
  renderStandardAnswer,
} from "@/pages/student/utils";
import type { IExamResult, IExamResultQuestion, QuestionType } from "@/types";

const OBJECTIVE_TYPES: QuestionType[] = ["choice", "true_false", "fill_in"];

type ManualQuestionScoreResponse = {
  question_id: string;
  total_score: number;
  score_awarded: number;
  is_correct: boolean;
  objective_score: number | null;
  subjective_score: number | null;
  exam_score: number | null;
  grading_status: IExamResult["grading_status"];
  feedback: IExamResultQuestion["feedback"];
};

function isObjective(type: QuestionType) {
  return OBJECTIVE_TYPES.includes(type);
}

/** 选择题：取出正确选项 key 与考生所选 key。 */
function getChoiceKeys(question: IExamResultQuestion) {
  const std = (question.standard_answer ?? {}) as Record<string, unknown>;
  const ans = (question.answer_content ?? {}) as Record<string, unknown>;
  const correctRaw = std.correct;
  const correctKeys = Array.isArray(correctRaw)
    ? correctRaw.map(String)
    : typeof correctRaw === "string"
      ? [correctRaw]
      : [];
  const selectedKeys = Array.isArray(ans.selected) ? ans.selected.map(String) : [];
  return { correctKeys, selectedKeys };
}

/** 题目得分判定：满分 / 部分 / 零分。 */
function scoreState(question: IExamResultQuestion): "full" | "part" | "zero" {
  if (question.is_correct || question.score_awarded >= question.total_score) return "full";
  return question.score_awarded > 0 ? "part" : "zero";
}

const round = (value: number) => Math.round(value * 10) / 10;

export function WholePaperView({
  examId,
  studentId,
  candidateName,
  candidateCode,
  onScoreSaved,
  onPrevCandidate,
  onNextCandidate,
  canPrevCandidate = false,
  canNextCandidate = false,
}: {
  examId: string;
  studentId: string;
  candidateName?: string;
  candidateCode?: string | null;
  onScoreSaved?: () => void;
  onPrevCandidate?: () => void;
  onNextCandidate?: () => void;
  canPrevCandidate?: boolean;
  canNextCandidate?: boolean;
}) {
  const { toast } = useToast();
  const [result, setResult] = useState<IExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [onlySubjective, setOnlySubjective] = useState(true);
  const [navTab, setNavTab] = useState<"objective" | "subjective">("subjective");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setScoreDrafts({});
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

  const questions = result?.questions ?? [];

  // 按题型分组（保留出现顺序），供成绩汇总表与答题卡导航使用
  const groupedByType = useMemo(() => {
    const order: QuestionType[] = [];
    const map = new Map<QuestionType, IExamResultQuestion[]>();
    for (const q of questions) {
      if (!map.has(q.type)) {
        map.set(q.type, []);
        order.push(q.type);
      }
      map.get(q.type)!.push(q);
    }
    return order.map((type) => ({ type, items: map.get(type)! }));
  }, [questions]);

  const summaryRows = groupedByType.map(({ type, items }) => ({
    type,
    should: items.reduce((sum, q) => sum + q.total_score, 0),
    got: items.reduce((sum, q) => sum + q.score_awarded, 0),
  }));
  const totalShould = summaryRows.reduce((sum, row) => sum + row.should, 0);
  const totalGot = summaryRows.reduce((sum, row) => sum + row.got, 0);

  const applyWrongFilter = (items: IExamResultQuestion[]) =>
    onlyWrong ? items.filter((q) => scoreState(q) !== "full") : items;

  const objectiveQuestions = applyWrongFilter(questions.filter((q) => isObjective(q.type)));
  const subjectiveQuestions = applyWrongFilter(questions.filter((q) => !isObjective(q.type)));

  // 点击答题卡导航：必要时取消「仅显示主观题」，滚动到对应题目
  const goToQuestion = (question: IExamResultQuestion) => {
    if (isObjective(question.type) && onlySubjective) setOnlySubjective(false);
    if (onlyWrong && scoreState(question) === "full") setOnlyWrong(false);
    setActiveId(question.question_id);
  };

  useEffect(() => {
    if (!activeId) return;
    const el = contentRef.current?.querySelector(`[data-qid="${activeId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeId, onlySubjective, onlyWrong]);

  const saveScore = async (question: IExamResultQuestion) => {
    const draft = scoreDrafts[question.question_id];
    const nextScore = Number(draft);
    if (!Number.isFinite(nextScore) || nextScore < 0 || nextScore > question.total_score) {
      toast({
        title: "分数不合法",
        description: `请输入 0 到 ${question.total_score} 之间的分数。`,
        variant: "destructive",
      });
      return;
    }
    setSavingQuestionId(question.question_id);
    try {
      const patch = await apiRequest<ManualQuestionScoreResponse>(
        `/exams/${examId}/students/${studentId}/questions/${question.question_id}/score`,
        { method: "PATCH", body: JSON.stringify({ score_awarded: nextScore }) },
      );
      setResult((prev) =>
        prev
          ? {
              ...prev,
              score: patch.exam_score,
              objective_score: patch.objective_score,
              subjective_score: patch.subjective_score,
              grading_status: patch.grading_status,
              questions: prev.questions.map((item) =>
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
            }
          : prev,
      );
      setScoreDrafts((prev) => {
        const next = { ...prev };
        delete next[question.question_id];
        return next;
      });
      toast({ title: "分数已更新", description: `本题得分：${patch.score_awarded} / ${patch.total_score}` });
      onScoreSaved?.();
    } catch (error) {
      toast({
        title: "保存分数失败",
        description: error instanceof Error ? error.message : "请稍后再试",
        variant: "destructive",
      });
    } finally {
      setSavingQuestionId(null);
    }
  };

  const saveComment = async () => {
    setSavingComment(true);
    try {
      const patch = await apiRequest<{ teacher_comment: string | null }>(
        `/exams/${examId}/students/${studentId}/comment`,
        { method: "PATCH", body: JSON.stringify({ comment: commentDraft }) },
      );
      setResult((prev) => (prev ? { ...prev, teacher_comment: patch.teacher_comment } : prev));
      setCommentOpen(false);
      toast({ title: "考试评价已保存" });
    } catch (error) {
      toast({
        title: "保存评价失败",
        description: error instanceof Error ? error.message : "请稍后再试",
        variant: "destructive",
      });
    } finally {
      setSavingComment(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background p-8 text-sm text-muted-foreground">
        加载整卷失败，请重试。
      </div>
    );
  }

  if (!result.can_view) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background p-8 text-sm text-muted-foreground">
        {result.blocked_reason ?? "暂无答卷数据"}
      </div>
    );
  }

  // ————————————————————— 题目渲染 —————————————————————

  const renderStem = (question: IExamResultQuestion) => {
    const content = question.content as { text?: string; description?: string };
    const html =
      typeof content.text === "string" && content.text.trim()
        ? content.text
        : typeof content.description === "string" && content.description.trim()
          ? content.description
          : "";
    if (!html) return null;
    return (
      <div
        className="text-[15px] leading-7 text-foreground/90 [&_p]:m-0 [&_p+*]:mt-2"
        dangerouslySetInnerHTML={{ __html: renderLatexInHtml(html) }}
      />
    );
  };

  const renderScoreTag = (question: IExamResultQuestion) => {
    const state = scoreState(question);
    const chip =
      state === "full"
        ? { cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30", icon: <Check className="size-3" />, label: "正确" }
        : state === "part"
          ? { cls: "bg-orange-50 text-orange-700 dark:bg-orange-950/30", icon: <Check className="size-3" />, label: "部分得分" }
          : { cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/30", icon: <X className="size-3" />, label: "错误" };
    const numCls = state === "full" ? "text-emerald-600" : state === "part" ? "text-orange-600" : "text-rose-600";
    return (
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", chip.cls)}>
          {chip.icon}
          {chip.label}
        </span>
        <span className="text-xs text-muted-foreground">
          得分 <b className={cn("text-lg font-bold", numCls)}>{round(question.score_awarded)}</b> / {question.total_score}
        </span>
      </div>
    );
  };

  const renderChoice = (question: IExamResultQuestion) => {
    const { correctKeys, selectedKeys } = getChoiceKeys(question);
    const options =
      question.options && typeof question.options === "object" ? Object.entries(question.options) : [];
    return (
      <div className="mt-4 flex flex-col gap-2">
        {options.map(([key, value]) => {
          const correct = correctKeys.includes(key);
          const wrong = selectedKeys.includes(key) && !correct;
          return (
            <div
              key={key}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
                correct
                  ? "border-emerald-300/70 bg-emerald-50/70 dark:bg-emerald-950/20"
                  : wrong
                    ? "border-rose-300/70 bg-rose-50/70 dark:bg-rose-950/20"
                    : "border-border/60 bg-muted/20",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  correct
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : wrong
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-border text-muted-foreground",
                )}
              >
                {key}
              </span>
              <span className="flex-1 text-foreground/85">
                <LatexText>{String(value)}</LatexText>
              </span>
              {correct ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="size-3.5" />
                  正确答案
                </span>
              ) : wrong ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-rose-600">
                  <X className="size-3.5" />
                  考生所选
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTrueFalse = (question: IExamResultQuestion) => {
    const std = (question.standard_answer ?? {}) as Record<string, unknown>;
    const ans = (question.answer_content ?? {}) as Record<string, unknown>;
    const correctVal = typeof std.correct === "boolean" ? std.correct : null;
    const studentVal = typeof ans.value === "boolean" ? ans.value : null;
    const rows: Array<[string, boolean]> = [
      ["正确", true],
      ["错误", false],
    ];
    return (
      <div className="mt-4 flex flex-col gap-2">
        {rows.map(([label, val]) => {
          const correct = correctVal === val;
          const wrong = studentVal === val && !correct;
          return (
            <div
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm",
                correct
                  ? "border-emerald-300/70 bg-emerald-50/70 dark:bg-emerald-950/20"
                  : wrong
                    ? "border-rose-300/70 bg-rose-50/70 dark:bg-rose-950/20"
                    : "border-border/60 bg-muted/20",
              )}
            >
              <span className="flex-1 text-foreground/85">{label}</span>
              {correct ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="size-3.5" />
                  正确答案
                </span>
              ) : wrong ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                  <X className="size-3.5" />
                  考生所选
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderFillIn = (question: IExamResultQuestion) => {
    const ans = (question.answer_content ?? {}) as Record<string, unknown>;
    const std = (question.standard_answer ?? {}) as Record<string, unknown>;
    const studentBlanks = Array.isArray(ans.blanks) ? ans.blanks.map(String) : [];
    const correctBlanks = Array.isArray(std.blanks) ? std.blanks.map(String) : [];
    const count = Math.max(studentBlanks.length, correctBlanks.length);
    return (
      <div className="mt-4 flex flex-col gap-2.5">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-16 text-xs text-muted-foreground">第 {i + 1} 空</span>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-3 py-1 text-[13px] font-medium text-primary">
              {studentBlanks[i] ?? "—"}
            </span>
            <span className="text-xs text-muted-foreground">正确</span>
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-3 py-1 text-[13px] font-medium text-emerald-700 dark:bg-emerald-950/30">
              {correctBlanks[i] ?? "—"}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderObjectiveMeta = (question: IExamResultQuestion) => {
    if (question.type === "fill_in") {
      return question.analysis ? (
        <div className="mt-3 rounded-lg bg-muted/30 px-4 py-3 text-[13px] leading-6 text-muted-foreground">
          <span className="font-medium text-foreground/80">解析：</span>
          <span dangerouslySetInnerHTML={{ __html: renderLatexInHtml(question.analysis) }} />
        </div>
      ) : null;
    }
    return (
      <div className="mt-3 rounded-lg bg-muted/30 px-4 py-3 text-[13px] leading-7 text-muted-foreground">
        <div>
          <span className="font-medium text-foreground/80">学生答案：</span>
          <span className="font-medium text-primary">
            <LatexText>{renderAnswerSummary(question.answer_content)}</LatexText>
          </span>
        </div>
        <div>
          <span className="font-medium text-foreground/80">正确答案：</span>
          <span className="font-medium text-emerald-600">
            <LatexText>{renderStandardAnswer(question.standard_answer)}</LatexText>
          </span>
        </div>
        {question.analysis ? (
          <div>
            <span className="font-medium text-foreground/80">解析：</span>
            <span dangerouslySetInnerHTML={{ __html: renderLatexInHtml(question.analysis) }} />
          </div>
        ) : null}
      </div>
    );
  };

  const renderSubjectiveBody = (question: IExamResultQuestion) => {
    const studentCodeLang = getStudentAnswerCodeLanguage(
      question.type,
      question.title,
      question.content,
      question.answer_content,
    );
    const isSql = inferStudentAnswerLanguage(question.title, question.content, question.answer_content) === "sql";
    const studentCode = renderAnswerAsCode(question.answer_content);
    const renderAsCode = (question.type === "code" || Boolean(studentCodeLang) || isSql) && Boolean(studentCode.trim());
    const fb = question.feedback ?? {};
    const draft = scoreDrafts[question.question_id] ?? String(question.score_awarded);
    const changed = Number(draft) !== question.score_awarded;
    const saving = savingQuestionId === question.question_id;

    return (
      <>
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">学生作答</p>
          {renderAsCode ? (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/10 p-3">
              <div className="mb-2 text-xs capitalize text-muted-foreground">{studentCodeLang ?? (isSql ? "sql" : "code")}</div>
              <CodeBlock code={studentCode} language={studentCodeLang ?? (isSql ? "sql" : undefined)} />
            </div>
          ) : (
            <p className="text-sm leading-7 text-foreground/85">
              <LatexText>{renderAnswerSummary(question.answer_content)}</LatexText>
            </p>
          )}
        </div>

        {fb.dimensions?.length || fb.strengths?.length || fb.deductions?.length || fb.suggestions?.length ? (
          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.035] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Sparkles className="size-3.5" />
              </span>
              <span className="text-[13px] font-semibold text-foreground">AI 评分建议</span>
            </div>
            {fb.dimensions?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {fb.dimensions.map((dim) => (
                  <div key={dim.name} className="rounded-lg bg-background px-3 py-2">
                    <div className="flex items-center justify-between text-[13px] font-medium">
                      <span>{dimensionLabel(dim.name)}</span>
                      <span className="text-primary">
                        {dim.score} / {dim.max_score}
                      </span>
                    </div>
                    {dim.comment ? (
                      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                        <LatexText>{dim.comment}</LatexText>
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {fb.strengths?.length ? (
              <ul className="mt-2 list-disc pl-5 text-[13px] leading-6 text-muted-foreground">
                {fb.strengths.map((line) => (
                  <li key={line}>
                    <LatexText>{line}</LatexText>
                  </li>
                ))}
              </ul>
            ) : null}
            {fb.deductions?.length ? (
              <ul className="mt-2 list-disc pl-5 text-[13px] leading-6 text-orange-700 dark:text-orange-300">
                {fb.deductions.map((line) => (
                  <li key={line}>
                    <LatexText>{line}</LatexText>
                  </li>
                ))}
              </ul>
            ) : null}
            {fb.suggestions?.length ? (
              <p className="mt-2 text-[13px] leading-6 text-muted-foreground">建议：{fb.suggestions.join("；")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3 border-t border-dashed border-border pt-4">
          <label className="text-sm text-muted-foreground">本题得分</label>
          <Input
            type="number"
            min={0}
            max={question.total_score}
            step="0.5"
            value={draft}
            disabled={saving}
            onChange={(e) => setScoreDrafts((prev) => ({ ...prev, [question.question_id]: e.target.value }))}
            className="h-9 w-24 text-sm font-semibold"
          />
          <span className="text-sm text-muted-foreground">/ {question.total_score} 分</span>
          <Button size="sm" className="h-9" disabled={!changed || saving} onClick={() => void saveScore(question)}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            保存
          </Button>
        </div>
      </>
    );
  };

  const renderQuestionCard = (question: IExamResultQuestion) => (
    <article
      key={question.question_id}
      data-qid={question.question_id}
      className={cn(
        "scroll-mt-4 rounded-xl border bg-background p-5 shadow-[0_1px_2px_rgba(0,0,0,0.025)] transition-shadow",
        activeId === question.question_id ? "border-primary/50 ring-2 ring-primary/15" : "border-border/70",
      )}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="flex-1">
          <span className="mr-1.5 font-semibold text-muted-foreground">{question.order + 1}.</span>
          {renderStem(question)}
        </div>
        {renderScoreTag(question)}
      </div>
      {question.type === "choice" ? renderChoice(question) : null}
      {question.type === "true_false" ? renderTrueFalse(question) : null}
      {question.type === "fill_in" ? renderFillIn(question) : null}
      {isObjective(question.type) ? renderObjectiveMeta(question) : renderSubjectiveBody(question)}
    </article>
  );

  const renderSection = (title: string, items: IExamResultQuestion[]) => {
    if (items.length === 0) return null;
    const should = items.reduce((sum, q) => sum + q.total_score, 0);
    const got = items.reduce((sum, q) => sum + q.score_awarded, 0);
    return (
      <section className="mt-8 first:mt-0">
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b-2 border-primary/40 pb-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            <span className="text-xs text-muted-foreground">合计 {round(should)} 分</span>
          </div>
          <span className="text-sm text-muted-foreground">
            总得分：<b className="text-base font-bold text-primary">{round(got)}</b>
          </span>
        </div>
        <div className="flex flex-col gap-3">{items.map(renderQuestionCard)}</div>
      </section>
    );
  };

  // ————————————————————— 左栏 —————————————————————

  const studentLabel = candidateName ?? "考生";
  const reviewed = result.grading_status === "reviewed";
  const navGroups = groupedByType.filter(({ type }) =>
    navTab === "objective" ? isObjective(type) : !isObjective(type),
  );

  const renderNavCell = (question: IExamResultQuestion) => {
    const state = scoreState(question);
    const active = activeId === question.question_id;
    return (
      <button
        key={question.question_id}
        type="button"
        onClick={() => goToQuestion(question)}
        className={cn(
          "flex aspect-square items-center justify-center rounded-md text-[13px] font-semibold transition-all",
          state === "full"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30"
            : state === "part"
              ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/30",
          active && "ring-2 ring-primary",
          "hover:brightness-95",
        )}
      >
        {question.order + 1}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏：考生卡 + 答题卡 + 题目导航 */}
      <aside className="flex w-[288px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/70 bg-muted/15 p-4">
        {/* 考生卡 */}
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-background p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          {reviewed ? (
            <div className="absolute -right-8 top-3 rotate-45 bg-emerald-500 px-9 py-0.5 text-[11px] font-semibold tracking-wide text-white shadow-sm">
              已评阅
            </div>
          ) : null}
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-xl font-semibold text-primary ring-1 ring-inset ring-primary/15">
              {(studentLabel[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-[13px]">
              <div className="flex gap-2">
                <span className="text-muted-foreground">姓名</span>
                <span className="font-semibold text-foreground/90">{studentLabel}</span>
              </div>
              {candidateCode ? (
                <div className="flex gap-2">
                  <span className="text-muted-foreground">学号</span>
                  <span className="break-all font-semibold text-foreground/90">{candidateCode}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-border pt-3">
            <span className="text-[13px] text-muted-foreground">成绩</span>
            <span className="text-2xl font-bold leading-none tracking-tight text-primary">
              {round(result.score ?? totalGot)}
              <span className="ml-1 text-[13px] font-medium text-muted-foreground">/ {result.total_score} 分</span>
            </span>
          </div>

          {/* 上一个 / 下一个考生 */}
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1"
              disabled={!canPrevCandidate}
              onClick={() => onPrevCandidate?.()}
            >
              <ChevronLeft className="size-3.5" />
              上一个
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1"
              disabled={!canNextCandidate}
              onClick={() => onNextCandidate?.()}
            >
              下一个
              <ChevronRight className="size-3.5" />
            </Button>
          </div>

          {/* 考试评价 */}
          <Popover
            open={commentOpen}
            onOpenChange={(open) => {
              setCommentOpen(open);
              if (open) setCommentDraft(result.teacher_comment ?? "");
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="mt-3 h-8 w-full justify-start text-muted-foreground">
                <MessageSquareText className="size-3.5" />
                {result.teacher_comment ? "编辑考试评价" : "添加考试评价"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" sideOffset={10} className="w-80 p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">考试评价</p>
              <Textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="对该考生本次考试的整体评价…"
                rows={5}
                maxLength={2000}
                className="resize-none text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={savingComment} onClick={() => setCommentOpen(false)}>
                  取消
                </Button>
                <Button size="sm" disabled={savingComment} onClick={() => void saveComment()}>
                  {savingComment ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  保存
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {result.teacher_comment ? (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {result.teacher_comment}
            </p>
          ) : null}
        </div>

        {/* 答题卡过滤 */}
        <div className="rounded-xl border border-border/70 bg-background p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <h3 className="mb-3 text-sm font-semibold">答题卡</h3>
          <label className="mb-3 flex items-center justify-between text-[13px] text-foreground/85">
            仅显示错题
            <Switch checked={onlyWrong} onCheckedChange={setOnlyWrong} />
          </label>
          <label className="flex items-center justify-between text-[13px] text-foreground/85">
            仅显示主观题
            <Switch checked={onlySubjective} onCheckedChange={setOnlySubjective} />
          </label>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              正确
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-orange-500" />
              部分得分
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-rose-500" />
              错误
            </span>
          </div>
        </div>

        {/* 题目导航 */}
        <div className="rounded-xl border border-border/70 bg-background p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <div className="mb-3 flex gap-1.5">
            {(
              [
                { key: "objective", label: "客观题" },
                { key: "subjective", label: "主观题" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setNavTab(key)}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-semibold transition-colors",
                  navTab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {navGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无题目</p>
            ) : (
              navGroups.map(({ type, items }) => (
                <div key={type}>
                  <p className="mb-2 text-xs text-muted-foreground">{getStudentQuestionTypeLabel(type, "zh")}</p>
                  <div className="grid grid-cols-6 gap-1.5">{items.map(renderNavCell)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* 右栏：成绩汇总 + 题目区 */}
      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-5 pb-20">
        <div className="mx-auto max-w-[940px]">
          {/* 成绩汇总表 */}
          <div className="overflow-hidden rounded-xl border border-border/70">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-foreground/80">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">题型</th>
                  {summaryRows.map((row) => (
                    <th key={row.type} className="px-4 py-3 text-center font-semibold">
                      {getStudentQuestionTypeLabel(row.type, "zh")}
                    </th>
                  ))}
                  <th className="bg-primary/[0.04] px-4 py-3 text-center font-bold">总分</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/60">
                  <td className="px-4 py-3 text-left text-muted-foreground">应得分</td>
                  {summaryRows.map((row) => (
                    <td key={row.type} className="px-4 py-3 text-center">
                      {round(row.should)}
                    </td>
                  ))}
                  <td className="bg-primary/[0.04] px-4 py-3 text-center font-bold">{round(totalShould)}</td>
                </tr>
                <tr className="border-t border-border/60">
                  <td className="px-4 py-3 text-left text-muted-foreground">实得分</td>
                  {summaryRows.map((row) => (
                    <td
                      key={row.type}
                      className={cn(
                        "px-4 py-3 text-center font-medium",
                        row.got >= row.should ? "text-emerald-600" : row.got > 0 ? "text-orange-600" : "text-muted-foreground",
                      )}
                    >
                      {round(row.got)}
                    </td>
                  ))}
                  <td
                    className={cn(
                      "bg-primary/[0.04] px-4 py-3 text-center font-bold",
                      totalGot >= totalShould ? "text-emerald-600" : "text-orange-600",
                    )}
                  >
                    {round(totalGot)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 题目区 */}
          <div className="mt-6">
            {!onlySubjective ? renderSection("客观题", objectiveQuestions) : null}
            {renderSection("主观题", subjectiveQuestions)}
          </div>
        </div>
      </div>
    </div>
  );
}
