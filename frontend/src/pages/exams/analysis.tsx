import { useMemo, useState } from "react";
import { useOne } from "@refinedev/core";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, CheckCircle2, Download, Loader2, Minus, PieChart, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type AnalysisOverall = {
  total_students: number;
  submitted_count: number;
  graded_count: number;
  average_score: number | null;
  median_score: number | null;
  highest_score: number | null;
  lowest_score: number | null;
  pass_count: number;
  pass_rate: number | null;
  total_score: number;
};

type ScoreBucket = {
  label: string;
  min_percent: number;
  max_percent: number;
  count: number;
};

type StudentRow = {
  student_id: string;
  full_name: string | null;
  username: string | null;
  phone?: string | null;
  user_type?: string | null;
  submitted_at: string | null;
  grading_status: string | null;
  objective_score: number | null;
  subjective_score: number | null;
  score: number | null;
  percent: number | null;
};

type QuestionRow = {
  question_id: string;
  order: number;
  title: string | null;
  type: string | null;
  max_score: number;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  average_score: number | null;
  knowledge_point_ids: string[];
};

type KnowledgePointRow = {
  knowledge_point_id: string;
  name: string;
  question_count: number;
  average_correct_rate: number | null;
};

type AnswerRecord = {
  student_id: string;
  question_id: string;
  score_awarded: number;
  is_correct: boolean;
};

type ExamAnalysis = {
  exam_id: string;
  title: string;
  start_time: string | null;
  category: string | null;
  overall: AnalysisOverall;
  score_distribution: ScoreBucket[];
  students: StudentRow[];
  questions: QuestionRow[];
  knowledge_points: KnowledgePointRow[];
  answer_records: AnswerRecord[];
};

/* ── helpers ────────────────────────────────────────── */

const gradingStatusLabels: Record<string, string> = {
  pending_ai: "待 AI 评阅",
  ai_scored: "AI 已评阅",
  reviewed: "已复核",
};

const questionTypeLabels: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const BUCKET_COLORS = [
  "bg-destructive",
  "bg-amber-500",
  "bg-foreground/70",
  "bg-green-600",
  "bg-primary",
] as const;

const BUCKET_RANGES = ["0–59%", "60–69%", "70–79%", "80–89%", "90–100%"];

const formatScore = (value: number | null): string =>
  value === null || value === undefined ? "—" : value.toFixed(1);

const formatPercent = (value: number | null): string =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

const formatDateTime = (value: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const formatGradingStatus = (value: string | null): string =>
  value ? (gradingStatusLabels[value] ?? value) : "—";

const formatQuestionType = (value: string | null): string =>
  value ? (questionTypeLabels[value] ?? value) : "—";

type StudentExportSort = "studentNo" | "score";
type StudentScoreExportCell = string | number;

const getStudentNo = (student: StudentRow): string =>
  (student.username ?? student.phone ?? "").trim();

const compareStudentsByNo = (left: StudentRow, right: StudentRow): number => {
  const leftNo = getStudentNo(left);
  const rightNo = getStudentNo(right);
  if (!leftNo && rightNo) return 1;
  if (leftNo && !rightNo) return -1;
  return leftNo.localeCompare(rightNo, "zh-CN", { numeric: true, sensitivity: "base" });
};

const compareStudentsByScore = (left: StudentRow, right: StudentRow): number => {
  if (left.score === null && right.score !== null) return 1;
  if (left.score !== null && right.score === null) return -1;
  if (left.score !== null && right.score !== null && left.score !== right.score) {
    return right.score - left.score;
  }
  return compareStudentsByNo(left, right);
};

const safeSpreadsheetText = (value: string | number | null | undefined): string => {
  let text = value === null || value === undefined ? "" : String(value);
  // Avoid spreadsheet formula injection for user-entered names/accounts.
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return text;
};

const sanitizeFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "考试";

const getSpreadsheetTextWidth = (value: StudentScoreExportCell): number => {
  const text = String(value);
  return [...text].reduce((width, char) => {
    // CJK characters take roughly two latin columns in spreadsheets.
    return width + (/[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 2 : 1);
  }, 0);
};

function buildStudentScoreRows(
  students: StudentRow[],
  excludedIds: Set<string>,
  sort: StudentExportSort,
): StudentScoreExportCell[][] {
  const sorted = [...students].sort(sort === "studentNo" ? compareStudentsByNo : compareStudentsByScore);
  return [
    ["姓名", "学号/账号", "手机号", "提交时间", "状态", "客观分", "主观分", "总分", "得分率", "是否计入统计"],
    ...sorted.map((student) => [
      safeSpreadsheetText(student.full_name),
      safeSpreadsheetText(getStudentNo(student)),
      safeSpreadsheetText(student.phone),
      formatDateTime(student.submitted_at),
      formatGradingStatus(student.grading_status),
      formatScore(student.objective_score),
      formatScore(student.subjective_score),
      formatScore(student.score),
      student.percent === null ? "" : `${student.percent.toFixed(1)}%`,
      excludedIds.has(student.student_id) ? "否" : "是",
    ]),
  ];
}

function getStudentScoreColumnWidths(rows: StudentScoreExportCell[][]) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxWidth = Math.max(
      8,
      ...rows.map((row) => getSpreadsheetTextWidth(row[columnIndex] ?? "")),
    );
    return { wch: Math.min(Math.max(maxWidth + 2, 10), 32) };
  });
}

