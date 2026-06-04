import { useState } from "react";
import { useList, useDelete, useUpdate, useGetIdentity, type CrudFilters } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Filter,
  Check,
  ChevronsUpDown,
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
import { useToast } from "@/hooks/use-toast";
import { exportExam } from "@/lib/exam-export";
import { cn } from "@/lib/utils";
import { examStatusOptions } from "./components/ExamStatusBadge";
import { ExamCard, ExamCardEmptyState } from "./components/ExamCard";
import type { ExamStatus, IExam } from "@/types";
import { getErrorMessage } from "./components/exam-form-utils";
import { getExamDeleteDescription } from "@/lib/deletion-copy";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { getUserRole } from "@/types/rbac";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { apiRequest } from "@/pages/grading/api";

type FilterKey = "all" | ExamStatus;
type CategoryKey = "all" | "exam" | "practice";

export function ExamList() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  const role = identity ? getUserRole(identity) : "";
  const kpFilterLabel = role === "evaluator" ? "主技能点" : "课程";
  const [filter, setFilter] = useState<FilterKey>("all");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [timeFrom, setTimeFrom] = useState<Date | undefined>(undefined);
  const [timeTo, setTimeTo] = useState<Date | undefined>(undefined);
  const [mainKPFilter, setMainKPFilter] = useState<SelectedKnowledgePoint | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<IExam | null>(null);
  const [closeTarget, setCloseTarget] = useState<IExam | null>(null);

  const { mutate: deleteExam } = useDelete();
  const { mutate: updateExam } = useUpdate();
  const { toast } = useToast();

  const handleExportExam = async (
    examId: string,
    format: "docx" | "pdf",
    answers: boolean,
  ) => {
    try {
      await exportExam(examId, { format, answers });
    } catch (error) {
      toast({
        title: "导出失败",
        description: getErrorMessage(error, "请稍后重试"),
        variant: "destructive",
      });
    }
  };

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
  if (category !== "all") activeFilters.push({ field: "category", operator: "eq", value: category });
  if (filter !== "all") activeFilters.push({ field: "status", operator: "eq", value: filter });
  if (searchText.trim()) activeFilters.push({ field: "title", operator: "contains", value: searchText.trim() });
  if (timeFrom) activeFilters.push({ field: "start_time", operator: "gte", value: timeFrom.toISOString() });
  if (timeTo) {
    const end = new Date(timeTo);
    end.setHours(23, 59, 59, 999);
    activeFilters.push({ field: "start_time", operator: "lte", value: end.toISOString() });
  }
  if (mainKPFilter) activeFilters.push({ field: "root_knowledge_point_id", operator: "eq", value: mainKPFilter.id });

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
  const closeTargetLabel = closeTarget?.category === "practice" ? "练习" : "考试";
  const deleteTargetLabel = deleteTarget?.category === "practice" ? "练习" : "考试";

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title="考试与练习"
        description="统一管理考试与练习的发布、参与和进度状态"
        actions={
          <>
            <Button variant="outline" className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/exams/practice/create")}>
              <Plus size={16} className="mr-1.5" />
              发布练习
            </Button>
            <Button className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/exams/create")}>
              <Plus size={16} className="mr-1.5" />
              创建考试
            </Button>
          </>
        }
      />

      <div className="max-w-[1200px] mx-auto space-y-6">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/5">
        {/* Left: category tabs */}
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-background p-1">
          {[
            { value: "all", label: "全部" },
            { value: "exam", label: "考试" },
            { value: "practice", label: "练习" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn(
                "h-8 rounded-md px-3 text-xs font-semibold transition-colors",
                category === item.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              onClick={() => {
                setCategory(item.value as CategoryKey);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <KnowledgePointSelector
          fetcher={apiRequest}
          selectedKnowledgePoints={mainKPFilter ? [mainKPFilter] : []}
          onSelectedKnowledgePointsChange={(points) => {
            setMainKPFilter(points[points.length - 1] ?? null);
            setPage(1);
          }}
          label=""
          storageKey="exam-list-main-kp-filter"
          triggerLabel={kpFilterLabel}
          selectionTarget="root"
          selectionMode="single"
          showUsageShortcuts={false}
          popoverSide="bottom"
          hideSelectedBadges
          className="w-[140px]"
        />

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

        {/* Search — grows to fill remaining space */}
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            placeholder={category === "practice" ? "搜索练习..." : "搜索考试 / 练习..."}
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
            className="h-9 w-full pl-9 text-xs font-medium border-border/60 focus-visible:ring-primary/20"
          />
        </div>

        {/* Dates pushed to the right */}
        <div className="flex items-center gap-2 ml-auto">
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
          {(category !== "all" || filter !== "all" || searchText || timeFrom || timeTo || mainKPFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
              onClick={() => { setCategory("all"); setFilter("all"); setSearchText(""); setTimeFrom(undefined); setTimeTo(undefined); setMainKPFilter(null); setPage(1); }}
            >
              清除筛选
            </Button>
          )}
        </div>
      </div>

      {/* Exam list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[100px] rounded-xl bg-muted animate-pulse border border-border/40" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <ExamCardEmptyState />
      ) : (
        <div className="space-y-4">
          {exams.map((exam) => (
            <ExamCard
              key={exam.id}
              exam={exam}
              onView={() => navigate(`/exams/${exam.id}/view`)}
              onEdit={() =>
                navigate(
                  exam.category === "practice"
                    ? `/exams/practice/edit/${exam.id}`
                    : `/exams/edit/${exam.id}`,
                )
              }
              onAnalysis={() => navigate(`/exams/${exam.id}/analysis`)}
              onClose={() => setCloseTarget(exam)}
              onDelete={() => setDeleteTarget(exam)}
              onExport={
                exam.category === "exam"
                  ? (format, answers) =>
                      handleExportExam(exam.id, format, answers)
                  : undefined
              }
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
            <AlertDialogTitle>关闭{closeTargetLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              确定要关闭{closeTargetLabel}「{closeTarget?.title}」吗？关闭后学生将无法继续作答。
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
            <AlertDialogTitle>删除{deleteTargetLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {getExamDeleteDescription(deleteTargetLabel, deleteTarget?.title)}
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
                        description: `${target.category === "practice" ? "练习" : "考试"}「${target.title}」已删除。`,
                      });
                    },
                    onError: (error) => {
                      toast({
                        title: "删除失败",
                        description: getErrorMessage(error, "删除记录失败，请稍后重试。"),
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
    </div>
  );
}
