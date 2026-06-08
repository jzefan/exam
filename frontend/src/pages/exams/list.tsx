import { useEffect, useMemo, useState } from "react";
import { useList, useDelete, useUpdate, useGetIdentity, type CrudFilters } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Plus,
  Search,
  Filter,
  Check,
  ChevronsUpDown,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { getEffectiveExamStatus } from "./utils";
import type { ExamStatus, IExam } from "@/types";
import { getErrorMessage } from "./components/exam-form-utils";
import { getExamDeleteDescription } from "@/lib/deletion-copy";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { getUserRole } from "@/types/rbac";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { apiRequest } from "@/pages/grading/api";
import {
  listCourseAssignments,
  listCourseExams,
  listTeacherCourses,
  type TeacherCourseExam,
  type TeacherCourseSummary,
} from "@/pages/courses/api";

type FilterKey = "all" | ExamStatus;
type CategoryKey = "all" | "exam" | "practice";
type ExamListItem = IExam | TeacherCourseExam;

type ExamMockGenerateResponse = {
  exam_id: string;
  generated_question_count: number;
  reused_source_question_count: number;
  reused_bank_question_count: number;
};

function formatDateTime(value: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableApiError(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  try {
    const parsed = JSON.parse(message) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    // apiRequest can throw either plain text or serialized FastAPI error JSON.
  }
  return message || fallback;
}

// 把列表筛选状态保存在 sessionStorage，这样从详情/编辑页返回时能恢复到
// 之前的筛选，而不是回到初始状态（不依赖具体的返回方式）。
const EXAM_LIST_FILTERS_KEY = "exam-list-filters";

type SavedExamListFilters = {
  category?: CategoryKey;
  filter?: FilterKey;
  searchText?: string;
  timeFrom?: string | null;
  timeTo?: string | null;
  mainKPFilter?: SelectedKnowledgePoint | null;
  selectedCourseId?: string | null;
  page?: number;
  pageSize?: number;
};

function loadSavedExamListFilters(): SavedExamListFilters {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.sessionStorage.getItem(EXAM_LIST_FILTERS_KEY) ?? "{}",
    ) as SavedExamListFilters;
  } catch {
    return {};
  }
}

