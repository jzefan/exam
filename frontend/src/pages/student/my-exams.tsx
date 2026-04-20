import { useState, useEffect } from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  ChevronRight,
  Calendar,
  Award,
  CheckCircle2,
  BookOpen,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { getEffectiveStudentExamStatus } from "./utils";
import { getStudentDateLocale, getStudentLocale, tStudent } from "./i18n";
import { StudentPendingExamCard } from "./components/student-pending-exam-card";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ExamStatus = "upcoming" | "ongoing" | "completed" | "closed";
type TabKey = "pending" | "completed";

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
  created_by_name?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDateShort(iso: string | null): string {
  const locale = getStudentLocale();
  if (!iso) return tStudent("common_tbd", undefined, locale);
  return new Date(iso).toLocaleString(getStudentDateLocale(locale), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useRelativeTime(iso: string | null): string {
  const locale = getStudentLocale();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = setInterval(updateNow, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!iso || now === null) return "";
  const target = new Date(iso).getTime();
  const diff = target - now;

  if (diff < 0) return tStudent("my_exams_started", undefined, locale);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return tStudent("my_exams_minutes_later", { count: minutes }, locale);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tStudent("my_exams_hours_later", { count: hours }, locale);
  const days = Math.floor(hours / 24);
  return tStudent("my_exams_days_later", { count: days }, locale);
}

function formatTeacherName(name: string | null | undefined): string {
  return name?.trim() ? `发布老师：${name}` : "发布老师：未注明";
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function UpcomingExamRow({ exam, onClick }: { exam: IMyExam; onClick: () => void }) {
  const locale = getStudentLocale();
  const timeUntil = useRelativeTime(exam.start_time);
  return (
    <button 
      onClick={onClick}
      className="group flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/50 px-4 py-3.5 transition-all hover:border-primary/30 hover:bg-primary/[0.01]"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10">
          <Calendar size={20} className="text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-left">
          <h4 className="truncate text-sm font-semibold text-foreground">{exam.title}</h4>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatTeacherName(exam.created_by_name)}</span>
            <span>•</span>
            <span>{tStudent("my_exams_start_time", { time: formatDateShort(exam.start_time) }, locale)}</span>
            <span>•</span>
            <span className="font-semibold text-primary">{timeUntil}</span>
          </p>
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-1 group-hover:text-primary" />
    </button>
  );
}

function CompletedExamRow({ exam, onClick }: { exam: IMyExam; onClick: () => void }) {
  const locale = getStudentLocale();
  const hasScore = exam.score !== null;
  const passed = (exam.score ?? 0) / exam.total_score >= 0.6;
  const gradingStatus = exam.grading_status ?? "reviewed";
  const statusLabel =
    gradingStatus === "pending_ai"
      ? "待AI评分"
      : gradingStatus === "ai_scored"
        ? "AI已评分"
        : hasScore
          ? `${exam.score} / ${exam.total_score}`
          : "已审核确定";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-card/30 px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          passed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {passed ? <CheckCircle2 size={18} /> : <BookOpen size={18} />}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h4 className="truncate text-sm font-semibold text-foreground">{exam.title}</h4>
          <p className="text-[11px] text-muted-foreground">
            {tStudent("my_exams_completed_at", { time: exam.submitted_at ? formatDateShort(exam.submitted_at) : formatDateShort(exam.end_time) }, locale)}
          </p>
        </div>
      </div>
      
        <div className="flex shrink-0 items-center gap-4">
          <div className="min-w-[88px] text-right">
          {hasScore && gradingStatus !== "pending_ai" ? (
            <div className={cn(
              "rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
              gradingStatus === "reviewed"
                ? passed ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                : "bg-secondary text-secondary-foreground"
            )}>
              {statusLabel}
            </div>
          ) : (
            <Badge variant="outline" className="border-muted text-[10px] font-medium text-muted-foreground">{statusLabel}</Badge>
          )}
        </div>
        <span className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors group-hover:text-primary">
          <ChevronRight size={18} />
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function MyExams() {
  const navigate = useNavigate();
  const locale = getStudentLocale();
  const [tab, setTab] = useState<TabKey>("pending");
  const [noticeExam, setNoticeExam] = useState<IMyExam | null>(null);

  const { query } = useList<IMyExam>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 200 },
    sorters: [{ field: "start_time", order: "desc" }],
  });

  const exams = query.data?.data ?? [];
  const isLoading = query.isLoading;

  const examsWithDerivedStatus = exams.map((exam) => ({
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

  const completed = examsWithDerivedStatus
    .filter((e) => e.effectiveStatus === "completed")
    .sort((a, b) => new Date(b.submitted_at || b.end_time || "").getTime() - new Date(a.submitted_at || a.end_time || "").getTime());

  const ongoingExams = pending.filter(e => e.effectiveStatus === "ongoing");
  const upcomingExams = pending.filter(e => e.effectiveStatus === "upcoming");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-lg font-extrabold text-foreground tracking-tight">{tStudent("my_exams_title", undefined, locale)}</h1>
        <p className="text-sm font-medium text-muted-foreground">
          {pending.length > 0
            ? tStudent("my_exams_pending_summary", { count: pending.length }, locale)
            : tStudent("my_exams_empty_summary", undefined, locale)}
        </p>
      </header>

      <div className="flex w-fit rounded-xl bg-muted/50 p-1">
        {[
          { key: "pending" as const, label: tStudent("my_exams_pending_tab", undefined, locale), count: pending.length },
          { key: "completed" as const, label: tStudent("my_exams_completed_tab", undefined, locale), count: completed.length }
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all",
              tab === t.key ? "bg-background text-primary shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-md text-[10px] tabular-nums",
                tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {isLoading ? (
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-40 rounded-2xl bg-muted" />
            <div className="h-16 rounded-xl bg-muted" />
          </div>
        ) : tab === "pending" ? (
          pending.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-border/40 py-16 text-center">
              <Calendar className="mx-auto h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm font-bold text-muted-foreground">{tStudent("my_exams_pending_empty", undefined, locale)}</p>
            </div>
          ) : (
              <div className="flex flex-col gap-6">
              {ongoingExams.map((e) => (
                <StudentPendingExamCard
                  key={e.id}
                  title={e.title}
                  startTime={e.start_time}
                  endTime={e.end_time}
                  durationMinutes={e.duration_minutes}
                  createdByName={e.created_by_name}
                  status="ongoing"
                  actionLabel={tStudent("my_exams_enter_exam", undefined, locale)}
                  onAction={() => setNoticeExam(e)}
                />
              ))}
              {upcomingExams.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{locale === "en" ? "Starting Soon" : "即将开始"}</h3>
                  <div className="flex flex-col gap-2.5">
                    {upcomingExams.map(e => <UpcomingExamRow key={e.id} exam={e} onClick={() => setNoticeExam(e)} />)}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          completed.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-border/40 py-16 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm font-bold text-muted-foreground">{tStudent("my_exams_completed_empty", undefined, locale)}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {completed.map((e) => (
                <CompletedExamRow
                  key={e.id}
                  exam={e}
                  onClick={() => navigate(`/my-exams/${e.id}/result`)}
                />
              ))}
            </div>
          )
        )}
      </div>

      <ExamNoticeDialog
        exam={noticeExam}
        open={noticeExam !== null}
        onConfirm={() => { navigate(`/my-exams/${noticeExam!.id}/take`); setNoticeExam(null); }}
        onCancel={() => setNoticeExam(null)}
      />
    </div>
  );
}

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
  const locale = getStudentLocale();
  return (
    <AlertDialog open={open} onOpenChange={v => !v && onCancel()}>
      <AlertDialogContent className="rounded-3xl border-none shadow-2xl p-0 overflow-hidden">
        <div className="bg-primary p-8 text-primary-foreground relative overflow-hidden">
          <div className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 w-40 h-40 bg-background/10 rounded-full blur-2xl" />
          <AlertDialogHeader className="relative z-10">
            <AlertDialogTitle className="text-lg font-black tracking-tight">{locale === "en" ? "Exam Notes" : "考试须知"}</AlertDialogTitle>
            <AlertDialogDescription className="text-primary-foreground/80 font-medium">
              {locale === "en"
                ? "Please review the rules below before entering the exam."
                : "请在进入考试前仔细阅读以下规则，祝您取得好成绩。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: Timer, label: locale === "en" ? "Duration" : "考试时长", value: `${exam.duration_minutes}m` },
              { icon: FileText, label: locale === "en" ? "Questions" : "题目总数", value: locale === "en" ? `${exam.total_questions}` : `${exam.total_questions}题` },
              { icon: Award, label: locale === "en" ? "Total Score" : "卷面总分", value: locale === "en" ? `${exam.total_score}` : `${exam.total_score}分` }
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-1 p-3 rounded-2xl bg-muted/50 border border-border/50">
                <item.icon size={16} className="text-primary/60" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase">{item.label}</span>
                <span className="text-sm font-black">{item.value}</span>
              </div>
            ))}
          </div>

          {exam.notes_template && (
            <div className="rounded-2xl bg-muted/30 border border-border/40 p-4 text-sm leading-relaxed text-foreground/80 italic">
              <div dangerouslySetInnerHTML={{ __html: exam.notes_template }} />
            </div>
          )}

          <div className="space-y-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{locale === "en" ? "Notes" : "特别提示"}</p>
            <ul className="space-y-2.5">
              {[
                locale === "en" ? "Your current answer is auto-saved every 30 seconds" : "系统将每 30 秒自动保存一次当前答案",
                locale === "en" ? "Exceeding the tab-switch limit will force submission" : "考试期间切屏超过限制将被强制交卷",
                locale === "en" ? "Please keep your camera and network in good condition" : "请确保摄像头及网络环境处于良好状态"
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-3 text-xs font-semibold text-foreground/70">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <AlertDialogFooter className="p-8 pt-0 gap-3">
          <Button variant="ghost" onClick={onCancel} className="flex-1 h-12 rounded-xl font-bold">{locale === "en" ? "Cancel" : "取消"}</Button>
          <AlertDialogAction asChild>
            <Button onClick={onConfirm} className="flex-[2] h-12 rounded-xl font-black shadow-lg shadow-primary/20">{locale === "en" ? "Start Exam" : "开始考试"}</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
