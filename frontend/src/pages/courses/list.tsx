import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardList,
  FileText,
  LibraryBig,
  ListChecks,
  LoaderCircle,
  Lock,
  Plus,
  Search,
  Share2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMajorName } from "@/lib/knowledge-display";
import { cn } from "@/lib/utils";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { useToast } from "@/hooks/use-toast";
import {
  deleteTeacherCourse,
  listTeacherCourses,
  type TeacherCourseSummary,
} from "./api";
import { NewCourseDialog } from "./NewCourseDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function CountChip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="font-sans text-[15px] font-semibold lining-nums tabular-nums text-foreground">
        {value}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function CourseCard({
  course,
  onDelete,
}: {
  course: TeacherCourseSummary;
  onDelete?: (course: TeacherCourseSummary) => void;
}) {
  const navigate = useNavigate();
  const showMajorLabel = course.major_name != null;
  const isDeleted = course.is_deleted;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/courses/${course.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(`/courses/${course.id}`);
        }
      }}
      className={cn(
        "group cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-none transition-all hover:-translate-y-0.5 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDeleted && "bg-muted/35 opacity-80 hover:translate-y-0 hover:border-border",
      )}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex min-h-5 items-center gap-2">
          {showMajorLabel ? (
            <span className="truncate text-xs text-muted-foreground">{formatMajorName(course.major_name)}</span>
          ) : null}
          <div className="flex-1" />
          {isDeleted ? (
            <Badge
              variant="outline"
              className="rounded-md border-destructive/25 bg-destructive/5 px-1.5 py-0 text-[11px] font-medium text-destructive"
            >
              已删除
            </Badge>
          ) : null}
          {course.visibility === "platform" && (
            <Badge
              variant="outline"
              className="gap-1 rounded-md border-border bg-muted px-1.5 py-0 text-[11px] font-medium text-muted-foreground"
            >
              <Share2 size={11} />
              共享
            </Badge>
          )}
          {!course.can_write && <Lock size={12} className="text-muted-foreground/70" />}
          {!isDeleted && course.can_write && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-label="删除课程"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(course);
              }}
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-[210px] flex-col p-4 pt-0">
        <h3 className="min-w-0 truncate font-serif text-base font-semibold tracking-tight text-foreground">
          {course.name}
        </h3>
        <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
          {course.description ||
            "这门课程还没有说明，可先维护知识结构、导入资料和题目。"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4">
          <CountChip icon={<FileText size={14} />} label="资料" value={course.material_count} />
          <CountChip icon={<ClipboardList size={14} />} label="考试" value={course.exam_count} />
          <CountChip icon={<ListChecks size={14} />} label="作业" value={course.assignment_count} />
          <CountChip icon={<BookOpen size={14} />} label="题目" value={course.question_count} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          {course.pending_count > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[oklch(0.55_0.09_70)]">
              <span className="size-1.5 rounded-full bg-[oklch(0.55_0.09_70)]" />
              <span className="font-sans font-semibold lining-nums tabular-nums">
                {course.pending_count}
              </span>
              项待处理
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">无待处理</span>
          )}
          <span className="text-[11px] text-muted-foreground/75">
            {isDeleted && course.deleted_at
              ? `删除于 ${formatUpdatedAt(course.deleted_at)}`
              : formatUpdatedAt(course.updated_at)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CourseListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div key={item} className="h-[230px] animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

function CourseListLoading() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
      <LoaderCircle size={16} className="animate-spin" />
      正在加载课程...
    </div>
  );
}

export function CourseListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [courses, setCourses] = useState<TeacherCourseSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [courseToDelete, setCourseToDelete] =
    useState<TeacherCourseSummary | null>(null);
  const [deletingCourse, setDeletingCourse] = useState(false);

  useEffect(() => {
    let ignore = false;
    listTeacherCourses()
      .then((data) => {
        if (!ignore) {
          setCourses(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "课程加载失败");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matched = courses.filter((course) => {
      if (!normalized) return true;
      const haystack = `${course.name} ${course.description ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
    return [...matched].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [courses, query]);

  const activeCourses = filtered.filter((course) => !course.is_deleted);
  const deletedCourses = filtered.filter((course) => course.is_deleted);
  const activeTotal = courses.filter((course) => !course.is_deleted).length;
  const deletedTotal = courses.filter((course) => course.is_deleted).length;
  const totalPending = courses.reduce(
    (total, course) => total + (course.is_deleted ? 0 : course.pending_count),
    0,
  );

  const handleDeleteCourse = async () => {
    if (!courseToDelete) return;
    setDeletingCourse(true);
    try {
      await deleteTeacherCourse(courseToDelete.id);
      const deletedAt = new Date().toISOString();
      setCourses((current) =>
        current.map((course) =>
          course.id === courseToDelete.id
            ? {
                ...course,
                can_write: false,
                deleted_at: deletedAt,
                is_deleted: true,
              }
            : course,
        ),
      );
      toast({
        title: "课程已删除",
        description: `「${courseToDelete.name}」已移入已删除课程，可继续查看但不能操作。`,
      });
      setCourseToDelete(null);
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setDeletingCourse(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title="我的课程"
        description={
          courses.length === 0
            ? "按课程视角组织资料、考试、作业、题目与知识结构。"
            : `正常 ${activeTotal} 门 · 已删除 ${deletedTotal} 门${totalPending > 0 ? ` · ${totalPending} 项待处理` : ""}`
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-[260px] max-w-full">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索课程名称..."
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Button
              className="h-9 w-fit shrink-0 px-4 font-medium"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              新建课程
            </Button>
          </div>
        }
      />

      <NewCourseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(course) => {
          setCourses((current) => [course, ...current.filter((item) => item.id !== course.id)]);
          navigate(`/courses/${course.id}`);
        }}
      />

      <AlertDialog
        open={courseToDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deletingCourse) setCourseToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除课程</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{courseToDelete?.name}
              」？删除后课程会进入已删除区域，只能查看资料、考试、作业、题目和知识结构，不能继续编辑或新增内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCourse}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingCourse}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteCourse();
              }}
            >
              {deletingCourse ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mx-auto w-full max-w-[1240px] space-y-6">
        {loading ? (
          <>
            <CourseListLoading />
            <CourseListSkeleton />
          </>
        ) : null}
        {error && !loading ? (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-5 py-8 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {!loading && !error && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <LibraryBig size={32} className="text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">没有匹配的课程</p>
            <p className="mt-1 text-xs text-muted-foreground/75">试着调整搜索关键词，或新建一门课程开始。</p>
          </div>
        ) : null}
        {!loading && !error && filtered.length > 0 ? (
          <div className="space-y-8">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  正常课程
                </h2>
                <span className="font-sans text-xs font-semibold lining-nums tabular-nums text-muted-foreground">
                  {activeCourses.length}
                </span>
              </div>
              {activeCourses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                  没有匹配的正常课程
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {activeCourses.map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      onDelete={setCourseToDelete}
                    />
                  ))}
                </div>
              )}
            </section>

            {deletedCourses.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    已删除课程
                  </h2>
                  <span className="font-sans text-xs font-semibold lining-nums tabular-nums text-muted-foreground">
                    {deletedCourses.length}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {deletedCourses.map((course) => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