export function ExamList() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  const role = identity ? getUserRole(identity) : "";
  const isTeacherCourseView = role === "teacher";
  const kpFilterLabel = role === "evaluator" ? "主技能点" : "课程";
  const [savedFilters] = useState(loadSavedExamListFilters);
  const [filter, setFilter] = useState<FilterKey>(savedFilters.filter ?? "all");
  const [category, setCategory] = useState<CategoryKey>(savedFilters.category ?? "all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(savedFilters.searchText ?? "");
  const [timeFrom, setTimeFrom] = useState<Date | undefined>(
    savedFilters.timeFrom ? new Date(savedFilters.timeFrom) : undefined,
  );
  const [timeTo, setTimeTo] = useState<Date | undefined>(
    savedFilters.timeTo ? new Date(savedFilters.timeTo) : undefined,
  );
  const [mainKPFilter, setMainKPFilter] = useState<SelectedKnowledgePoint | null>(
    savedFilters.mainKPFilter ?? null,
  );
  const [page, setPage] = useState(savedFilters.page ?? 1);
  const [pageSize, setPageSize] = useState(savedFilters.pageSize ?? 10);
  const [deleteTarget, setDeleteTarget] = useState<ExamListItem | null>(null);
  const [closeTarget, setCloseTarget] = useState<ExamListItem | null>(null);
  const [mockTarget, setMockTarget] = useState<ExamListItem | null>(null);
  const [mockQuestionCount, setMockQuestionCount] = useState("");
  const [mockReuseRate, setMockReuseRate] = useState("80");
  const [mockTitle, setMockTitle] = useState("");
  const [mockSubmitting, setMockSubmitting] = useState(false);
  const [courses, setCourses] = useState<TeacherCourseSummary[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
    savedFilters.selectedCourseId ?? null,
  );
  const [courseItems, setCourseItems] = useState<TeacherCourseExam[]>([]);
  const [courseListLoading, setCourseListLoading] = useState(false);
  const [courseItemsLoading, setCourseItemsLoading] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [courseRefreshToken, setCourseRefreshToken] = useState(0);

  const { mutate: deleteExam } = useDelete();
  const { mutate: updateExam } = useUpdate();
  const { toast } = useToast();

  // 持久化筛选状态，返回列表时恢复（见 loadSavedExamListFilters 注释）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      EXAM_LIST_FILTERS_KEY,
      JSON.stringify({
        category,
        filter,
        searchText,
        timeFrom: timeFrom ? timeFrom.toISOString() : null,
        timeTo: timeTo ? timeTo.toISOString() : null,
        mainKPFilter,
        selectedCourseId,
        page,
        pageSize,
      } satisfies SavedExamListFilters),
    );
  }, [
    category,
    filter,
    searchText,
    timeFrom,
    timeTo,
    mainKPFilter,
    selectedCourseId,
    page,
    pageSize,
  ]);

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
          if (isTeacherCourseView) {
            setCourseRefreshToken((current) => current + 1);
          } else {
            query.refetch();
          }
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
  if (!isTeacherCourseView && mainKPFilter) {
    activeFilters.push({ field: "root_knowledge_point_id", operator: "eq", value: mainKPFilter.id });
  }

  const { query } = useList<IExam>({
    resource: "exams",
    pagination: { currentPage: page, pageSize, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: activeFilters,
    queryOptions: { enabled: Boolean(identity) && !isTeacherCourseView },
  });

  useEffect(() => {
    if (!isTeacherCourseView) {
      setCourses([]);
      setSelectedCourseId(null);
      setCourseItems([]);
      setCourseError(null);
      return;
    }

    let cancelled = false;
    setCourseListLoading(true);
    setCourseError(null);

    listTeacherCourses()
      .then((items) => {
        if (cancelled) return;
        const visibleCourses = items.filter((course) => !course.is_deleted);
        setCourses(visibleCourses);
        setSelectedCourseId((current) => {
          if (current && visibleCourses.some((course) => course.id === current)) {
            return current;
          }
          return visibleCourses[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setCourseError(getErrorMessage(error, "课程列表加载失败，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setCourseListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isTeacherCourseView]);

  useEffect(() => {
    if (!isTeacherCourseView || !selectedCourseId) {
      setCourseItems([]);
      return;
    }

    let cancelled = false;
    setCourseItemsLoading(true);
    setCourseError(null);

    Promise.all([
      listCourseExams(selectedCourseId),
      listCourseAssignments(selectedCourseId),
    ])
      .then(([examItems, assignmentItems]) => {
        if (cancelled) return;
        const merged = [...examItems, ...assignmentItems].sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at).getTime();
          const bTime = new Date(b.created_at || b.updated_at).getTime();
          return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
        });
        setCourseItems(merged);
      })
      .catch((error) => {
        if (cancelled) return;
        setCourseItems([]);
        setCourseError(getErrorMessage(error, "课程下的考试与练习加载失败，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setCourseItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [courseRefreshToken, isTeacherCourseView, selectedCourseId]);

  const exams = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const isLoading = query.isLoading;
  const totalPages = Math.ceil(total / pageSize);
  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );
  const courseFilteredItems = useMemo(() => {
    return courseItems.filter((exam) => {
      if (category !== "all" && exam.category !== category) return false;
      if (filter !== "all" && getEffectiveExamStatus(exam) !== filter) return false;
      const keyword = searchText.trim().toLowerCase();
      if (keyword) {
        const haystack = `${exam.title} ${exam.description ?? ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (timeFrom) {
        const startTime = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
        if (Number.isNaN(startTime) || startTime < timeFrom.getTime()) return false;
      }
      if (timeTo) {
        const end = new Date(timeTo);
        end.setHours(23, 59, 59, 999);
        const startTime = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
        if (Number.isNaN(startTime) || startTime > end.getTime()) return false;
      }
      return true;
    });
  }, [category, courseItems, filter, searchText, timeFrom, timeTo]);
  const displayedExams: ExamListItem[] = isTeacherCourseView ? courseFilteredItems : exams;
  const displayedLoading = isTeacherCourseView
    ? courseListLoading || courseItemsLoading
    : isLoading;
  const displayedTotal = isTeacherCourseView ? courseFilteredItems.length : total;
  const selectedFilterLabel =
    filter === "all"
      ? "所有状态"
      : examStatusOptions.find((option) => option.value === filter)?.label ?? "所有状态";
  const closeTargetLabel = closeTarget?.category === "practice" ? "练习" : "考试";
  const deleteTargetLabel = deleteTarget?.category === "practice" ? "练习" : "考试";
  const closeTargetStatus = closeTarget ? getEffectiveExamStatus(closeTarget) : null;
  const closeTargetStatusLabel =
    closeTargetStatus
      ? examStatusOptions.find((option) => option.value === closeTargetStatus)?.label ?? closeTargetStatus
      : "—";
  const closeTargetNotSubmitted = closeTarget
    ? Math.max(0, closeTarget.total_students - closeTarget.submitted_count)
    : 0;
  const mockQuestionMinimum = mockTarget?.total_questions ?? 0;
  const mockStartDate = mockTarget?.start_time ? new Date(mockTarget.start_time) : null;
  const mockEndDate =
    mockStartDate && Number.isFinite(mockStartDate.getTime())
      ? new Date(mockStartDate.getTime() - 60_000)
      : null;

  const normalizeMockNumber = (value: string, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  };

  const openMockDialog = (exam: ExamListItem) => {
    setMockTarget(exam);
    setMockQuestionCount(String(exam.total_questions));
    setMockReuseRate("80");
    setMockTitle(`${exam.title} - 模拟试卷`);
  };

  const handleGenerateMock = async () => {
    if (!mockTarget) return;
    const questionCount = normalizeMockNumber(
      mockQuestionCount,
      mockQuestionMinimum,
      mockQuestionMinimum,
      500,
    );
    const sourceReuseRate = normalizeMockNumber(mockReuseRate, 80, 0, 100);
    setMockQuestionCount(String(questionCount));
    setMockReuseRate(String(sourceReuseRate));
    setMockSubmitting(true);
    try {
      const result = await apiRequest<ExamMockGenerateResponse>(`/exams/${mockTarget.id}/mock-generate`, {
        method: "POST",
        body: JSON.stringify({
          question_count: questionCount,
          source_reuse_rate: sourceReuseRate,
          title: mockTitle.trim() || undefined,
        }),
      });
      toast({
        title: "模拟试卷已生成",
        description: `复用原题 ${result.reused_source_question_count} 道，题库抽取 ${result.reused_bank_question_count} 道，AI 生成 ${result.generated_question_count} 道。`,
      });
      setMockTarget(null);
      if (isTeacherCourseView) {
        setCourseRefreshToken((current) => current + 1);
      } else {
        query.refetch();
      }
    } catch (error) {
      toast({
        title: "生成失败",
        description: readableApiError(error, "生成模拟试卷失败，请稍后重试。"),
        variant: "destructive",
      });
    } finally {
      setMockSubmitting(false);
    }
  };

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

      <div
        className={cn(
          "mx-auto gap-5",
          isTeacherCourseView
            ? "grid max-w-[1320px] lg:grid-cols-[280px_minmax(0,1fr)]"
            : "max-w-[1200px] space-y-6",
        )}
      >
      {isTeacherCourseView ? (
        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={17} className="text-primary" />
                <h2 className="text-sm font-bold text-foreground">课程</h2>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {courses.length}
              </span>
            </div>

            {courseListLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                暂无课程。创建课程后，这里会按课程组织考试与练习。
              </div>
            ) : (
              <div className="max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
                {courses.map((course) => {
                  const active = course.id === selectedCourseId;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      className={cn(
                        "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                        active
                          ? "border-primary/30 bg-primary/10 text-primary shadow-sm"
                          : "border-transparent hover:border-border/70 hover:bg-muted/60",
                      )}
                      onClick={() => {
                        setSelectedCourseId(course.id);
                        setPage(1);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-bold text-foreground">
                          {course.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                            active
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {course.exam_count + course.assignment_count}
                        </span>
                      </div>
                      {course.display_path && course.display_path !== course.name ? (
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {course.display_path}
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                        <span>考试 {course.exam_count}</span>
                        <span>练习 {course.assignment_count}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      <div className="min-w-0 space-y-6">
      {isTeacherCourseView ? (
        <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-foreground">
                {selectedCourse?.name ?? "选择课程"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {selectedCourse
                  ? `当前课程下共 ${selectedCourse.exam_count} 场考试、${selectedCourse.assignment_count} 个练习`
                  : "请选择左侧课程查看对应考试与练习"}
              </div>
            </div>
            {selectedCourse ? (
              <Button
                variant="outline"
                className="h-9 px-4 text-xs font-semibold"
                onClick={() => navigate(`/courses/${selectedCourse.id}`)}
              >
                查看课程详情
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

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

        {!isTeacherCourseView ? (
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
        ) : null}

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
          {(category !== "all" || filter !== "all" || searchText || timeFrom || timeTo || (!isTeacherCourseView && mainKPFilter)) && (
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
      {courseError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-medium text-destructive">
          {courseError}
        </div>
      ) : displayedLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[100px] rounded-xl bg-muted animate-pulse border border-border/40" />
          ))}
        </div>
      ) : displayedExams.length === 0 ? (
        <ExamCardEmptyState />
      ) : (
        <div className="space-y-4">
          {displayedExams.map((exam) => (
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
              onGenerateMock={
                exam.category === "exam" ? () => openMockDialog(exam) : undefined
              }
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
      {isTeacherCourseView && displayedTotal > 0 ? (
        <div className="pt-1 text-sm text-muted-foreground">
          当前显示 {displayedTotal} 条
        </div>
      ) : null}

      {!isTeacherCourseView && total > 0 && (
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
      </div>

      {/* Mock exam generation */}
      <AlertDialog
        open={!!mockTarget}
        onOpenChange={(open) => {
          if (!open && !mockSubmitting) setMockTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>生成模拟试卷</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p>
                  系统会按原考试的题型比例和知识点分布组卷，优先从题库抽取，不足部分再由 AI 自动生成。
                </p>
                <div className="rounded-xl border bg-muted/40 p-4 text-muted-foreground">
                  <div>原考试题目：{mockQuestionMinimum} 题</div>
                  <div>模拟卷开始时间：不设置，生成后可直接开始</div>
                  <div>
                    模拟卷结束时间：
                    {mockEndDate && mockEndDate.getTime() > Date.now()
                      ? formatDateTime(mockEndDate.toISOString())
                      : "不限制结束时间，生成后可按需调整"}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam-list-mock-title">模拟卷名称</Label>
                  <Input
                    id="exam-list-mock-title"
                    value={mockTitle}
                    maxLength={200}
                    onChange={(event) => setMockTitle(event.target.value)}
                    placeholder={`${mockTarget?.title ?? "考试"} - 模拟试卷`}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="exam-list-mock-question-count">题目数</Label>
                    <Input
                      id="exam-list-mock-question-count"
                      type="number"
                      min={mockQuestionMinimum}
                      max={500}
                      value={mockQuestionCount}
                      onChange={(event) => setMockQuestionCount(event.target.value)}
                      onBlur={() =>
                        setMockQuestionCount(
                          String(
                            normalizeMockNumber(
                              mockQuestionCount,
                              mockQuestionMinimum,
                              mockQuestionMinimum,
                              500,
                            ),
                          ),
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">不能少于原考试的 {mockQuestionMinimum} 题。</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exam-list-mock-reuse-rate">与原考试重复率</Label>
                    <div className="relative">
                      <Input
                        id="exam-list-mock-reuse-rate"
                        type="number"
                        min={0}
                        max={100}
                        value={mockReuseRate}
                        onChange={(event) => setMockReuseRate(event.target.value)}
                        onBlur={() => setMockReuseRate(String(normalizeMockNumber(mockReuseRate, 80, 0, 100)))}
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">默认 80%，其余题目优先从题库抽取。</p>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mockSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={mockSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void handleGenerateMock();
              }}
            >
              {mockSubmitting ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1.5" />
              )}
              生成模拟卷
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
            <AlertDialogTitle>关闭{closeTargetLabel}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p>
                  确定要关闭{closeTargetLabel}「{closeTarget?.title}」吗？关闭后考生将无法进入或继续作答。
                </p>
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-foreground">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">当前状态：</span>
                      <span className="font-medium">{closeTargetStatusLabel}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">考生人数：</span>
                      <span className="font-medium">{closeTarget?.total_students ?? 0} 人</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">已提交：</span>
                      <span className="font-medium">{closeTarget?.submitted_count ?? 0} 人</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">未提交：</span>
                      <span className="font-medium">{closeTargetNotSubmitted} 人</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <span className="text-muted-foreground">进入/作答记录：</span>
                    <span
                      className={cn(
                        "font-medium",
                        closeTarget?.has_student_history ? "text-amber-600" : "text-emerald-600",
                      )}
                    >
                      {closeTarget?.has_student_history ? "已有考生进入或产生作答记录" : "暂无考生进入记录"}
                    </span>
                  </div>
                </div>
                {closeTarget?.has_student_history || closeTargetNotSubmitted > 0 ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-amber-700">
                    关闭会立即中止未完成考生的作答入口，请确认这是主动结束本次{closeTargetLabel}。
                  </p>
                ) : null}
              </div>
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
                      if (isTeacherCourseView) {
                        setCourseRefreshToken((current) => current + 1);
                      } else {
                        query.refetch();
                      }
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