function buildSubtitle(startTime: string | null, category: string | null): string | null {
  const parts: string[] = [];
  if (startTime) {
    const d = new Date(startTime);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    }
  }
  if (category === "practice") parts.push("练习");
  else if (category === "exam") parts.push("考试");
  return parts.length ? parts.join(" ") : null;
}

/* ── client-side stat recomputation ─────────────────── */

const BUCKETS: [string, number, number][] = [
  ["不及格", 0, 60],
  ["及格", 60, 70],
  ["中等", 70, 80],
  ["良好", 80, 90],
  ["优秀", 90, 100.0001],
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function recomputeStats(
  students: StudentRow[],
  totalScore: number,
  excludedIds: Set<string>,
  rawQuestions: QuestionRow[],
  answerRecords: AnswerRecord[],
  rawKnowledgePoints: KnowledgePointRow[],
): {
  overall: AnalysisOverall;
  score_distribution: ScoreBucket[];
  questions: QuestionRow[];
  knowledge_points: KnowledgePointRow[];
} {
  const included = students.filter((s) => !excludedIds.has(s.student_id));
  const includedIds = new Set(included.map((s) => s.student_id));
  const submitted = included.filter((s) => s.submitted_at !== null);
  const graded = included.filter((s) => s.score !== null).map((s) => s.score as number);
  const passLine = totalScore * 0.6;
  const passCount = graded.filter((sc) => sc >= passLine).length;

  const overall: AnalysisOverall = {
    total_students: included.length,
    submitted_count: submitted.length,
    graded_count: graded.length,
    average_score: graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null,
    median_score: median(graded),
    highest_score: graded.length ? Math.max(...graded) : null,
    lowest_score: graded.length ? Math.min(...graded) : null,
    pass_count: passCount,
    pass_rate: graded.length ? passCount / graded.length : null,
    total_score: totalScore,
  };

  const score_distribution: ScoreBucket[] = BUCKETS.map(([label, lo, hi]) => ({
    label,
    min_percent: lo,
    max_percent: hi,
    count: graded.filter((sc) => {
      const pct = totalScore > 0 ? (sc / totalScore) * 100 : 0;
      return pct >= lo && pct < hi;
    }).length,
  }));

  // recompute per-question stats from filtered answer records
  const filteredAnswers = answerRecords.filter((a) => includedIds.has(a.student_id));
  const answersByQuestion = new Map<string, AnswerRecord[]>();
  for (const a of filteredAnswers) {
    const list = answersByQuestion.get(a.question_id) ?? [];
    list.push(a);
    answersByQuestion.set(a.question_id, list);
  }

  const questions: QuestionRow[] = rawQuestions.map((q) => {
    const qAnswers = answersByQuestion.get(q.question_id) ?? [];
    const attemptCount = qAnswers.length;
    const correctCount = qAnswers.filter((a) => a.is_correct).length;
    const avgScore = attemptCount
      ? qAnswers.reduce((sum, a) => sum + a.score_awarded, 0) / attemptCount
      : null;
    return {
      ...q,
      attempt_count: attemptCount,
      correct_count: correctCount,
      correct_rate: attemptCount ? correctCount / attemptCount : null,
      average_score: avgScore,
    };
  });

  // recompute knowledge point stats from filtered question stats
  const kpMap = new Map<string, { name: string; rateSum: number; rateN: number; count: number }>();
  for (const kp of rawKnowledgePoints) {
    kpMap.set(kp.knowledge_point_id, { name: kp.name, rateSum: 0, rateN: 0, count: 0 });
  }
  for (const q of questions) {
    for (const kpId of q.knowledge_point_ids) {
      const entry = kpMap.get(kpId);
      if (!entry) continue;
      entry.count += 1;
      if (q.correct_rate !== null) {
        entry.rateSum += q.correct_rate;
        entry.rateN += 1;
      }
    }
  }
  const knowledge_points: KnowledgePointRow[] = [...kpMap.entries()]
    .map(([knowledge_point_id, d]) => ({
      knowledge_point_id,
      name: d.name,
      question_count: d.count,
      average_correct_rate: d.rateN ? d.rateSum / d.rateN : null,
    }))
    .filter((kp) => kp.question_count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { overall, score_distribution, questions, knowledge_points };
}

/* ── sub-components ─────────────────────────────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60">
        <PieChart size={24} className="text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function StatCard({
  eyebrow,
  value,
  unit,
  sub,
  footer,
  tone = "neutral",
}: {
  eyebrow: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const valueColor =
    tone === "good"
      ? "text-green-600"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-amber-600"
          : "text-foreground";

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card px-4 py-4">
      <p className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className={cn("text-[26px] font-semibold leading-none tabular-nums", valueColor)}>
          {value}
        </span>
        {unit ? (
          <span className="text-[16px] font-medium leading-none tabular-nums text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {sub ? (
        <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {sub}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

function DistRow({
  label,
  range,
  count,
  total,
  maxCount,
  highlight,
}: {
  label: string;
  range: string;
  count: number;
  total: number;
  maxCount: number;
  highlight?: boolean;
}) {
  const pct = total > 0 ? count / total : 0;
  const barPct = maxCount > 0 && count > 0 ? Math.max(count / maxCount, 0.02) : 0;

  return (
    <div className="grid grid-cols-[120px_1fr_52px_56px] items-center gap-4 border-t border-border px-1 py-3">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-[13px] font-medium",
            count === 0 ? "text-muted-foreground" : "text-foreground",
            highlight && count > 0 && "font-semibold",
          )}
        >
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{range}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded bg-muted/50">
        {count > 0 && (
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded transition-all",
              highlight ? "bg-destructive" : "bg-foreground/65",
            )}
            style={{ width: `${barPct * 100}%` }}
          />
        )}
      </div>
      <div
        className={cn(
          "text-right text-[15px] font-semibold tabular-nums",
          count === 0 ? "text-muted-foreground/40" : "text-foreground",
        )}
      >
        {count}
      </div>
      <div className="text-right text-[12px] tabular-nums text-muted-foreground">
        {(pct * 100).toFixed(1)}%
      </div>
    </div>
  );
}

/* ── main page ──────────────────────────────────────── */

export function ExamAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // 返回目标：从课程详情进入时带 backTo（课程的考试/练习 tab）；从考试管理进入则回到考试列表。
  const analysisNavState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
  };
  const goBack = () => navigate(analysisNavState.backTo ?? "/exams");
  // 进入学生答卷详情时携带返回信息：返回到本结果分析页，并把本页自己的返回目标
  // （课程 / 考试管理）一并带回，保证「答卷详情 → 结果分析 → 上一级」整条链路正确。
  const resultNavState = {
    backTo: `/exams/${id}/analysis`,
    backLabel: "返回结果分析",
    backState: analysisNavState,
  };
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const { result, query } = useOne<ExamAnalysis>({
    resource: "exams",
    id: id ? `${id}/analysis` : "",
    queryOptions: { enabled: Boolean(id), retry: false },
  });

  // All hooks must be called unconditionally before any early return.
  const { overall, score_distribution, questions, knowledge_points } = useMemo(() => {
    if (!result) {
      return recomputeStats([], 0, excludedIds, [], [], []);
    }
    return recomputeStats(
      result.students,
      result.overall.total_score,
      excludedIds,
      result.questions,
      result.answer_records,
      result.knowledge_points,
    );
  }, [result, excludedIds]);

  if (!id) {
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <EmptyState message="缺少考试 ID" />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">加载分析数据…</span>
      </div>
    );
  }

  if (query.isError || !result) {
    const message =
      (query.error as { response?: { data?: { detail?: string } } } | undefined)?.response?.data
        ?.detail ?? "加载分析数据失败";
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <EmptyState message={message} />
      </div>
    );
  }

  const { title, start_time, category, students } = result;

  const toggleExclude = (studentId: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const exportStudentScores = async (sort: StudentExportSort) => {
    const XLSX = await import("xlsx");
    const rows = buildStudentScoreRows(students, excludedIds, sort);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = getStudentScoreColumnWidths(rows);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "学生成绩");
    XLSX.writeFile(
      workbook,
      `${sanitizeFileName(title)}-学生成绩-${sort === "studentNo" ? "按学号顺序" : "按分数顺序"}.xlsx`,
    );
  };

  const subtitle = buildSubtitle(start_time, category);
  const passLine = (overall.total_score * 0.6).toFixed(0);
  const submitRate = overall.total_students > 0 ? overall.submitted_count / overall.total_students : 0;
  const totalGraded = score_distribution.reduce((a, b) => a + b.count, 0);
  const maxBucketCount = Math.max(1, ...score_distribution.map((b) => b.count));

  /* insight banner */
  let insightTone: "warn" | "good" | "info" = "info";
  let insightStrong = "";
  let insightSub = "";

  if (overall.submitted_count === 0) {
    insightTone = "info";
    insightStrong = "暂无考生提交答卷";
    insightSub = "等待考生提交后可查看分析结果";
  } else if (overall.pass_rate === null || overall.pass_rate === 0) {
    insightTone = "warn";
    insightStrong = `全部 ${overall.submitted_count} 位已提交考生均未达到及格线`;
    insightSub = `最高分 ${formatScore(overall.highest_score)} 距及格线 ${passLine} 分仍有较大差距，建议核对评分标准或考前讲解内容`;
  } else if (overall.pass_rate < 0.5) {
    insightTone = "warn";
    insightStrong = `及格率偏低：${overall.pass_count} / ${overall.submitted_count} 位考生达到及格线`;
    insightSub = `及格率 ${(overall.pass_rate * 100).toFixed(1)}%，建议关注低分考生并复盘教学内容`;
  } else {
    insightTone = "good";
    insightStrong = `${overall.pass_count} / ${overall.submitted_count} 位考生达到及格线`;
    insightSub = `及格率 ${(overall.pass_rate * 100).toFixed(1)}%，整体表现良好`;
  }

  return (
    <div>
      {/* ── page header — full viewport width, flush to top nav ── */}
      <div className="flex w-full items-center gap-3 border-b border-border bg-background px-6 py-2.5">
        <button
          type="button"
          aria-label={analysisNavState.backLabel ?? "返回"}
          title={analysisNavState.backLabel ?? "返回"}
          onClick={goBack}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-border/80 hover:bg-muted/40"
        >
          <ChevronLeft size={15} />
        </button>

        {/* left: title + exam name */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="shrink-0 text-[14px] font-semibold text-foreground">结果分析</h1>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="truncate text-[13px] font-medium text-foreground/75">{title}</span>
          {subtitle ? (
            <>
              <span className="shrink-0 text-muted-foreground/30">—</span>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">{subtitle}</span>
            </>
          ) : null}
        </div>

        {/* right: meta stats */}
        <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
          <span>
            满分{" "}
            <span className="font-medium tabular-nums text-foreground/80">{overall.total_score}</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span>
            及格线{" "}
            <span className="font-medium tabular-nums text-foreground/80">{passLine}</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span>
            已阅卷{" "}
            <span className="font-medium tabular-nums text-foreground/80">{overall.graded_count}</span>
            {" "}/ {overall.submitted_count}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] space-y-4 px-6 py-5">
        {/* ── insight banner ── */}
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3",
            insightTone === "warn"
              ? "border-destructive/20 bg-destructive/6"
              : insightTone === "good"
                ? "border-green-500/20 bg-green-50/60 dark:bg-green-950/20"
                : "border-border bg-muted/30",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
              insightTone === "warn"
                ? "bg-destructive/12 text-destructive"
                : insightTone === "good"
                  ? "bg-green-500/12 text-green-600"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {insightTone === "warn" ? (
              <AlertTriangle size={12} />
            ) : insightTone === "good" ? (
              <CheckCircle2 size={12} />
            ) : (
              <Minus size={12} />
            )}
          </span>
          <div className="text-[13px] leading-relaxed">
            <strong
              className={cn(
                "font-semibold",
                insightTone === "warn"
                  ? "text-destructive"
                  : insightTone === "good"
                    ? "text-green-700 dark:text-green-500"
                    : "text-foreground",
              )}
            >
              {insightStrong}
            </strong>
            {insightSub ? (
              <span className="ml-3 text-muted-foreground">{insightSub}</span>
            ) : null}
          </div>
        </div>

        {/* ── stat cards ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            eyebrow="参考 / 已提交"
            value={String(overall.submitted_count)}
            unit={`/ ${overall.total_students}`}
            sub={
              <>
                <span className="font-medium tabular-nums text-foreground/80">
                  {(submitRate * 100).toFixed(0)}%
                </span>
                <span>提交率 · 已阅卷 {overall.graded_count}</span>
              </>
            }
            footer={
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full bg-foreground/60 transition-all"
                  style={{ width: `${submitRate * 100}%` }}
                />
              </div>
            }
          />

          <StatCard
            eyebrow="平均分"
            value={formatScore(overall.average_score)}
            sub={
              <>
                <span className="inline-flex text-muted-foreground/60">
                  <Minus size={11} />
                </span>
                <span>
                  满分 {overall.total_score} · 得分率{" "}
                  <span className="font-medium tabular-nums text-foreground/80">
                    {overall.average_score !== null
                      ? `${((overall.average_score / overall.total_score) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </span>
              </>
            }
          />

          <StatCard
            eyebrow="中位数"
            value={formatScore(overall.median_score)}
            sub={<span>半数考生低于此分数</span>}
          />

          <StatCard
            eyebrow="最高 / 最低"
            value={formatScore(overall.highest_score)}
            unit={`/ ${formatScore(overall.lowest_score)}`}
            sub={
              <span>
                极差{" "}
                <span className="font-medium tabular-nums text-foreground/80">
                  {overall.highest_score !== null && overall.lowest_score !== null
                    ? (overall.highest_score - overall.lowest_score).toFixed(1)
                    : "—"}
                </span>
              </span>
            }
          />

          <StatCard
            eyebrow="及格率"
            value={
              overall.pass_rate !== null ? `${(overall.pass_rate * 100).toFixed(1)}` : "—"
            }
            unit={overall.pass_rate !== null ? "%" : undefined}
            tone={
              overall.pass_rate === null
                ? "neutral"
                : overall.pass_rate < 0.4
                  ? "bad"
                  : overall.pass_rate < 0.6
                    ? "warn"
                    : "good"
            }
            sub={
              <>
                <span>≥ {passLine} 分</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="tabular-nums">
                  {overall.pass_count} / {overall.submitted_count} 人
                </span>
              </>
            }
          />
        </div>

        {/* ── score distribution ── */}
        <div className="rounded-2xl border border-border bg-card p-6 pb-2">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">分数分布</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                按满分百分比分桶 · 共 {totalGraded} 份已阅卷
              </p>
            </div>

            {/* stacked mini bar */}
            {totalGraded > 0 && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex h-2.5 w-64 overflow-hidden rounded border border-border">
                  {score_distribution.map((b, i) => {
                    const w = totalGraded ? (b.count / totalGraded) * 100 : 0;
                    return w > 0 ? (
                      <div
                        key={b.label}
                        className={BUCKET_COLORS[i]}
                        style={{ width: `${w}%` }}
                        title={`${b.label} ${b.count}`}
                      />
                    ) : null;
                  })}
                </div>
                <div className="flex gap-3">
                  {score_distribution.map((b, i) =>
                    b.count > 0 ? (
                      <span
                        key={b.label}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span className={cn("size-2 rounded-[2px]", BUCKET_COLORS[i])} />
                        {b.label}{" "}
                        <span className="font-medium tabular-nums text-foreground/80">
                          {b.count}
                        </span>
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>

          {/* column headers */}
          <div className="grid grid-cols-[120px_1fr_52px_56px] gap-4 px-1 pb-2.5">
            <span className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
              区间
            </span>
            <span className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
              分布
            </span>
            <span className="text-right text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
              人数
            </span>
            <span className="text-right text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">
              占比
            </span>
          </div>

          {score_distribution.map((b, i) => (
            <DistRow
              key={b.label}
              label={b.label}
              range={BUCKET_RANGES[i] ?? `${b.min_percent}–${b.max_percent}%`}
              count={b.count}
              total={totalGraded}
              maxCount={maxBucketCount}
              highlight={i === 0}
            />
          ))}

          <div className="flex items-center gap-2 border-t border-border px-1 py-3.5 text-[11.5px] text-muted-foreground">
            <span className="inline-flex text-muted-foreground/50">
              <svg
                width="11"
                height="11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="11" x2="12" y2="16" />
                <circle cx="12" cy="8" r=".5" fill="currentColor" />
              </svg>
            </span>
            <span>
              分桶按满分百分比划分：不及格 &lt; 60% · 及格 60–69% · 中等 70–79% · 良好 80–89% · 优秀
              ≥ 90%
            </span>
          </div>
        </div>

        {/* ── student results ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">学生成绩</CardTitle>
                <CardDescription>
                  按总分降序
                  {excludedIds.size > 0 && (
                    <span className="ml-2 text-amber-600 dark:text-amber-500">
                      · 已剔除 {excludedIds.size} 人，不计入统计
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {excludedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setExcludedIds(new Set())}
                    className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    恢复全部
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={students.length === 0}>
                      <Download size={14} />
                      导出
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => void exportStudentScores("studentNo")}>
                      按学号顺序导出
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void exportStudentScores("score")}>
                      按分数顺序导出
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {students.length === 0 ? (
              <EmptyState message="暂无考生" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>学生</TableHead>
                    <TableHead>提交时间</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">客观分</TableHead>
                    <TableHead className="text-right">主观分</TableHead>
                    <TableHead className="text-right">总分</TableHead>
                    <TableHead className="text-right">得分率</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s) => {
                    const excluded = excludedIds.has(s.student_id);
                    return (
                      <TableRow
                        key={s.student_id}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-muted/40",
                          excluded && "opacity-40",
                        )}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/exams/${id}/students/${s.student_id}/result`, { state: resultNavState })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(`/exams/${id}/students/${s.student_id}/result`, { state: resultNavState });
                          }
                        }}
                      >
                        <TableCell>
                          <div className="font-medium">{s.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.username ?? s.phone ?? ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(s.submitted_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatGradingStatus(s.grading_status)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(s.objective_score)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(s.subjective_score)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatScore(s.score)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {s.percent === null ? "—" : `${s.percent.toFixed(1)}%`}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={excluded ? "恢复计入统计" : "剔除出统计"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleExclude(s.student_id);
                                  }}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  className={cn(
                                    "flex size-7 items-center justify-center rounded-md transition-colors",
                                    excluded
                                      ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                      : "text-muted-foreground/40 hover:bg-muted/60 hover:text-muted-foreground",
                                  )}
                                >
                                  <UserX size={14} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                {excluded ? "恢复计入统计" : "剔除出统计"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── question analysis (unchanged) ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">题目分析</CardTitle>
            <CardDescription>正确率与平均得分</CardDescription>
          </CardHeader>
          <CardContent>
            {questions.length === 0 ? (
              <EmptyState message="暂无题目" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>题目</TableHead>
                    <TableHead>题型</TableHead>
                    <TableHead className="text-right">满分</TableHead>
                    <TableHead className="text-right">作答</TableHead>
                    <TableHead className="text-right">正确率</TableHead>
                    <TableHead className="text-right">平均得分</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questions.map((q) => (
                    <TableRow key={q.question_id}>
                      <TableCell className="text-muted-foreground">{q.order + 1}</TableCell>
                      <TableCell className="max-w-md truncate">{q.title ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatQuestionType(q.type)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatScore(q.max_score)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{q.attempt_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(q.correct_rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatScore(q.average_score)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── knowledge points (unchanged) ── */}
        {knowledge_points.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">知识点分析</CardTitle>
              <CardDescription>按平均正确率</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>知识点</TableHead>
                    <TableHead className="text-right">题数</TableHead>
                    <TableHead className="text-right">平均正确率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {knowledge_points.map((kp) => (
                    <TableRow key={kp.knowledge_point_id}>
                      <TableCell>{kp.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{kp.question_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(kp.average_correct_rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
