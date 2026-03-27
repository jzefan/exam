import { useState, useEffect } from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  ArrowRight,
  Timer,
  FileText,
  MonitorOff,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ExamStatus = "upcoming" | "ongoing" | "completed" | "closed";

interface IMyExam {
  id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  total_score: number;
  max_switch_count: number;
  notes_template: string | null;
  total_questions: number;
  score: number | null;
  participated: boolean;
  submitted_at: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDateShort(iso: string | null): string {
  if (!iso) return "待定";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useRelativeTime(iso: string | null): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!iso) return "";
  const target = new Date(iso).getTime();
  const diff = target - now;

  if (diff < 0) return "已开始";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}

/* ------------------------------------------------------------------ */
/*  Live pulse dot for ongoing exams                                   */
/* ------------------------------------------------------------------ */

function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Ongoing exam — hero treatment                                      */
/* ------------------------------------------------------------------ */

function OngoingExamHero({
  exam,
  onClick,
}: {
  exam: IMyExam;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left relative overflow-hidden rounded-2xl border-2 border-emerald-200 dark:border-emerald-900 bg-gradient-to-br from-emerald-50/80 via-background to-background dark:from-emerald-950/30 transition-all hover:border-emerald-300 dark:hover:border-emerald-800 hover:shadow-lg hover:shadow-emerald-500/5"
    >
      {/* Subtle corner accent */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/[0.04] rounded-bl-[80px]" />

      <div className="relative p-6 sm:p-8">
        {/* Status row */}
        <div className="flex items-center gap-2.5 mb-4">
          <PulseDot />
          <span className="text-xs font-semibold tracking-wide uppercase text-emerald-600 dark:text-emerald-400">
            正在进行
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xl sm:text-2xl font-bold text-foreground leading-tight mb-2 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
          {exam.title}
        </h3>

        {exam.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-5 max-w-2xl">
            {exam.description}
          </p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground mb-6">
          <span className="flex items-center gap-1.5">
            <Timer size={14} className="text-emerald-500" />
            {exam.duration_minutes} 分钟
          </span>
          <span className="flex items-center gap-1.5">
            <FileText size={14} className="text-emerald-500" />
            {exam.total_questions} 题 &middot; {exam.total_score} 分
          </span>
          {exam.start_time && (
            <span className="flex items-center gap-1.5">
              <Clock size={14} className="text-emerald-500" />
              {formatDateShort(exam.start_time)} 开始
            </span>
          )}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 group-hover:gap-3 transition-all">
          进入考试
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Upcoming exam — compact timeline row                               */
/* ------------------------------------------------------------------ */

function UpcomingExamRow({
  exam,
  onClick,
}: {
  exam: IMyExam;
  onClick: () => void;
}) {
  const timeUntil = useRelativeTime(exam.start_time);
  const isImminent =
    exam.start_time &&
    new Date(exam.start_time).getTime() - Date.now() < 3600_000;

  return (
    <button
      onClick={onClick}
      className="group w-full text-left flex items-center gap-4 sm:gap-6 py-4 px-4 sm:px-5 rounded-xl border border-transparent hover:border-border hover:bg-card transition-all"
    >
      {/* Time column */}
      <div className="shrink-0 w-20 sm:w-24 text-right">
        {isImminent ? (
          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {timeUntil}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{timeUntil}</span>
        )}
      </div>

      {/* Divider dot */}
      <div className="shrink-0 flex flex-col items-center">
        <div
          className={`w-2.5 h-2.5 rounded-full border-2 ${
            isImminent
              ? "border-amber-400 bg-amber-100 dark:border-amber-500 dark:bg-amber-950"
              : "border-border bg-muted"
          }`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-foreground/80 transition-colors">
          {exam.title}
        </h4>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span>{exam.duration_minutes} 分钟</span>
          <span>{exam.total_questions} 题</span>
          {exam.start_time && (
            <span className="hidden sm:inline">
              {formatDateShort(exam.start_time)}
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight
        size={16}
        className="shrink-0 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors"
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Completed exam — archive row                                       */
/* ------------------------------------------------------------------ */

function CompletedExamRow({ exam }: { exam: IMyExam }) {
  const scorePercent =
    exam.score !== null && exam.total_score > 0
      ? Math.round((exam.score / exam.total_score) * 100)
      : null;

  return (
    <div className="flex items-center gap-4 sm:gap-6 py-3.5 px-4 sm:px-5 rounded-xl transition-colors hover:bg-card/60">
      {/* Date column */}
      <div className="shrink-0 w-20 sm:w-24 text-right">
        <span className="text-xs text-muted-foreground">
          {exam.submitted_at
            ? formatDateShort(exam.submitted_at)
            : formatDateShort(exam.end_time)}
        </span>
      </div>

      {/* Dot */}
      <div className="shrink-0">
        <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm text-foreground/70 truncate">{exam.title}</h4>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span>{exam.duration_minutes} 分钟</span>
          <span>{exam.total_questions} 题</span>
        </div>
      </div>

      {/* Score */}
      {scorePercent !== null ? (
        <div className="shrink-0 flex items-center gap-2.5">
          <div className="text-right">
            <span
              className={`text-lg font-bold tabular-nums ${
                scorePercent >= 60
                  ? "text-foreground"
                  : "text-red-500 dark:text-red-400"
              }`}
            >
              {exam.score}
            </span>
            <span className="text-xs text-muted-foreground ml-0.5">
              /{exam.total_score}
            </span>
          </div>
          {/* Mini bar */}
          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
            <div
              className={`h-full rounded-full transition-all ${
                scorePercent >= 90
                  ? "bg-emerald-500"
                  : scorePercent >= 60
                    ? "bg-foreground/40"
                    : "bg-red-400"
              }`}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
        </div>
      ) : (
        <Badge variant="secondary" className="text-[10px] shrink-0">
          待批阅
        </Badge>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24">
      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <FileText size={20} className="text-muted-foreground/40" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-44 rounded-2xl bg-muted" />
      <div className="h-16 rounded-xl bg-muted" />
      <div className="h-16 rounded-xl bg-muted" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Exam notice dialog                                                 */
/* ------------------------------------------------------------------ */

function ExamNoticeDialog({
  exam,
  open,
  onConfirm,
  onCancel,
}: {
  exam: IMyExam | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!exam) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">
            考试须知
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            即将进入考试
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-5 py-1">
          {/* Exam title */}
          <div>
            <h3 className="font-semibold text-foreground leading-snug">
              {exam.title}
            </h3>
            {exam.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {exam.description}
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/60 px-3.5 py-2.5">
              <p className="text-xs text-muted-foreground mb-0.5">考试时长</p>
              <p className="text-sm font-semibold text-foreground">
                {exam.duration_minutes} 分钟
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-3.5 py-2.5">
              <p className="text-xs text-muted-foreground mb-0.5">题目数量</p>
              <p className="text-sm font-semibold text-foreground">
                {exam.total_questions} 题
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-3.5 py-2.5">
              <p className="text-xs text-muted-foreground mb-0.5">总分</p>
              <p className="text-sm font-semibold text-foreground">
                {exam.total_score} 分
              </p>
            </div>
            {exam.max_switch_count > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5">
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-0.5 flex items-center gap-1">
                  <MonitorOff size={10} />
                  切屏限制
                </p>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  最多 {exam.max_switch_count} 次
                </p>
              </div>
            )}
          </div>

          {/* Custom notes */}
          {exam.notes_template && (
            <div className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground leading-relaxed">
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: exam.notes_template }}
              />
            </div>
          )}

          {/* Reminders */}
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/40" />
              确保网络连接稳定
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/40" />
              考试期间请勿切换窗口
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/40" />
              答案每 30 秒自动保存
            </li>
            <li className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/40" />
              时间结束将自动提交
            </li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>进入考试</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

type TabKey = "pending" | "completed";

export function MyExams() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("pending");
  const [noticeExam, setNoticeExam] = useState<IMyExam | null>(null);

  const { query } = useList<IMyExam>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 200 },
    sorters: [{ field: "start_time", order: "desc" }],
  });

  const exams = query.data?.data ?? [];
  const isLoading = query.isLoading;

  // Split by participation: "participated" === submitted
  const pending = exams
    .filter((e) => !e.participated && e.status !== "closed")
    .sort((a, b) => {
      // ongoing first, then by start_time asc
      if (a.status === "ongoing" && b.status !== "ongoing") return -1;
      if (b.status === "ongoing" && a.status !== "ongoing") return 1;
      const ta = a.start_time ? new Date(a.start_time).getTime() : Infinity;
      const tb = b.start_time ? new Date(b.start_time).getTime() : Infinity;
      return ta - tb;
    });

  const completed = exams
    .filter((e) => e.participated || e.status === "completed" || e.status === "closed")
    .sort((a, b) => {
      const ta = a.submitted_at ?? a.end_time ?? "";
      const tb = b.submitted_at ?? b.end_time ?? "";
      return tb.localeCompare(ta); // newest first
    });

  const ongoingExams = pending.filter((e) => e.status === "ongoing");
  const upcomingExams = pending.filter((e) => e.status !== "ongoing");

  const handleExamClick = (exam: IMyExam) => {
    if (exam.status === "ongoing") {
      setNoticeExam(exam);
    } else {
      // Upcoming — show notice but disable entry
      setNoticeExam(exam);
    }
  };

  const handleConfirmEnter = () => {
    if (noticeExam) {
      navigate(`/my-exams/${noticeExam.id}/take`);
      setNoticeExam(null);
    }
  };

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          我的考试
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} 场考试待完成`
            : "当前没有待参加的考试"}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { key: "pending" as const, label: "未参加", count: pending.length },
          { key: "completed" as const, label: "已参加", count: completed.length },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {t.label}
              {t.count > 0 && (
                <span
                  className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
                    tab === t.key
                      ? t.key === "pending"
                        ? "bg-foreground text-background"
                        : "bg-muted-foreground/20 text-muted-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </span>
            {/* Active indicator */}
            {tab === t.key && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <Skeleton />
      ) : tab === "pending" ? (
        pending.length === 0 ? (
          <EmptyState message="暂无待参加的考试" />
        ) : (
          <div className="space-y-6">
            {/* Ongoing — hero cards */}
            {ongoingExams.length > 0 && (
              <div className="space-y-3">
                {ongoingExams.map((exam) => (
                  <OngoingExamHero
                    key={exam.id}
                    exam={exam}
                    onClick={() => handleExamClick(exam)}
                  />
                ))}
              </div>
            )}

            {/* Upcoming — timeline rows */}
            {upcomingExams.length > 0 && (
              <div>
                {ongoingExams.length > 0 && (
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-4">
                    即将开始
                  </p>
                )}
                <div className="divide-y divide-border/50">
                  {upcomingExams.map((exam) => (
                    <UpcomingExamRow
                      key={exam.id}
                      exam={exam}
                      onClick={() => handleExamClick(exam)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : completed.length === 0 ? (
        <EmptyState message="暂无已参加的考试" />
      ) : (
        <div className="divide-y divide-border/50">
          {completed.map((exam) => (
            <CompletedExamRow key={exam.id} exam={exam} />
          ))}
        </div>
      )}

      {/* Notice dialog */}
      <ExamNoticeDialog
        exam={noticeExam}
        open={noticeExam !== null}
        onConfirm={handleConfirmEnter}
        onCancel={() => setNoticeExam(null)}
      />
    </div>
  );
}
