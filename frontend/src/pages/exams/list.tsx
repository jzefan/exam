import { useState } from "react";
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
  Lock,
  Search,
  Filter,
  Check,
  ChevronsUpDown,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ExamStatusBadge, examStatusOptions } from "./components/ExamStatusBadge";
import { getEffectiveExamStatus } from "./utils";
import type { ExamStatus, IExam } from "@/types";
import { getErrorMessage } from "./components/exam-form-utils";

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
  onAnalysis,
  onClose,
  onDelete,
}: {
  exam: IExam;
  onView: () => void;
  onAnalysis: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const effectiveStatus = getEffectiveExamStatus(exam);
  const canClose =
    effectiveStatus !== "ongoing" || exam.submitted_count >= exam.total_students;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-0 transition-all hover:border-primary/20 hover:shadow-xl hover:shadow-primary/[0.03]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-5">
        {/* Main Info */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-foreground tracking-tight truncate">
              {exam.title}
            </h3>
            <ExamStatusBadge status={effectiveStatus} />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80">
              <Clock size={14} className="text-muted-foreground/40" />
              <span>{formatDateTime(exam.start_time)} — {formatDateTime(exam.end_time)}</span>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <FileText size={14} className="text-muted-foreground/40" />
                <span>{exam.total_questions} 题目 / {exam.total_score} 分</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <Users size={14} className="text-muted-foreground/40" />
                <span>考生 {exam.total_students} 人</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <UserCheck size={14} className={cn(exam.submitted_count > 0 ? "text-emerald-500/60" : "text-muted-foreground/40")} />
                <span className={cn(exam.submitted_count > 0 && "text-emerald-600/80")}>已交 {exam.submitted_count} 人</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions Section */}
        <div className="flex items-center gap-1 self-end md:self-center">
          {/* 查看 — all statuses */}
          <Button variant="ghost" size="sm" className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold" onClick={onView}>
            <Eye size={14} />
            <span>查看</span>
          </Button>

          <Button variant="ghost" size="sm" className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold" onClick={onAnalysis}>
            <BarChart3 size={14} />
            <span>结果分析</span>
          </Button>

          {/* 关闭 — draft(no), upcoming, ongoing(conditional), completed */}
          {(effectiveStatus === "upcoming" || effectiveStatus === "ongoing" || effectiveStatus === "completed") && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                      disabled={!canClose}
                      onClick={onClose}
                    >
                      <Lock size={14} />
                      <span>关闭</span>
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
          {(effectiveStatus === "draft" || effectiveStatus === "upcoming" || effectiveStatus === "completed") && (
            <Button
              variant="ghost"
              size="sm"
              className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              <span>删除</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border/40 bg-muted/5">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <ClipboardList size={32} className="text-muted-foreground/30" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">暂无考试记录</p>
      <p className="text-xs text-muted-foreground/60 mt-1">点击右上角按钮创建你的第一场考试</p>
    </div>
  );
}

export function ExamList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [timeFrom, setTimeFrom] = useState<Date | undefined>(undefined);
  const [timeTo, setTimeTo] = useState<Date | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<IExam | null>(null);
  const [closeTarget, setCloseTarget] = useState<IExam | null>(null);

  const { mutate: deleteExam } = useDelete();
  const { mutate: updateExam } = useUpdate();
  const { toast } = useToast();

  const changeStatus = (examId: string, status: string, title?: string) => {
    const successTitle = status === "closed" ? "关闭成功" : "状态更新成功";
    const successDescription =
      status === "closed"
        ? `考试「${title ?? "未命名考试"}」已关闭。`
        : `考试「${title ?? "未命名考试"}」状态已更新。`;
    updateExam(
      { resource: "exams", id: examId, values: { status } },
      {
        onSuccess: () => {
          query.refetch();
          toast({
            title: successTitle,
            description: successDescription,
          });
        },
        onError: (error) => {
          toast({
            title: status === "closed" ? "关闭失败" : "状态更新失败",
            description: getErrorMessage(error, "操作失败，请稍后重试。"),
            variant: "destructive",
          });
        },
      },
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
  const selectedFilterLabel =
    filter === "all"
      ? "所有状态"
      : examStatusOptions.find((option) => option.value === filter)?.label ?? "所有状态";

  return (
    <div className="space-y-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            考试管理
          </h1>
          <p className="text-sm text-muted-foreground">
            规划、发布并实时监控全校考试进度与阅卷状态
          </p>
        </div>
        <Button className="h-9 w-fit shrink-0 px-4 font-medium self-start sm:self-auto" onClick={() => navigate("/exams/create")}>
          <Plus size={16} className="mr-1.5" />
          创建考试
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/5">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground/60 ml-1" />
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                className="h-9 w-[140px] justify-between border-border/60 bg-background px-3 text-xs font-semibold hover:bg-background"
              >
                <span>{selectedFilterLabel}</span>
                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[140px] p-0" align="start">
              <Command>
                <CommandInput placeholder="搜索状态..." className="h-9 text-xs" />
                <CommandList>
                  <CommandEmpty>没有匹配的状态</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="所有状态"
                      onSelect={() => {
                        setFilter("all");
                        setPage(1);
                        setFilterOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", filter === "all" ? "opacity-100" : "opacity-0")} />
                      所有状态
                    </CommandItem>
                    {examStatusOptions.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.label}
                        onSelect={() => {
                          setFilter(option.value);
                          setPage(1);
                          setFilterOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            filter === option.value ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {option.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            placeholder="搜索考试..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
            className="h-9 pl-9 w-[240px] text-xs font-medium border-border/60 focus-visible:ring-primary/20"
          />
        </div>

        <div className="h-4 w-px bg-border/60 mx-1 hidden md:block" />

        <div className="flex items-center gap-2">
          <DatePicker
            value={timeFrom}
            onChange={(d) => { setTimeFrom(d); setPage(1); }}
            placeholder="起始日期"
            className="h-9 w-[130px] text-xs font-medium"
          />
          <span className="text-muted-foreground/40 text-xs">至</span>
          <DatePicker
            value={timeTo}
            onChange={(d) => { setTimeTo(d); setPage(1); }}
            placeholder="截止日期"
            className="h-9 w-[130px] text-xs font-medium"
          />
        </div>

        {(filter !== "all" || searchText || timeFrom || timeTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
            onClick={() => { setFilter("all"); setSearchText(""); setTimeFrom(undefined); setTimeTo(undefined); setPage(1); }}
          >
            清除筛选
          </Button>
        )}
      </div>

      {/* Exam list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[100px] rounded-xl bg-muted animate-pulse border border-border/40" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {exams.map((exam) => (
            <ExamCard
              key={exam.id}
              exam={exam}
              onView={() => navigate(`/exams/edit/${exam.id}`)}
              onAnalysis={() => navigate(`/exams/${exam.id}/analysis`)}
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
                const target = closeTarget;
                setCloseTarget(null);
                changeStatus(target.id, "closed", target.title);
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
                const target = deleteTarget;
                setDeleteTarget(null);
                deleteExam(
                  { resource: "exams", id: target.id },
                  {
                    onSuccess: () => {
                      query.refetch();
                      toast({
                        title: "删除成功",
                        description: `考试「${target.title}」已删除。`,
                      });
                    },
                    onError: (error) => {
                      toast({
                        title: "删除失败",
                        description: getErrorMessage(error, "删除考试失败，请稍后重试。"),
                        variant: "destructive",
                      });
                    },
                  },
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
