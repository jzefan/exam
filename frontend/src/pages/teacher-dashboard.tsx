import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, FileCheck2, FileUp, Plus, RefreshCw, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IcpRecordLink } from "@/components/icp-record-link";
import { listTeacherCourses, type TeacherCourseSummary } from "@/pages/courses/api";
import { apiRequest, type GradingInboxResponse } from "@/pages/grading/api";
import { readRecentGradingTask, recentGradingTaskHref } from "@/pages/grading/recent-task";

type PendingExam = {
  id: string | null;
  label: string;
  pending: number;
  updatedAt: string;
};

type CourseQuickAction = "generate" | "importQuestions" | "importPaper";

const quickActionLabels: Record<CourseQuickAction, string> = {
  generate: "智能出题",
  importQuestions: "导入题目",
  importPaper: "导入试卷",
};

function TeacherQuickAction({
  title,
  description,
  icon,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/55 hover:bg-primary/[0.015] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card disabled:hover:shadow-none sm:gap-4 sm:p-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

export function TeacherDashboard({ name }: { name: string }) {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<TeacherCourseSummary[]>([]);
  const [inbox, setInbox] = useState<GradingInboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [courseError, setCourseError] = useState(false);
  const [inboxError, setInboxError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [recentTask] = useState(readRecentGradingTask);
  const [courseQuickAction, setCourseQuickAction] = useState<CourseQuickAction | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      listTeacherCourses(),
      apiRequest<GradingInboxResponse>("/grading/inbox"),
    ]).then(([courseResult, inboxResult]) => {
      if (!active) return;
      if (courseResult.status === "fulfilled") setCourses(courseResult.value);
      if (inboxResult.status === "fulfilled") setInbox(inboxResult.value);
      setCourseError(courseResult.status === "rejected");
      setInboxError(inboxResult.status === "rejected");
      setLoading(false);
    });
    return () => { active = false; };
  }, [reloadKey]);

  const pendingExams: PendingExam[] = (inbox?.exams ?? [])
    .map((exam) => ({
      id: exam.exam_id,
      label: exam.exam_label,
      pending: exam.pending_submission_count,
      updatedAt: exam.questions.reduce(
        (latest, question) => question.latest_updated_at > latest ? question.latest_updated_at : latest,
        exam.exam_date ?? "",
      ),
    }))
    .filter((exam) => exam.pending > 0)
    .sort((a, b) => b.pending - a.pending || b.updatedAt.localeCompare(a.updatedAt));
  const totalPending = pendingExams.reduce((sum, exam) => sum + exam.pending, 0);
  const recentCourses = courses
    .filter((course) => !course.is_deleted)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  const writableCourses = courses.filter((course) => !course.is_deleted && course.can_write);
  const openCourseQuickAction = (action: CourseQuickAction) => {
    if (writableCourses.length === 0) {
      navigate("/courses", { state: { create: true } });
      return;
    }
    setCourseQuickAction(action);
  };
  const selectQuickActionCourse = (course: TeacherCourseSummary) => {
    const action = courseQuickAction;
    setCourseQuickAction(null);
    if (action === "generate") {
      navigate(`/courses/${course.id}/question-skills`);
    } else if (action === "importQuestions") {
      navigate("/questions/import", {
        state: {
          backTo: `/courses/${course.id}?tab=questions`,
          backLabel: "返回课程详情",
          successTo: `/courses/${course.id}?tab=questions`,
          courseKpId: course.id,
          courseName: course.name,
        },
      });
    } else if (action === "importPaper") {
      navigate("/papers/import", {
        state: {
          backTo: `/courses/${course.id}?tab=papers`,
          backLabel: "返回课程详情",
          successTo: `/courses/${course.id}?tab=papers`,
          courseOrigin: true,
          rootKnowledgePointId: course.id,
          rootKnowledgePointName: course.name,
        },
      });
    }
  };
  const summary = [
    !loading && !inboxError && inbox !== null ? `${totalPending} 份待阅` : null,
    !loading && !courseError ? `${courses.filter((course) => !course.is_deleted).length} 门课程` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] w-full min-w-0 flex-col gap-7 md:min-h-[calc(100dvh-6.5rem)]">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">{name}，待阅答卷与最近课程都在这里。</p>
        </div>
        {summary && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {summary}
          </span>
        )}
      </header>

      {(courseError || inboxError) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
          <span>部分内容加载失败，已显示可用内容。</span>
          <Button variant="ghost" size="sm" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        </div>
      )}

      {recentTask && (
        <button
          type="button"
          onClick={() => navigate(recentGradingTaskHref(recentTask))}
          className="flex min-h-14 w-full min-w-0 max-w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-border bg-card px-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileCheck2 size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">继续上次阅卷</span>
            <span className="block truncate text-xs text-muted-foreground">{recentTask.title}</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      <section aria-labelledby="teacher-actions-heading" className="min-w-0">
        <h2 id="teacher-actions-heading" className="mb-3 text-base font-semibold text-foreground">快捷操作</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TeacherQuickAction
            title="创建课程"
            description="搭建知识树、管理资料与发布测试"
            icon={<Plus size={18} />}
            onClick={() => navigate("/courses", { state: { create: true } })}
          />
          <TeacherQuickAction
            title="智能出题"
            description="基于课程资料与知识点 AI 出题"
            icon={<Sparkles size={18} />}
            disabled={loading || courseError}
            onClick={() => openCourseQuickAction("generate")}
          />
          <TeacherQuickAction
            title="导入题目"
            description="智能解析 Word/PDF 试题并入库"
            icon={<Upload size={18} />}
            disabled={loading || courseError}
            onClick={() => openCourseQuickAction("importQuestions")}
          />
          <TeacherQuickAction
            title="导入试卷"
            description="解析历史整卷并还原结构"
            icon={<FileUp size={18} />}
            disabled={loading || courseError}
            onClick={() => openCourseQuickAction("importPaper")}
          />
        </div>
      </section>

      <Dialog open={courseQuickAction !== null} onOpenChange={(open) => { if (!open) setCourseQuickAction(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-lg p-5">
          <DialogHeader>
            <DialogTitle>选择课程</DialogTitle>
            <DialogDescription>{courseQuickAction ? `选择要${quickActionLabels[courseQuickAction]}的课程` : ""}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(55vh,360px)] overflow-y-auto rounded-md border border-border">
            {writableCourses.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => selectQuickActionCourse(course)}
                className="flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 border-b border-border/70 px-3 text-left text-sm last:border-b-0 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <BookOpen size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{course.name}</span>
                <ArrowRight size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <section className="min-w-0" aria-labelledby="teacher-pending-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="teacher-pending-heading" className="text-sm font-semibold text-foreground">待阅卷</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/grading?mode=candidate")}>
              查看全部 <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading && !inbox ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">正在加载阅卷任务…</p>
            ) : inboxError && !inbox ? (
              <p role="alert" className="px-4 py-5 text-sm text-muted-foreground">阅卷任务加载失败，请重试。</p>
            ) : pendingExams.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">目前没有待阅答卷。</p>
            ) : pendingExams.slice(0, 6).map((exam) => (
              <button
                key={exam.id ?? exam.label}
                type="button"
                onClick={() => navigate(exam.id ? `/grading?examId=${encodeURIComponent(exam.id)}&mode=candidate` : "/grading?mode=candidate")}
                className="flex min-h-16 w-full cursor-pointer items-center gap-3 border-b border-border/70 px-4 text-left transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <FileCheck2 size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{exam.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{exam.pending} 份待阅</span>
                <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="teacher-recent-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="teacher-recent-heading" className="text-sm font-semibold text-foreground">最近课程</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/courses")}>
              查看全部 <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading && courses.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">正在加载课程…</p>
            ) : courseError && courses.length === 0 ? (
              <p role="alert" className="px-4 py-5 text-sm text-muted-foreground">课程加载失败，请重试。</p>
            ) : recentCourses.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">暂无课程。</p>
            ) : recentCourses.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => navigate(`/courses/${course.id}`)}
                className="flex min-h-16 w-full cursor-pointer items-center gap-3 border-b border-border/70 px-4 text-left transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <BookOpen size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{course.name}</span>
                  <span className="block text-xs text-muted-foreground">{course.exam_count} 场考试 · {course.assignment_count} 项练习</span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="mt-auto flex justify-center pt-6" aria-label="网站备案信息">
        <IcpRecordLink />
      </footer>
    </div>
  );
}
