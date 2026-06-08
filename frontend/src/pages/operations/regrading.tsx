import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

import { OperationsTabs } from "./components/OperationsTabs";

type RoleName = "platform_admin" | "evaluator" | "teacher";
type ExamKind = "exam" | "practice";
type RegradingQuestionType = "fill_in" | "short_answer";

type RegradingAssignee = {
  id: string;
  username: string;
  full_name: string;
  roles: RoleName[];
  exam_count: number;
  practice_count: number;
};

type RegradingExam = {
  id: string;
  title: string;
  kind: ExamKind;
  status: string;
  total_questions: number;
  submitted_count: number;
  start_time?: string | null;
  end_time?: string | null;
};

type RegradingQuestion = {
  question_id: string;
  order: number;
  type: RegradingQuestionType;
  title: string;
  content_preview: string;
  score: number;
  submitted_count: number;
};

type RegradingRunResult = {
  exam_id: string;
  question_id: string;
  question_type: RegradingQuestionType;
  affected_submissions: number;
  updated_latest_answers: number;
  created_grading_tasks: number;
};

const roleLabel: Record<RoleName, string> = {
  platform_admin: "平台管理员",
  evaluator: "评估者",
  teacher: "教师",
};

const examKindLabel: Record<ExamKind, string> = {
  exam: "考试",
  practice: "练习",
};

const questionTypeLabel: Record<RegradingQuestionType, string> = {
  fill_in: "填空题",
  short_answer: "简答题",
};

function extractErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { detail?: string } } })
      .response;
    return response?.data?.detail || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function includesText(value: string | null | undefined, query: string) {
  if (!query.trim()) return true;
  return (value || "").toLowerCase().includes(query.trim().toLowerCase());
}

function countBy<T extends string>(
  items: Array<{ kind?: T; type?: T; roles?: T[] }>,
  key: T,
) {
  return items.filter(
    (item) =>
      item.kind === key || item.type === key || item.roles?.includes(key),
  ).length;
}

function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function ListLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-xs text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function FilterTabs({
  value,
  onValueChange,
  items,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{ value: string; label: string; count: number }>;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList
        className={cn(
          "grid h-8 w-full rounded-lg border border-border bg-muted/40 p-0.5 text-muted-foreground",
          items.length === 4 ? "grid-cols-4" : "grid-cols-3",
        )}
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="h-7 rounded-md px-2 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/60"
          >
            {item.label}{" "}
            <span className="text-muted-foreground">{item.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function ColumnShell({
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  tabs,
}: {
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  children: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col gap-3 border-border bg-background p-4 lg:[&:not(:last-child)]:border-r">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 rounded-lg border-transparent bg-muted/50 pl-9 text-xs shadow-none focus-visible:border-border focus-visible:bg-background"
        />
      </div>
      {tabs}
      <ScrollArea className="min-h-0 flex-1 pr-2">
        <div className="flex flex-col gap-1.5">{children}</div>
      </ScrollArea>
    </section>
  );
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background",
      )}
    >
      {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

function QuestionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
      )}
    >
      {selected ? <CheckCircle2 className="size-3" /> : null}
    </span>
  );
}

function OperationsRegradingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [assignees, setAssignees] = useState<RegradingAssignee[]>([]);
  const [exams, setExams] = useState<RegradingExam[]>([]);
  const [questions, setQuestions] = useState<RegradingQuestion[]>([]);
  const [selectedAssignee, setSelectedAssignee] =
    useState<RegradingAssignee | null>(null);
  const [selectedExam, setSelectedExam] = useState<RegradingExam | null>(null);
  const [selectedQuestion, setSelectedQuestion] =
    useState<RegradingQuestion | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [examQuery, setExamQuery] = useState("");
  const [questionQuery, setQuestionQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | RoleName>("all");
  const [examKindFilter, setExamKindFilter] = useState<"all" | ExamKind>("all");
  const [questionTypeFilter, setQuestionTypeFilter] = useState<
    "all" | RegradingQuestionType
  >("all");
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [loadingExams, setLoadingExams] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegradingRunResult | null>(null);
  const { toast } = useToast();

  const loadAssignees = useCallback(async () => {
    setLoadingAssignees(true);
    setError(null);
    try {
      const { data } = await apiClient.get<RegradingAssignee[]>(
        "/api/operations/regrading/assignees",
      );
      setAssignees(data);
    } catch (caught) {
      setError(extractErrorMessage(caught, "加载评估者失败"));
    } finally {
      setLoadingAssignees(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadAssignees();
    }
  }, [loadAssignees, open]);

  const handleSelectAssignee = async (assignee: RegradingAssignee) => {
    setSelectedAssignee(assignee);
    setSelectedExam(null);
    setSelectedQuestion(null);
    setResult(null);
    setExams([]);
    setQuestions([]);
    setLoadingExams(true);
    setError(null);
    try {
      const { data } = await apiClient.get<RegradingExam[]>(
        `/api/operations/regrading/assignees/${assignee.id}/exams`,
      );
      setExams(data);
    } catch (caught) {
      setError(extractErrorMessage(caught, "加载考试和练习失败"));
    } finally {
      setLoadingExams(false);
    }
  };

  const handleSelectExam = async (exam: RegradingExam) => {
    setSelectedExam(exam);
    setSelectedQuestion(null);
    setResult(null);
    setQuestions([]);
    setLoadingQuestions(true);
    setError(null);
    try {
      const { data } = await apiClient.get<RegradingQuestion[]>(
        `/api/operations/regrading/exams/${exam.id}/questions`,
      );
      setQuestions(data);
    } catch (caught) {
      setError(extractErrorMessage(caught, "加载题目失败"));
    } finally {
      setLoadingQuestions(false);
    }
  };

  const assigneeCounts = useMemo(
    () => ({
      all: assignees.length,
      platform_admin: countBy(assignees, "platform_admin"),
      evaluator: countBy(assignees, "evaluator"),
      teacher: countBy(assignees, "teacher"),
    }),
    [assignees],
  );

  const examCounts = useMemo(
    () => ({
      all: exams.length,
      exam: countBy(exams, "exam"),
      practice: countBy(exams, "practice"),
    }),
    [exams],
  );

  const questionCounts = useMemo(
    () => ({
      all: questions.length,
      fill_in: countBy(questions, "fill_in"),
      short_answer: countBy(questions, "short_answer"),
    }),
    [questions],
  );

  const filteredAssignees = useMemo(
    () =>
      assignees.filter((item) => {
        const matchesRole =
          roleFilter === "all" || item.roles.includes(roleFilter);
        const matchesQuery =
          includesText(item.full_name, assigneeQuery) ||
          includesText(item.username, assigneeQuery);
        return matchesRole && matchesQuery;
      }),
    [assigneeQuery, assignees, roleFilter],
  );

  const filteredExams = useMemo(
    () =>
      exams.filter((item) => {
        const matchesKind =
          examKindFilter === "all" || item.kind === examKindFilter;
        return matchesKind && includesText(item.title, examQuery);
      }),
    [examKindFilter, examQuery, exams],
  );

  const filteredQuestions = useMemo(
    () =>
      questions.filter((item) => {
        const matchesType =
          questionTypeFilter === "all" || item.type === questionTypeFilter;
        const matchesQuery =
          includesText(item.content_preview, questionQuery) ||
          includesText(item.title, questionQuery);
        return matchesType && matchesQuery;
      }),
    [questionQuery, questionTypeFilter, questions],
  );

  const canRun = Boolean(selectedExam && selectedQuestion) && !running;

  const handleRun = async () => {
    if (!selectedExam || !selectedQuestion) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await apiClient.post<RegradingRunResult>(
        `/api/operations/regrading/exams/${selectedExam.id}/questions/${selectedQuestion.question_id}`,
      );
      setResult(data);
      toast({
        title: "重新评分已完成",
        description:
          data.question_type === "short_answer"
            ? `已创建 ${data.created_grading_tasks} 个评分任务。`
            : `已重新评分 ${data.affected_submissions} 份提交。`,
      });
    } catch (caught) {
      const message = extractErrorMessage(caught, "重新评分失败，请稍后重试");
      setError(message);
      toast({
        title: "重新评分失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(760px,calc(100vh-2rem))] max-w-[min(980px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="gap-2 px-7 pb-4 pt-6 text-left">
          <DialogTitle>选择归属题目</DialogTitle>
          <DialogDescription>
            归属评估者 → 关联的考试或练习 → 具体题目（仅填空 / 简答）
          </DialogDescription>
          <div className="flex min-w-0 items-center gap-2 pt-3 text-xs text-muted-foreground">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                selectedAssignee
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {(
                selectedAssignee?.full_name ||
                selectedAssignee?.username ||
                "评"
              ).slice(0, 1)}
            </span>
            <span
              className={cn(
                "truncate font-medium",
                selectedAssignee ? "text-primary" : "text-foreground",
              )}
            >
              {selectedAssignee?.full_name ||
                selectedAssignee?.username ||
                "请选择评估者"}
            </span>
            {selectedAssignee ? (
              <span>
                ·{" "}
                {selectedAssignee.roles
                  .map((role) => roleLabel[role])
                  .join(" / ")}
              </span>
            ) : null}
            <ChevronRight className="size-3.5 shrink-0" />
            <FileText className="size-3.5 shrink-0" />
            <span
              className={cn(
                "truncate",
                selectedExam && "font-medium text-primary",
              )}
            >
              {selectedExam?.title || "请选择考试 / 练习"}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
            <span
              className={cn(
                "truncate",
                selectedQuestion && "font-medium text-primary",
              )}
            >
              {selectedQuestion
                ? `第 ${selectedQuestion.order + 1} 题`
                : "未选择题目"}
            </span>
          </div>
        </DialogHeader>

        {error ? (
          <div className="px-7 pb-3">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>操作提示</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 border-y border-border lg:grid-cols-[290px_300px_minmax(0,1fr)]">
          <ColumnShell
            title="归属评估者"
            searchValue={assigneeQuery}
            onSearchChange={setAssigneeQuery}
            searchPlaceholder="搜索评估者 / 教师姓名"
            tabs={
              <FilterTabs
                value={roleFilter}
                onValueChange={(value) =>
                  setRoleFilter(value as "all" | RoleName)
                }
                items={[
                  { value: "all", label: "全部", count: assigneeCounts.all },
                  {
                    value: "platform_admin",
                    label: "管理员",
                    count: assigneeCounts.platform_admin,
                  },
                  {
                    value: "evaluator",
                    label: "评估者",
                    count: assigneeCounts.evaluator,
                  },
                  {
                    value: "teacher",
                    label: "教师",
                    count: assigneeCounts.teacher,
                  },
                ]}
              />
            }
          >
            {loadingAssignees ? (
              <ListLoading label="正在加载评估者..." />
            ) : null}
            {!loadingAssignees && filteredAssignees.length === 0 ? (
              <ListEmpty>暂无可选人员</ListEmpty>
            ) : null}
            {filteredAssignees.map((item) => {
              const selected = selectedAssignee?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectAssignee(item)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                    selected
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                      : "hover:bg-muted/70",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {(item.full_name || item.username).slice(0, 1)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-semibold">
                      {item.full_name || item.username}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ·{" "}
                        {item.roles.map((role) => roleLabel[role]).join(" / ")}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      考试 {item.exam_count} · 练习 {item.practice_count}
                    </span>
                  </span>
                </button>
              );
            })}
          </ColumnShell>

          <ColumnShell
            title="考试 / 练习"
            searchValue={examQuery}
            onSearchChange={setExamQuery}
            searchPlaceholder="搜索考试或练习"
            tabs={
              <FilterTabs
                value={examKindFilter}
                onValueChange={(value) =>
                  setExamKindFilter(value as "all" | ExamKind)
                }
                items={[
                  { value: "all", label: "全部", count: examCounts.all },
                  { value: "exam", label: "考试", count: examCounts.exam },
                  {
                    value: "practice",
                    label: "练习",
                    count: examCounts.practice,
                  },
                ]}
              />
            }
          >
            {!selectedAssignee ? (
              <ListEmpty>选择人员后显示考试和练习</ListEmpty>
            ) : null}
            {loadingExams ? (
              <ListLoading label="正在加载考试和练习..." />
            ) : null}
            {selectedAssignee && !loadingExams && filteredExams.length === 0 ? (
              <ListEmpty>暂无考试或练习</ListEmpty>
            ) : null}
            {(["exam", "practice"] as const).map((kind) => {
              const items = filteredExams.filter((item) => item.kind === kind);
              if (items.length === 0) return null;
              return (
                <div key={kind} className="flex flex-col gap-1.5">
                  <div className="px-1 pt-1 text-xs text-muted-foreground">
                    {examKindLabel[kind]}{" "}
                    <span className="ml-1">{items.length}</span>
                  </div>
                  {items.map((item) => {
                    const selected = selectedExam?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectExam(item)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                          selected
                            ? "bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                            : "hover:bg-muted/70",
                        )}
                      >
                        <SelectionMark selected={selected} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="line-clamp-2 text-sm font-semibold">
                            {item.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            共 {item.total_questions} 题 · 已提交{" "}
                            {item.submitted_count} 人 · {item.status}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </ColumnShell>

          <ColumnShell
            title="题目"
            searchValue={questionQuery}
            onSearchChange={setQuestionQuery}
            searchPlaceholder="搜索题干关键词"
            tabs={
              <FilterTabs
                value={questionTypeFilter}
                onValueChange={(value) =>
                  setQuestionTypeFilter(value as "all" | RegradingQuestionType)
                }
                items={[
                  { value: "all", label: "全部", count: questionCounts.all },
                  {
                    value: "fill_in",
                    label: "填空题",
                    count: questionCounts.fill_in,
                  },
                  {
                    value: "short_answer",
                    label: "简答题",
                    count: questionCounts.short_answer,
                  },
                ]}
              />
            }
          >
            {!selectedExam ? (
              <ListEmpty>选择考试或练习后显示题目</ListEmpty>
            ) : null}
            {loadingQuestions ? <ListLoading label="正在加载题目..." /> : null}
            {selectedExam &&
            !loadingQuestions &&
            filteredQuestions.length === 0 ? (
              <ListEmpty>暂无填空题或简答题</ListEmpty>
            ) : null}
            {filteredQuestions.map((item) => {
              const selected =
                selectedQuestion?.question_id === item.question_id;
              const isRunningOnSelected = selected && running;
              return (
                <button
                  key={item.question_id}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setSelectedQuestion(item);
                    setResult(null);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors",
                    running && "cursor-not-allowed opacity-60",
                    isRunningOnSelected
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : selected
                        ? "bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                        : "hover:bg-muted/70",
                  )}
                >
                  {isRunningOnSelected ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <QuestionCheck selected={selected} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>第 {item.order + 1} 题</span>
                      <Badge
                        variant="outline"
                        className="h-5 rounded-md px-1.5 py-0 text-[11px]"
                      >
                        {questionTypeLabel[item.type]}
                      </Badge>
                    </span>
                    <span className="line-clamp-3 text-sm leading-relaxed text-foreground">
                      {item.content_preview || item.title || "暂无题干预览"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      分值 {item.score} · 已提交 {item.submitted_count} 份
                    </span>
                  </span>
                </button>
              );
            })}
          </ColumnShell>
        </div>

        <DialogFooter
          data-testid="regrading-dialog-footer"
          className="flex-row items-center justify-between gap-3 px-7 py-4 sm:justify-between"
        >
          <div className="min-w-0 text-xs text-muted-foreground">
            {running ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                正在重新评分...
              </span>
            ) : result ? (
              <span>
                {result.question_type === "short_answer"
                  ? `已创建 ${result.created_grading_tasks} 个评分任务`
                  : `已重新评分 ${result.affected_submissions} 份提交`}
              </span>
            ) : selectedQuestion ? (
              <span>
                将对「{selectedExam?.title}」第 {selectedQuestion.order + 1}{" "}
                题重新评分
              </span>
            ) : (
              <span>选择一道题目以继续</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" disabled={!canRun} onClick={handleRun}>
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  正在重新评分...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4" />
                  确认重新评分
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OperationsRegradingPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex flex-col gap-3">
          <OperationsTabs />
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ClipboardCheck className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight">重新批改</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  面向平台管理员的运营工具。当前支持按归属评估者、考试或练习、具体题目发起重新评分。
                </p>
              </div>
            </div>
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <RefreshCw className="size-4" />
              开始重新评分
            </Button>
          </div>
        </div>
      </section>

      <OperationsRegradingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </main>
  );
}
