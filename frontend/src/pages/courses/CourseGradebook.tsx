import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  getCourseGradeSummary,
  updateCourseStudentGrade,
  type CourseGradeComponent,
  type CourseGradeComponentKey,
  type CourseGradeStudent,
  type CourseGradeSummary,
  type CourseGradeWeights,
} from "./api";

const ALL_CLASSES = "__all_classes__";

const GRADE_COLUMNS: Array<{
  key: CourseGradeComponentKey;
  label: string;
}> = [
  { key: "chapter_task", label: "章节任务点" },
  { key: "chapter_quiz", label: "章节测验" },
  { key: "assignment", label: "作业" },
  { key: "exam", label: "考试" },
];

function formatScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(2)).toString();
}

function recalculateStudent(
  student: CourseGradeStudent,
  weights: CourseGradeWeights,
) {
  const comprehensiveScore = GRADE_COLUMNS.reduce(
    (sum, column) =>
      sum + (student[column.key].score ?? 0) * weights[column.key] / 100,
    0,
  );
  return {
    ...student,
    comprehensive_score: Number(comprehensiveScore.toFixed(2)),
  };
}

function csvValue(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function EditableGradeCell({
  component,
  disabled,
  saving,
  onSave,
}: {
  component: CourseGradeComponent;
  disabled: boolean;
  saving: boolean;
  onSave: (score: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const beginEditing = () => {
    if (disabled || saving) return;
    setDraft(component.score !== null ? String(component.score) : "");
    setEditing(true);
  };

  const commit = async () => {
    if (!editing) return;
    setEditing(false);
    const normalized = draft.trim();
    const nextScore = normalized === "" ? null : Number(normalized);
    if (nextScore !== null && (!Number.isFinite(nextScore) || nextScore < 0 || nextScore > 100)) {
      setDraft(component.manual_score !== null ? String(component.manual_score) : "");
      return;
    }
    if (
      nextScore === component.manual_score
      || (component.manual_score === null && nextScore === component.system_score)
    ) {
      return;
    }
    await onSave(nextScore);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        type="number"
        min={0}
        max={100}
        step="0.1"
        value={draft}
        aria-label="录入成绩"
        className="mx-auto h-8 w-20 text-center tabular-nums"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(component.score !== null ? String(component.score) : "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || saving}
      onClick={beginEditing}
      title={
        component.source === "manual" && component.system_score !== null
          ? `人工录入，系统计算值为 ${formatScore(component.system_score)}`
          : disabled
            ? undefined
            : "点击录入成绩；清空后恢复系统计算值"
      }
      className={cn(
        "group mx-auto flex min-h-8 min-w-20 items-center justify-center gap-1 rounded-md px-2 text-sm tabular-nums transition-colors",
        disabled
          ? "cursor-default"
          : "hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
      <span className={cn(component.score === null && "text-muted-foreground")}>
        {formatScore(component.score)}
      </span>
      {component.source === "manual" ? (
        <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
          手填
        </Badge>
      ) : !disabled ? (
        <PencilLine className="opacity-0 transition-opacity group-hover:opacity-60" />
      ) : null}
    </button>
  );
}

export function CourseGradebook({
  courseId,
  courseName,
  semesterId,
  semesterLabel,
  canWrite,
}: {
  courseId: string;
  courseName: string;
  semesterId: string | null;
  semesterLabel: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<CourseGradeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(ALL_CLASSES);
  const [query, setQuery] = useState("");
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await getCourseGradeSummary(courseId, semesterId);
      setSummary(data);
      setSelectedClassId((current) =>
        current === ALL_CLASSES || data.classes.some((item) => item.id === current)
          ? current
          : ALL_CLASSES,
      );
    } catch (error) {
      toast({
        title: "成绩加载失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, [courseId, semesterId]);

  const visibleStudents = useMemo(() => {
    if (!summary) return [];
    const keyword = query.trim().toLowerCase();
    return summary.students.filter((student) => {
      if (selectedClassId !== ALL_CLASSES && student.class_id !== selectedClassId) {
        return false;
      }
      if (!keyword) return true;
      return [student.full_name, student.student_no, student.username, student.class_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [query, selectedClassId, summary]);

  const visibleAverage = useMemo(() => {
    if (visibleStudents.length === 0) return null;
    return Number(
      (
        visibleStudents.reduce((sum, student) => sum + student.comprehensive_score, 0)
        / visibleStudents.length
      ).toFixed(2),
    );
  }, [visibleStudents]);

  const distribution = useMemo(
    () => ({
      excellent: visibleStudents.filter((student) => student.comprehensive_score >= 80).length,
      passing: visibleStudents.filter(
        (student) => student.comprehensive_score >= 60 && student.comprehensive_score < 80,
      ).length,
      needsAttention: visibleStudents.filter((student) => student.comprehensive_score < 60).length,
    }),
    [visibleStudents],
  );

  const distributionStyle = useMemo(() => {
    const total = Math.max(visibleStudents.length, 1);
    const excellentEnd = distribution.excellent / total * 100;
    const passingEnd = excellentEnd + distribution.passing / total * 100;
    return {
      background: `conic-gradient(hsl(var(--primary)) 0 ${excellentEnd}%, hsl(var(--muted-foreground)) ${excellentEnd}% ${passingEnd}%, hsl(var(--destructive)) ${passingEnd}% 100%)`,
    };
  }, [distribution, visibleStudents.length]);

  const handleSave = async (
    studentId: string,
    componentKey: CourseGradeComponentKey,
    score: number | null,
  ) => {
    if (!summary) return;
    const cellKey = `${studentId}:${componentKey}`;
    setSavingCell(cellKey);
    try {
      const result = await updateCourseStudentGrade(courseId, studentId, {
        semester_id: semesterId,
        component: componentKey,
        score,
      });
      setSummary((current) => {
        if (!current) return current;
        const students = current.students.map((student) => {
          if (student.student_id !== studentId) return student;
          const previous = student[componentKey];
          const manualScore = result.manual_score;
          const nextComponent: CourseGradeComponent = {
            ...previous,
            manual_score: manualScore,
            score: manualScore ?? previous.system_score,
            source:
              manualScore !== null
                ? "manual"
                : previous.system_score !== null
                  ? "system"
                  : "none",
          };
          return recalculateStudent(
            { ...student, [componentKey]: nextComponent },
            current.weights,
          );
        });
        return { ...current, students };
      });
      toast({
        title: score === null ? "已恢复系统成绩" : "成绩已保存",
      });
    } catch (error) {
      toast({
        title: "成绩保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSavingCell(null);
    }
  };

  const handleExport = () => {
    if (!summary || visibleStudents.length === 0) return;
    const header = [
      "序号",
      "班级",
      "姓名",
      "学号",
      ...GRADE_COLUMNS.map(
        (column) => `${column.label}(${summary.weights[column.key]}%)`,
      ),
      "综合成绩",
    ];
    const rows = visibleStudents.map((student, index) => [
      index + 1,
      student.class_name,
      student.full_name ?? student.username ?? "未命名学生",
      student.student_no ?? "",
      ...GRADE_COLUMNS.map((column) => student[column.key].score ?? ""),
      student.comprehensive_score,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => csvValue(value)).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${courseName}-${semesterLabel}-学生成绩.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" />
        正在汇总学生成绩...
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">学生成绩</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            系统成绩自动汇总，点击成绩单元格可人工修订；清空人工值后恢复系统计算。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadSummary()}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={visibleStudents.length === 0}
          >
            <Download data-icon="inline-start" />
            导出成绩
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b border-border bg-muted/30">
          <CardTitle>成绩概览</CardTitle>
          <CardDescription>{semesterLabel} · 当前筛选范围</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 p-6 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1fr)_minmax(280px,1.2fr)]">
          <div className="flex flex-col justify-center border-b border-border pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8">
            <span className="text-sm text-muted-foreground">综合成绩平均分</span>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-5xl font-semibold tracking-tight tabular-nums text-foreground">
                {formatScore(visibleAverage)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">分</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Users />
              当前共 {visibleStudents.length} 名学生
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="relative size-32 shrink-0 rounded-full p-3" style={distributionStyle}>
              <div className="flex size-full flex-col items-center justify-center rounded-full bg-card">
                <span className="text-2xl font-semibold tabular-nums">{visibleStudents.length}</span>
                <span className="text-xs text-muted-foreground">学生</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm bg-primary" />
                <span className="text-muted-foreground">80 分及以上</span>
                <strong className="ml-auto tabular-nums">{distribution.excellent}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm bg-muted-foreground" />
                <span className="text-muted-foreground">60 至 79.99 分</span>
                <strong className="ml-auto tabular-nums">{distribution.passing}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm bg-destructive" />
                <span className="text-muted-foreground">60 分以下</span>
                <strong className="ml-auto tabular-nums">{distribution.needsAttention}</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 self-center">
            {GRADE_COLUMNS.map((column) => (
              <div key={column.key} className="border-b border-border pb-3">
                <div className="text-xs text-muted-foreground">{column.label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {summary.weights[column.key]}%
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b border-border">
          <div>
            <CardTitle>成绩明细</CardTitle>
            <CardDescription>人工录入值会覆盖系统成绩，但不会修改原考试答卷。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedClassId} onValueChange={setSelectedClassId}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="选择班级" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_CLASSES}>全部班级</SelectItem>
                  {summary.classes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}（{item.student_count}）
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative w-[230px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索姓名或学号"
                className="h-9 pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibleStudents.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
              <Users className="text-muted-foreground" />
              <p className="text-sm font-medium">当前范围暂无学生</p>
              <p className="text-xs text-muted-foreground">
                请先在“管理”中把班级关联到当前学期。
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-16 text-center">序号</TableHead>
                  <TableHead className="min-w-32">班级</TableHead>
                  <TableHead className="min-w-28">姓名</TableHead>
                  <TableHead className="min-w-32">学号</TableHead>
                  {GRADE_COLUMNS.map((column) => (
                    <TableHead key={column.key} className="min-w-32 text-center">
                      <span>{column.label}</span>
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({summary.weights[column.key]}%)
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="min-w-28 text-center font-semibold text-foreground">
                    综合成绩
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleStudents.map((student, index) => (
                  <TableRow key={student.student_id}>
                    <TableCell className="text-center text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>{student.class_name}</TableCell>
                    <TableCell className="font-medium">
                      {student.full_name ?? student.username ?? "未命名学生"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {student.student_no ?? "—"}
                    </TableCell>
                    {GRADE_COLUMNS.map((column) => (
                      <TableCell key={column.key} className="p-2 text-center">
                        <EditableGradeCell
                          component={student[column.key]}
                          disabled={!canWrite}
                          saving={savingCell === `${student.student_id}:${column.key}`}
                          onSave={(score) => handleSave(student.student_id, column.key, score)}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center text-base font-semibold tabular-nums">
                      {formatScore(student.comprehensive_score)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
