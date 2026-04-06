import { useRef, useState, useEffect } from "react";
import { useList, useDelete, useUpdate, type CrudFilters } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Trash2,
  Clock,
  Users,
  FileText,
  ClipboardList,
  UserCheck,
  Eye,
  Send,
  Lock,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExamStatusBadge, examStatusOptions } from "./components/ExamStatusBadge";
import type { ExamStatus, IExam } from "@/types";

type FilterKey = "all" | ExamStatus;

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ExamCard({
  exam,
  onView,
  onPublish,
  onClose,
  onDelete,
}: {
  exam: IExam;
  onView: () => void;
  onPublish: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const descRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = descRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [exam.description]);

  const canClose =
    exam.status !== "ongoing" || exam.submitted_count >= exam.total_students;

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-md dark:hover:bg-primary/[0.04]">
      <div className="flex items-start justify-between gap-3">
        {/* Left: status + title + info */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <ExamStatusBadge status={exam.status} />
            <h3 className="text-base font-semibold text-foreground truncate shrink-0 max-w-[50%]">
              {exam.title}
            </h3>
            {exam.description && (
              isTruncated ? (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        ref={descRef}
                        className="text-xs text-muted-foreground truncate max-w-[200px]"
                      >
                        {exam.description}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-sm">
                      <p className="text-sm">{exam.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <span
                  ref={descRef}
                  className="text-xs text-muted-foreground truncate max-w-[200px]"
                >
                  {exam.description}
                </span>
              )
            )}
          </div>

          {/* Info row */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock size={12} className="shrink-0" />
              {formatDateTime(exam.start_time)} ~ {formatDateTime(exam.end_time)}
            </span>
            <span className="flex items-center gap-1">
              <FileText size={12} className="shrink-0" />
              {exam.total_questions} 题 / {exam.total_score} 分
            </span>
            <span className="flex items-center gap-1">
              <Users size={12} className="shrink-0" />
              考生 {exam.total_students} 人
            </span>
            <span className="flex items-center gap-1">
              <UserCheck size={12} className="shrink-0" />
              已交 {exam.submitted_count} 人
            </span>
          </div>
        </div>

        {/* Right: actions + creator */}
        <div className="shrink-0 flex flex-col items-end justify-between self-stretch gap-2">
          <div className="flex items-center gap-1">
            {/* 查看 — all statuses */}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onView}>
              <Eye size={13} className="mr-0.5" />
              查看
            </Button>

            {/* 发布 — draft only */}
            {exam.status === "draft" && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary hover:text-primary" onClick={onPublish}>
                <Send size={13} className="mr-0.5" />
                发布
              </Button>
            )}

            {/* 关闭 — draft(no), upcoming, ongoing(conditional), completed */}
            {(exam.status === "upcoming" || exam.status === "ongoing" || exam.status === "completed") && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!canClose}
                        onClick={onClose}
                      >
                        <Lock size={13} className="mr-0.5" />
                        关闭
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!canClose && (
                    <TooltipContent side="bottom">
                      <p className="text-xs">仍有考生在考试中，无法关闭</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}

            {/* 删除 — draft, upcoming, completed */}
            {(exam.status === "draft" || exam.status === "upcoming" || exam.status === "completed") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 size={13} className="mr-0.5" />
                删除
              </Button>
            )}
          </div>

          <span className="text-xs text-muted-foreground">
            {exam.created_by_name} / {formatDateTime(exam.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <ClipboardList size={36} className="mb-3 opacity-25" />
      <p className="text-sm">暂无考试</p>
    </div>
  );
}

export function ExamList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchText, setSearchText] = useState("");
  const [timeFrom, setTimeFrom] = useState<Date | undefined>(undefined);
  const [timeTo, setTimeTo] = useState<Date | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<IExam | null>(null);
  const [publishTarget, setPublishTarget] = useState<IExam | null>(null);
  const [closeTarget, setCloseTarget] = useState<IExam | null>(null);

  const { mutate: deleteExam } = useDelete();
  const { mutate: updateExam } = useUpdate();

  const changeStatus = (examId: string, status: string) => {
    updateExam(
      { resource: "exams", id: examId, values: { status } },
      { onSuccess: () => query.refetch() },
    );
  };

  const activeFilters: CrudFilters = [];
  if (filter !== "all") activeFilters.push({ field: "status", operator: "eq", value: filter });
  if (searchText.trim()) activeFilters.push({ field: "title", operator: "contains", value: searchText.trim() });
  if (timeFrom) activeFilters.push({ field: "start_time", operator: "gte", value: timeFrom.toISOString() });
  if (timeTo) {
    const end = new Date(timeTo);
    end.setHours(23, 59, 59, 999);
    activeFilters.push({ field: "start_time", operator: "lte", value: end.toISOString() });
  }

  const { query } = useList<IExam>({
    resource: "exams",
    pagination: { currentPage: page, pageSize, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: activeFilters,
  });

  const exams = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const isLoading = query.isLoading;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-foreground tracking-tight">
            考试列表
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理所有考试，创建、编辑和查看考试状态
          </p>
        </div>
        <Button onClick={() => navigate("/exams/create")}>
          <Plus size={16} className="mr-0.5" />
          创建考试
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status dropdown */}
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[100px]"
          value={filter}
          onChange={(e) => { setFilter(e.target.value as FilterKey); setPage(1); }}
        >
          <option value="all">全部状态</option>
          {examStatusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Name search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索考试名称..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
            className="h-8 pl-8 w-[200px] text-sm"
          />
        </div>

        {/* Time range */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>考试时间</span>
          <DatePicker
            value={timeFrom}
            onChange={(d) => { setTimeFrom(d); setPage(1); }}
            placeholder="开始日期"
            className="w-[130px]"
          />
          <span>~</span>
          <DatePicker
            value={timeTo}
            onChange={(d) => { setTimeTo(d); setPage(1); }}
            placeholder="结束日期"
            className="w-[130px]"
          />
        </div>

        {/* Reset */}
        {(filter !== "all" || searchText || timeFrom || timeTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => { setFilter("all"); setSearchText(""); setTimeFrom(undefined); setTimeTo(undefined); setPage(1); }}
          >
            重置
          </Button>
        )}
      </div>

      {/* Exam list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => (
            <ExamCard
              key={exam.id}
              exam={exam}
              onView={() => navigate(`/exams/edit/${exam.id}`)}
              onPublish={() => setPublishTarget(exam)}
              onClose={() => setCloseTarget(exam)}
              onDelete={() => setDeleteTarget(exam)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>每页</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span>条，共 {total} 条</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* Publish confirmation */}
      <AlertDialog
        open={!!publishTarget}
        onOpenChange={(open) => { if (!open) setPublishTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发布考试</AlertDialogTitle>
            <AlertDialogDescription>
              确定要发布考试「{publishTarget?.title}」吗？发布后考试状态将变为"未开始"，考生可以看到该考试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!publishTarget) return;
                changeStatus(publishTarget.id, "upcoming");
                setPublishTarget(null);
              }}
            >
              确认发布
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close confirmation */}
      <AlertDialog
        open={!!closeTarget}
        onOpenChange={(open) => { if (!open) setCloseTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭考试</AlertDialogTitle>
            <AlertDialogDescription>
              确定要关闭考试「{closeTarget?.title}」吗？关闭后考生将无法继续作答。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!closeTarget) return;
                changeStatus(closeTarget.id, "closed");
                setCloseTarget(null);
              }}
            >
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除考试</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除考试「{deleteTarget?.title}」吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                deleteExam(
                  { resource: "exams", id: deleteTarget.id },
                  { onSuccess: () => { setDeleteTarget(null); query.refetch(); } },
                );
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
