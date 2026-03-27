import { useState } from "react";
import { useList, useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Timer,
  ArrowRight,
  Trophy,
  CheckCircle2,
  BookOpen,
  CalendarClock,
  Info,
  Lock,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

function formatDate(iso: string | null): string {
  if (!iso) return "待定";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return "时间待定";
  const s = new Date(start);
  const fmt = (d: Date) =>
    d.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const timeStr = end ? `${fmt(s)} - ${fmt(new Date(end))}` : fmt(s);
  const today = new Date();
  if (
    s.getFullYear() === today.getFullYear() &&
    s.getMonth() === today.getMonth() &&
    s.getDate() === today.getDate()
  ) {
    return `今天 ${timeStr}`;
  }
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (
    s.getFullYear() === tomorrow.getFullYear() &&
    s.getMonth() === tomorrow.getMonth() &&
    s.getDate() === tomorrow.getDate()
  ) {
    return `明天 ${timeStr}`;
  }
  const day = s.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  return `${day} ${timeStr}`;
}

type CompletedFilter = "all" | "graded" | "pending";

export function StudentDashboard() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{ name: string; role?: string }>();
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>("all");

  const { query } = useList<IMyExam>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "start_time", order: "desc" }],
  });

  const allExams = query.data?.data ?? [];
  const isLoading = query.isLoading;

  const pending = allExams.filter(
    (e) => e.status === "ongoing" || e.status === "upcoming",
  );
  const completed = allExams.filter(
    (e) => e.status === "completed" || e.status === "closed",
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

  // Filter completed exams
  const filteredCompleted =
    completedFilter === "graded"
      ? completed.filter((e) => e.score !== null)
      : completedFilter === "pending"
        ? completed.filter((e) => e.score === null)
        : completed;

  const filterTabs: { key: CompletedFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "graded", label: "已评分" },
    { key: "pending", label: "待评分" },
  ];

  return (
    <div className="space-y-12">
      {/* ── Welcome Section ── */}
      <section>
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-extrabold text-foreground tracking-tight mb-2">
              欢迎回来，{userName}
            </h2>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-primary" />
              {pendingCount > 0 ? (
                <>
                  有{" "}
                  <span className="text-primary font-bold underline decoration-primary/20 underline-offset-4">
                    {pendingCount}
                  </span>{" "}
                  场考试即将开始，请做好准备。
                </>
              ) : (
                "暂无待参加的考试，可以去复习错题。"
              )}
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-muted/50 border border-border/30 px-6 py-4 rounded-[var(--radius)] flex flex-col items-center shadow-sm">
              <span className="text-2xl font-bold text-foreground">{avgScore}</span>
              <span className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase mt-1">
                平均分
              </span>
            </div>
            <div className="bg-muted/50 border border-border/30 px-6 py-4 rounded-[var(--radius)] flex flex-col items-center shadow-sm">
              <span className="text-2xl font-bold text-foreground">{passedCount}</span>
              <span className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase mt-1">
                已过考试
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Upcoming Exams ── */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-6 bg-primary rounded-full" />
            待参加考试
          </h3>
          <button
            className="text-primary text-sm font-bold hover:opacity-70 transition-opacity"
            onClick={() => navigate("/my-exams")}
          >
            查看全部
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-[var(--radius)] bg-muted animate-pulse" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            <CalendarClock size={32} className="mx-auto mb-3 opacity-30" />
            暂无待参加的考试
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {pending.slice(0, 2).map((exam) => {
              const isOngoing = exam.status === "ongoing";
              return (
                <div
                  key={exam.id}
                  className={`bg-card/70 backdrop-blur border border-border/50 rounded-[var(--radius)] p-8 shadow-sm hover:shadow-lg transition-all duration-300 group ${
                    !isOngoing ? "opacity-90" : ""
                  }`}
                >
                  {/* Enrolled count */}
                  <div className="flex justify-between items-start mb-8">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {exam.total_questions} 题 · {exam.total_score} 分
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="text-xl font-bold text-foreground mb-6 group-hover:text-primary transition-colors leading-snug">
                    {exam.title}
                  </h4>

                  {/* Details */}
                  <div className="space-y-4 mb-10">
                    <div className={`flex items-center gap-3 text-sm ${isOngoing ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                      <Clock size={18} className={isOngoing ? "text-primary" : "text-muted-foreground/40"} />
                      <span className="font-medium">
                        {formatTimeRange(exam.start_time, exam.end_time)}
                      </span>
                    </div>
                    <div className={`flex items-center gap-3 text-sm ${isOngoing ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                      <Timer size={18} className={isOngoing ? "text-primary" : "text-muted-foreground/40"} />
                      <span className="font-medium">
                        考试时长：{exam.duration_minutes} 分钟
                      </span>
                    </div>
                  </div>

                  {/* Action button */}
                  {isOngoing ? (
                    <button
                      className="w-full py-4 bg-primary text-primary-foreground rounded-[var(--radius)] font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      onClick={() => navigate("/my-exams")}
                    >
                      进入考试
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      className="w-full py-4 bg-muted text-muted-foreground/40 rounded-[var(--radius)] font-bold cursor-not-allowed flex items-center justify-center gap-2"
                      disabled
                    >
                      尚未开始
                      <Lock size={16} />
                    </button>
                  )}
                </div>
              );
            })}

            {/* ── Action Card (gradient) ── */}
            <div className="bg-gradient-to-br from-primary to-primary/60 rounded-[var(--radius)] p-8 shadow-xl text-primary-foreground flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-[var(--radius)] flex items-center justify-center mb-6">
                  <BookOpen size={24} />
                </div>
                <h4 className="text-2xl font-bold mb-3 tracking-tight">备考提醒</h4>
                <p className="text-sm text-primary-foreground/90 leading-relaxed mb-8">
                  考前温习错题本，有针对性地巩固薄弱知识点，可以有效提升考试成绩。
                </p>
              </div>
              <button
                className="relative z-10 inline-flex items-center justify-center gap-2 text-primary font-bold bg-white px-6 py-4 rounded-[var(--radius)] hover:bg-white/90 transition-all shadow-lg active:scale-[0.98]"
                onClick={() => navigate("/wrong-answers")}
              >
                去复习错题
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Completed Exams ── */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-6 bg-border rounded-full" />
            已参加考试
          </h3>
          <div className="flex bg-muted p-1 rounded-[var(--radius)]">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                className={`px-6 py-2 text-xs font-bold rounded-[calc(var(--radius)-2px)] transition-colors ${
                  completedFilter === tab.key
                    ? "text-primary bg-card shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setCompletedFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredCompleted.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            <Trophy size={32} className="mx-auto mb-3 opacity-30" />
            暂无已参加的考试
          </div>
        ) : (
          <div className="bg-card rounded-[var(--radius)] overflow-hidden shadow-sm border border-border/50">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 border-b border-border/30">
                  <TableHead className="px-10 py-5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
                    考试名称
                  </TableHead>
                  <TableHead className="px-10 py-5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
                    完成日期
                  </TableHead>
                  <TableHead className="px-10 py-5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase text-center">
                    最终得分
                  </TableHead>
                  <TableHead className="px-10 py-5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase text-right">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/10">
                {filteredCompleted.slice(0, 8).map((exam) => {
                  const hasScore = exam.score !== null && exam.score !== undefined;
                  const scorePercent =
                    hasScore && exam.total_score > 0
                      ? (exam.score ?? 0) / exam.total_score
                      : 0;
                  const passed = scorePercent >= 0.6;

                  return (
                    <TableRow
                      key={exam.id}
                      className="group hover:bg-primary/5 transition-colors"
                    >
                      {/* Exam name with icon */}
                      <TableCell className="px-10 py-6">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-[var(--radius)] flex items-center justify-center group-hover:scale-105 transition-transform ${
                            hasScore && passed
                              ? "bg-primary/5 text-primary"
                              : hasScore
                                ? "bg-destructive/5 text-destructive"
                                : "bg-muted text-muted-foreground"
                          }`}>
                            <BookOpen size={22} />
                          </div>
                          <div>
                            <p className="font-bold text-foreground text-base">{exam.title}</p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Date */}
                      <TableCell className="px-10 py-6 text-sm text-muted-foreground font-medium">
                        {formatDate(exam.submitted_at ?? exam.end_time)}
                      </TableCell>

                      {/* Score */}
                      <TableCell className="px-10 py-6 text-center">
                        {hasScore ? (
                          <div className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full ${
                            passed ? "bg-primary/10" : "bg-muted"
                          }`}>
                            <span className={`text-lg font-extrabold ${
                              passed ? "text-primary" : "text-foreground"
                            }`}>
                              {exam.score}
                            </span>
                            <span className={`text-[10px] font-bold ${
                              passed ? "text-primary/60" : "text-muted-foreground"
                            }`}>
                              / {exam.total_score}
                            </span>
                          </div>
                        ) : (
                          <span className="px-4 py-1.5 bg-muted text-muted-foreground text-xs font-bold rounded-full">
                            评分中...
                          </span>
                        )}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="px-10 py-6 text-right">
                        {hasScore ? (
                          <button
                            className="text-primary text-sm font-bold hover:underline underline-offset-4 inline-flex items-center gap-2 ml-auto"
                            onClick={() => navigate("/my-exams")}
                          >
                            查看详情
                            <ArrowRight size={16} />
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30 text-sm font-bold">
                            暂无权限
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Info Banner ── */}
      <div className="flex items-center gap-4 bg-muted/50 border border-border/30 rounded-[var(--radius)] p-5 shadow-sm">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Info size={16} className="text-primary" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          提示：部分考试详情可见性受限，具体查看权限由该考试的管理员设定。如有疑问请联系教务处。
        </p>
      </div>
    </div>
  );
}
