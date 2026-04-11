import { useState } from "react";
import { useList, useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Timer,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Target,
  Medal,
  Play,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getEffectiveStudentExamStatus } from "./utils";
import { getStudentDateLocale, getStudentLocale, tStudent } from "./i18n";

type ExamStatus = "upcoming" | "ongoing" | "completed" | "closed";

interface IMyExam {
  id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  start_time: string | null;
  end_time: string | null;
  started_at: string | null;
  duration_minutes: number;
  total_score: number;
  max_switch_count: number;
  notes_template: string | null;
  total_questions: number;
  score: number | null;
  grading_status?: "pending_ai" | "ai_scored" | "reviewed" | null;
  participated: boolean;
  submitted_at: string | null;
}

function formatTimeRange(start: string | null, end: string | null): string {
  const locale = getStudentLocale();
  if (!start) return tStudent("common_time_tbd", undefined, locale);
  const formatPoint = (value: string) =>
    new Date(value).toLocaleString(getStudentDateLocale(locale), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return end ? `${formatPoint(start)} - ${formatPoint(end)}` : formatPoint(start);
}

function formatDateTime(iso: string | null): string {
  const locale = getStudentLocale();
  if (!iso) return tStudent("common_unsubmitted", undefined, locale);
  return new Date(iso).toLocaleString(getStudentDateLocale(locale), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUsedTime(startedAt: string | null, submittedAt: string | null, durationMinutes: number): string {
  const locale = getStudentLocale();
  if (!startedAt || !submittedAt) return "--";
  const diffMinutes = Math.max(
    0,
    Math.round((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );
  const safeMinutes = durationMinutes > 0 ? Math.min(diffMinutes, durationMinutes) : diffMinutes;
  if (safeMinutes < 60) return tStudent("dashboard_minutes", { minutes: safeMinutes }, locale);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return minutes === 0
    ? `${hours} ${tStudent("common_hours_suffix", undefined, locale)}`
    : `${hours} ${tStudent("common_hours_suffix", undefined, locale)} ${minutes} ${tStudent("common_minutes_suffix", undefined, locale)}`;
}

type CompletedFilter = "all" | "graded" | "pending";

export function StudentDashboard() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const { data: identity } = useGetIdentity<{ name: string; role?: string }>();
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>("all");

  const { query } = useList<IMyExam>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "start_time", order: "desc" }],
  });

  const allExams = query.data?.data ?? [];
  const isLoading = query.isLoading;

  const examsWithDerivedStatus = allExams.map((exam) => ({
    ...exam,
    effectiveStatus: getEffectiveStudentExamStatus(exam),
  }));

  const pending = examsWithDerivedStatus
    .filter((e) => e.effectiveStatus === "ongoing" || e.effectiveStatus === "upcoming")
    .sort((a, b) => {
      if (a.effectiveStatus === "ongoing" && b.effectiveStatus !== "ongoing") return -1;
      if (b.effectiveStatus === "ongoing" && a.effectiveStatus !== "ongoing") return 1;
      return new Date(a.start_time ?? "").getTime() - new Date(b.start_time ?? "").getTime();
    });

  const completed = examsWithDerivedStatus.filter(
    (e) => e.effectiveStatus === "completed",
  );
  const completedWithScore = completed.filter(
    (e) => e.score !== null && e.score !== undefined,
  );
  const avgScore =
    completedWithScore.length > 0
      ? Math.round(
          completedWithScore.reduce((sum, e) => sum + (e.score ?? 0), 0) /
            completedWithScore.length,
        )
      : 0;
  const passedCount = completedWithScore.length;
  const userName = identity?.name ?? "同学";
  const pendingCount = pending.length;

  const filteredCompleted =
    completedFilter === "graded"
      ? completed.filter((e) => e.grading_status === "ai_scored" || e.grading_status === "reviewed")
      : completedFilter === "pending"
        ? completed.filter((e) => e.grading_status === "pending_ai")
        : completed;

  const filterTabs: { key: CompletedFilter; label: string }[] = [
    { key: "all", label: tStudent("dashboard_all", undefined, locale) },
    { key: "graded", label: tStudent("dashboard_graded", undefined, locale) },
    { key: "pending", label: tStudent("dashboard_pending_review", undefined, locale) },
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-2">
          <h2 className="text-lg font-black text-foreground tracking-tight">
            {tStudent("dashboard_greeting", { name: userName }, locale)}
          </h2>
          <div className="text-sm text-muted-foreground/65 font-medium">
            <span>
              {pendingCount > 0
                ? tStudent("dashboard_pending_summary", { count: pendingCount }, locale)
                : tStudent("dashboard_empty_summary", undefined, locale)}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <Card className="min-w-[148px] rounded-2xl border border-border/60 bg-background/95 shadow-sm">
            <CardContent className="flex items-center gap-3 px-5 py-4">
              <div className="h-10 w-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary">
                <Target size={18} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tabular-nums text-foreground leading-none">{avgScore}</span>
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">{tStudent("dashboard_avg_score", undefined, locale)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-[148px] rounded-2xl border border-border/60 bg-background/95 shadow-sm">
            <CardContent className="flex items-center gap-3 px-5 py-4">
              <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center text-foreground/80">
                <Medal size={18} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tabular-nums text-foreground leading-none">{passedCount}</span>
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">{tStudent("dashboard_passed_exams", undefined, locale)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold tracking-tight text-muted-foreground/85">{tStudent("dashboard_pending_exams", undefined, locale)}</h3>
              <Button variant="ghost" size="sm" className="font-semibold text-primary/85 hover:bg-primary/5 hover:text-primary" onClick={() => navigate("/my-exams")}>
                {tStudent("dashboard_view_all", undefined, locale)} <ArrowRight size={14} className="ml-1" />
              </Button>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2].map(i => <div key={i} className="h-32 rounded-2xl border border-border/40 bg-muted/60 animate-pulse" />)}
              </div>
            ) : pending.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                <CalendarClock size={32} className="mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground font-medium">{tStudent("dashboard_no_pending_title", undefined, locale)}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pending.slice(0, 2).map((exam) => {
                  const isOngoing = exam.effectiveStatus === "ongoing";
                  return (
                    <div 
                      key={exam.id} 
                      className={cn(
                        "group flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 rounded-2xl border transition-all duration-300",
                        isOngoing 
                          ? "bg-primary/[0.04] border-primary/20 shadow-md shadow-primary/10 hover:border-primary/40" 
                          : "bg-card border-border/50 hover:border-border"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-center gap-3">
                          {isOngoing && <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />}
                          <h4 className="text-base font-bold text-foreground truncate">{exam.title}</h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground/70">
                          <span className="flex items-center gap-1.5"><Clock size={14} className="opacity-50" /> {formatTimeRange(exam.start_time, exam.end_time)}</span>
                          <span className="flex items-center gap-1.5"><Timer size={14} className="opacity-50" /> {tStudent("dashboard_minutes", { minutes: exam.duration_minutes }, locale)}</span>
                        </div>
                      </div>
                      
                      <Button
                        disabled={!isOngoing}
                        onClick={() => navigate(`/my-exams/${exam.id}/take`)}
                        className={cn(
                          "h-10 px-5 rounded-xl font-semibold transition-all active:scale-95",
                          isOngoing ? "shadow-md shadow-primary/15" : "bg-muted text-muted-foreground/50"
                        )}
                      >
                        {isOngoing ? <><Play size={16} className="mr-2 fill-current" /> {tStudent("dashboard_enter_exam", undefined, locale)}</> : tStudent("dashboard_exam_not_started", undefined, locale)}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight text-muted-foreground/85">{tStudent("dashboard_completed_exams", undefined, locale)}</h3>
              <div className="flex bg-muted/50 p-1 rounded-lg">
                {filterTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setCompletedFilter(tab.key)}
                    className={cn(
                      "px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                      completedFilter === tab.key ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="pl-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_exam_name", undefined, locale)}</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_exam_time", undefined, locale)}</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_submit_time", undefined, locale)}</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_duration_used", undefined, locale)}</TableHead>
                    <TableHead className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_final_score", undefined, locale)}</TableHead>
                    <TableHead className="pr-6 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{tStudent("dashboard_action", undefined, locale)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompleted.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">{tStudent("dashboard_no_pending_title", undefined, locale)}</TableCell></TableRow>
                  ) : (
                    filteredCompleted.slice(0, 5).map((exam) => {
                      const hasScore = exam.score !== null;
                      const passed = (exam.score ?? 0) / exam.total_score >= 0.6;
                      const gradingStatus = exam.grading_status ?? "reviewed";
                      return (
                        <TableRow key={exam.id} className="group hover:bg-muted/20 transition-colors">
                          <TableCell className="pl-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:scale-110 transition-transform">
                                <BookOpen size={16} />
                              </div>
                              <span className="font-bold text-foreground/90">{exam.title}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-medium text-muted-foreground">
                            {formatTimeRange(exam.start_time, exam.end_time)}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-muted-foreground">
                            {formatDateTime(exam.submitted_at)}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-muted-foreground">
                            {formatUsedTime(exam.started_at, exam.submitted_at, exam.duration_minutes)}
                          </TableCell>
                          <TableCell className="text-center">
                            {gradingStatus === "pending_ai" ? (
                              <span className="text-xs font-bold text-muted-foreground/60">待AI评分</span>
                            ) : gradingStatus === "ai_scored" ? (
                              <div className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-sm font-black text-secondary-foreground">
                                AI已评分
                              </div>
                            ) : hasScore ? (
                              <div className={cn(
                                "inline-flex items-center gap-1 px-3 py-1 rounded-full font-black text-sm",
                                passed ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                              )}>
                                {exam.score} <span className="text-[10px] opacity-60">/ {exam.total_score}</span>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-muted-foreground/50">{tStudent("dashboard_score_pending", undefined, locale)}</span>
                            )}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="font-bold text-primary"
                              onClick={() => navigate(`/my-exams/${exam.id}/result`)}
                            >
                              {tStudent("dashboard_detail", undefined, locale)}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="group relative overflow-hidden rounded-3xl border border-primary/15 bg-primary/[0.08] p-8 text-foreground shadow-sm">
            <div className="absolute top-0 right-0 h-40 w-40 translate-x-1/4 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl transition-transform duration-700 group-hover:scale-125" />
            <div className="relative z-10 space-y-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-inner">
                <BookOpen size={22} />
              </div>
              <div className="space-y-2">
                <h4 className="text-lg font-black tracking-tight">{locale === "en" ? "Review Tips" : "高效提分秘籍"}</h4>
                <p className="text-sm font-medium leading-relaxed text-muted-foreground">
                  {locale === "en"
                    ? "Spend a few minutes reviewing recent practice and wrong answers before the next exam to get into the flow faster."
                    : "考试前花几分钟回顾近期练习和错题记录，通常能更快进入答题状态，也更容易避免重复失误。"}
                </p>
              </div>
              <Button className="h-10 w-full rounded-xl font-semibold shadow-sm" onClick={() => navigate("/wrong-answers")}>
                {locale === "en" ? "Review wrong answers" : "立即复习错题"}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
