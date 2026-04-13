import { useEffect, useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import { CalendarClock, CheckCircle2, Clock3, Loader2, Search, UserCheck, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/pages/grading/api";
import { cn } from "@/lib/utils";
import type { IExam, IExamStudent } from "@/types";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPrimaryStudentTime(student: IExamStudent) {
  return student.submitted_at ?? student.started_at ?? null;
}

export function ExamStudentsPage() {
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [students, setStudents] = useState<IExamStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [searchText, setSearchText] = useState("");

  const { query } = useList<IExam>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: "start_time", order: "desc" }],
  });

  const exams = useMemo(() => {
    const items = query.data?.data ?? [];
    return [...items].sort((left, right) => {
      const leftTime = new Date(left.start_time ?? left.created_at).getTime();
      const rightTime = new Date(right.start_time ?? right.created_at).getTime();
      return rightTime - leftTime;
    });
  }, [query.data?.data]);

  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? exams[0] ?? null;

  useEffect(() => {
    if (!selectedExamId && exams[0]) {
      setSelectedExamId(exams[0].id);
    }
  }, [exams, selectedExamId]);

  useEffect(() => {
    if (!selectedExam) {
      setStudents([]);
      return;
    }

    let alive = true;
    setStudentsLoading(true);
    void apiRequest<IExamStudent[]>(`/exams/${selectedExam.id}/students`)
      .then((payload) => {
        if (!alive) return;
        const sorted = [...payload].sort((left, right) => {
          const leftTime = new Date(getPrimaryStudentTime(left) ?? 0).getTime();
          const rightTime = new Date(getPrimaryStudentTime(right) ?? 0).getTime();
          return rightTime - leftTime;
        });
        setStudents(sorted);
      })
      .catch(() => {
        if (!alive) return;
        setStudents([]);
      })
      .finally(() => {
        if (alive) setStudentsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [selectedExam]);

  const filteredStudents = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return students;
    return students.filter((student) =>
      [student.full_name ?? "", student.username ?? ""].join(" ").toLowerCase().includes(keyword),
    );
  }, [searchText, students]);

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="border-border/50 bg-card/95 xl:h-[calc(100vh-10.5rem)]">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-bold">考试考生</CardTitle>
          <p className="text-sm text-muted-foreground">按考试时间由近到远查看每场考试的考生列表。</p>
        </CardHeader>
        <CardContent className="space-y-3 overflow-y-auto exam-students-nav-scroll xl:max-h-[calc(100vh-17rem)]">
          {query.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载考试...
            </div>
          ) : exams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-8 text-sm text-muted-foreground">
              暂无考试记录
            </div>
          ) : (
            <div className="space-y-2">
              {exams.map((exam) => {
                const selected = exam.id === selectedExam?.id;
                return (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => setSelectedExamId(exam.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                      selected
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "border-border/50 bg-background hover:border-border hover:bg-muted/10",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="truncate text-sm font-semibold text-foreground">{exam.title}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>{formatDateTime(exam.start_time)}</span>
                        </div>
                      </div>
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                        {exam.total_students} 人
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/95">
        <CardHeader className="gap-4 pb-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-bold">考生列表</CardTitle>
            <p className="text-sm text-muted-foreground">
              {selectedExam ? `${selectedExam.title} · 共 ${selectedExam.total_students} 人` : "请选择一场考试"}
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索考生姓名或学号"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {!selectedExam ? (
            <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
              暂无可查看的考试
            </div>
          ) : studentsLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载考生列表...
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
              当前考试下暂无匹配的考生
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStudents.map((student) => {
                const submitted = Boolean(student.submitted_at);
                return (
                  <div
                    key={student.student_id}
                    className="grid gap-4 rounded-2xl border border-border/50 bg-background px-4 py-4 md:grid-cols-[minmax(0,1fr)_180px_180px]"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {student.full_name || "未命名考生"}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            submitted
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700",
                          )}
                        >
                          {submitted ? "已提交" : "未提交"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>{student.username || "无学号"}</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>开始时间</span>
                      </div>
                      <div className="font-medium text-foreground">{formatDateTime(student.started_at)}</div>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {submitted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        <span>{submitted ? "提交时间" : "最近状态"}</span>
                      </div>
                      <div className="font-medium text-foreground">
                        {submitted ? formatDateTime(student.submitted_at) : "尚未提交"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
