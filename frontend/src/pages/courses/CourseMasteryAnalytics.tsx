import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Target,
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
  getCourseMasterySummary,
  type CourseMasteryQuestion,
  type CourseMasterySummary,
  type CourseMasteryUnit,
} from "./api";

const ALL_CLASSES = "__all_classes__";

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits)).toString();
}

function trendLabel(value: number | null) {
  if (value == null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function masteryTone(accuracy: number | null | undefined) {
  if (accuracy == null) return "bg-muted text-muted-foreground";
  if (accuracy < 60) return "bg-rose-500/10 text-rose-700";
  if (accuracy < 80) return "bg-amber-500/10 text-amber-700";
  return "bg-emerald-500/10 text-emerald-700";
}

function heatmapStyle(accuracy: number | null) {
  if (accuracy == null) {
    return { backgroundColor: "hsl(var(--muted) / 0.35)" };
  }
  if (accuracy < 60) {
    return { backgroundColor: `hsl(0 84% 60% / ${0.1 + (60 - accuracy) / 180})` };
  }
  if (accuracy < 80) {
    return { backgroundColor: `hsl(38 92% 50% / ${0.1 + (80 - accuracy) / 220})` };
  }
  return { backgroundColor: `hsl(151 55% 42% / ${0.12 + (accuracy - 80) / 180})` };
}

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    choice: "选择",
    true_false: "判断",
    fill_in: "填空",
    short_answer: "简答",
    essay: "论述",
    code: "代码",
  };
  return labels[type] ?? type;
}

function questionSignal(question: CourseMasteryQuestion) {
  const accuracy = question.accuracy;
  const discrimination = question.discrimination;
  if (accuracy != null && accuracy >= 85 && discrimination != null && discrimination < 12) {
    return { label: "大家都会", className: "bg-emerald-500/10 text-emerald-700" };
  }
  if (accuracy != null && accuracy < 45 && (discrimination == null || discrimination >= 10)) {
    return { label: "全班薄弱", className: "bg-rose-500/10 text-rose-700" };
  }
  if (discrimination != null && discrimination <= 0) {
    return { label: "需复核", className: "bg-orange-500/10 text-orange-700" };
  }
  if (discrimination != null && discrimination >= 30) {
    return { label: "区分明显", className: "bg-blue-500/10 text-blue-700" };
  }
  return { label: "正常", className: "bg-muted text-muted-foreground" };
}

function studentName(student: CourseMasterySummary["students"][number]) {
  return student.full_name || student.username || "未命名学生";
}

function UnitRow({ unit }: { unit: CourseMasteryUnit }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium" style={{ paddingLeft: Math.max(unit.depth - 1, 0) * 14 }}>
            {unit.name}
          </span>
          {unit.parent_name ? (
            <span className="text-xs text-muted-foreground">{unit.parent_name}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline">{unit.is_leaf ? "知识点" : "章节"}</Badge>
      </TableCell>
      <TableCell className="text-center tabular-nums">
        <Badge className={cn("font-semibold", masteryTone(unit.accuracy))}>
          {formatPercent(unit.accuracy)}
        </Badge>
      </TableCell>
      <TableCell className="text-center tabular-nums">{unit.question_count}</TableCell>
      <TableCell className="text-center tabular-nums">
        <span className={cn(unit.trend_delta != null && unit.trend_delta < -15 && "text-rose-600")}>
          {trendLabel(unit.trend_delta)}
        </span>
      </TableCell>
      <TableCell className="text-center tabular-nums">{formatNumber(unit.variance)}</TableCell>
      <TableCell className="text-center">
        {unit.sample_insufficient ? (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
            样本不足
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function CourseMasteryAnalytics({
  courseId,
  courseName,
  semesterId,
  semesterLabel,
}: {
  courseId: string;
  courseName: string;
  semesterId: string | null;
  semesterLabel: string;
}) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<CourseMasterySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(ALL_CLASSES);
  const [query, setQuery] = useState("");

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await getCourseMasterySummary(courseId, semesterId);
      setSummary(data);
      setSelectedClassId((current) => {
        const classNames = new Set(data.students.map((student) => student.class_name).filter(Boolean));
        return current === ALL_CLASSES || classNames.has(current) ? current : ALL_CLASSES;
      });
    } catch (error) {
      toast({
        title: "掌握情况加载失败",
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

  const classOptions = useMemo(() => {
    if (!summary) return [];
    const counts = new Map<string, number>();
    for (const student of summary.students) {
      if (!student.class_name) continue;
      counts.set(student.class_name, (counts.get(student.class_name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"));
  }, [summary]);

  const visibleStudents = useMemo(() => {
    if (!summary) return [];
    const keyword = query.trim().toLowerCase();
    return summary.students.filter((student) => {
      if (selectedClassId !== ALL_CLASSES && student.class_name !== selectedClassId) return false;
      if (!keyword) return true;
      return [student.full_name, student.student_no, student.username, student.class_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [query, selectedClassId, summary]);

  const weakestUnits = useMemo(
    () => (summary?.units ?? []).filter((unit) => unit.accuracy != null).slice(0, 8),
    [summary],
  );
  const highVarianceUnits = useMemo(
    () =>
      [...(summary?.units ?? [])]
        .filter((unit) => unit.variance != null)
        .sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0))
        .slice(0, 6),
    [summary],
  );
  const notableQuestions = useMemo(
    () => (summary?.questions ?? []).slice(0, 10),
    [summary],
  );
  const averageOfVisibleStudents = useMemo(() => {
    const values = visibleStudents
      .map((student) => student.average_accuracy)
      .filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [visibleStudents]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" />
        正在分析课程掌握情况...
      </div>
    );
  }

  if (!summary) return null;

  const weakestUnit = weakestUnits[0];
  const varianceLeader = highVarianceUnits[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">课程掌握情况</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {courseName} · {semesterLabel} · 按知识单元、题目和学生矩阵定位“补什么、补给谁”。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadSummary()}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "整体掌握度",
            value: formatPercent(summary.overall_accuracy),
            hint: `${summary.question_count} 题 · ${summary.student_count} 名学生`,
            icon: Target,
          },
          {
            label: "当前筛选行均值",
            value: formatPercent(averageOfVisibleStudents),
            hint: `矩阵行均值，不依赖总分排名`,
            icon: Users,
          },
          {
            label: "最薄弱单元",
            value: weakestUnit ? formatPercent(weakestUnit.accuracy) : "—",
            hint: weakestUnit?.name ?? "暂无题目数据",
            icon: Brain,
          },
          {
            label: "最大内部分化",
            value: varianceLeader ? formatNumber(varianceLeader.variance) : "—",
            hint: varianceLeader?.name ?? "暂无方差数据",
            icon: GitBranch,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="overflow-hidden shadow-none">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{item.value}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="shadow-none">
          <CardHeader className="border-b border-border">
            <CardTitle>知识单元掌握度</CardTitle>
            <CardDescription>
              父章节按叶子知识单元题量加权；少于 {summary.sample_threshold} 题会标注样本不足。
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>知识单元</TableHead>
                  <TableHead className="w-20 text-center">层级</TableHead>
                  <TableHead className="w-24 text-center">掌握度</TableHead>
                  <TableHead className="w-20 text-center">覆盖题量</TableHead>
                  <TableHead className="w-24 text-center">考试趋势</TableHead>
                  <TableHead className="w-24 text-center">内部方差</TableHead>
                  <TableHead className="w-24 text-center">备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weakestUnits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      暂无可统计的答题数据
                    </TableCell>
                  </TableRow>
                ) : (
                  weakestUnits.map((unit) => <UnitRow key={unit.id} unit={unit} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="border-b border-border">
            <CardTitle>章节内部方差</CardTitle>
            <CardDescription>
              方差大说明章节内部知识点或题目表现差异明显，适合下钻排查。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {highVarianceUnits.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                暂无方差数据
              </div>
            ) : (
              highVarianceUnits.map((unit, index) => (
                <div key={unit.id} className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-medium">{unit.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {unit.is_leaf ? "题目正确率方差" : "下级知识单元方差"} · {unit.question_count} 题
                    </p>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    {formatNumber(unit.variance)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader className="border-b border-border">
          <CardTitle>题目诊断</CardTitle>
          <CardDescription>
            正确率用于判断难度，区分度用于判断高低掌握学生是否被有效区分。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>题目</TableHead>
                <TableHead className="w-20 text-center">题型</TableHead>
                <TableHead className="w-32 text-center">知识单元</TableHead>
                <TableHead className="w-24 text-center">正确率</TableHead>
                <TableHead className="w-24 text-center">区分度</TableHead>
                <TableHead className="w-24 text-center">信号</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notableQuestions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    暂无题目统计
                  </TableCell>
                </TableRow>
              ) : (
                notableQuestions.map((question) => {
                  const signal = questionSignal(question);
                  return (
                    <TableRow key={question.id}>
                      <TableCell>
                        <div className="line-clamp-2 max-w-[520px] text-sm font-medium">
                          {question.title}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {question.attempt_count} 次作答
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{questionTypeLabel(question.question_type)}</Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {question.unit_name ?? "未关联"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{formatPercent(question.accuracy)}</TableCell>
                      <TableCell className="text-center tabular-nums">{formatPercent(question.discrimination)}</TableCell>
                      <TableCell className="text-center">
                        <Badge className={signal.className}>{signal.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b border-border">
          <div>
            <CardTitle>学生 × 知识单元矩阵</CardTitle>
            <CardDescription>
              列均值看全班薄弱点，行均值看学生整体掌握，交叉低分区定位补课对象。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedClassId} onValueChange={setSelectedClassId}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="选择班级" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_CLASSES}>全部班级</SelectItem>
                  {classOptions.map(([className, count]) => (
                    <SelectItem key={className} value={className}>
                      {className}（{count}）
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative w-[230px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
          {summary.question_count === 0 || summary.matrix_columns.length === 0 || visibleStudents.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">暂无矩阵数据</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  需要课程下有已提交的练习或考试，且题目已关联到课程知识单元。
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 w-44 bg-muted/40">学生</TableHead>
                    <TableHead className="w-24 text-center">行均值</TableHead>
                    {summary.matrix_columns.map((unit) => (
                      <TableHead key={unit.id} className="min-w-28 max-w-36 text-center">
                        <span className="line-clamp-2 text-xs">{unit.name}</span>
                      </TableHead>
                    ))}
                    <TableHead className="min-w-44">薄弱模式</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.map((student) => (
                    <TableRow key={student.student_id}>
                      <TableCell className="sticky left-0 z-10 bg-card">
                        <div className="font-medium">{studentName(student)}</div>
                        <div className="text-xs text-muted-foreground">
                          {student.class_name ?? "未分班"} · {student.student_no ?? "无学号"}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">
                        {formatPercent(student.average_accuracy)}
                      </TableCell>
                      {student.cells.map((cell) => (
                        <TableCell
                          key={`${student.student_id}:${cell.unit_id}`}
                          className="text-center text-xs tabular-nums"
                          style={heatmapStyle(cell.accuracy)}
                          title={`练习 ${formatPercent(cell.practice_accuracy)} / 考试 ${formatPercent(cell.exam_accuracy)} / 趋势 ${trendLabel(cell.trend_delta)}`}
                        >
                          <div className="font-semibold">{formatPercent(cell.accuracy, 0)}</div>
                          {cell.sample_insufficient ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">样本少</div>
                          ) : null}
                        </TableCell>
                      ))}
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{student.cluster_label ?? "暂无明显短板"}</span>
                          {student.consistency_alerts.length > 0 ? (
                            <span className="text-xs text-amber-700">
                              练考不一致：{student.consistency_alerts.join("、")}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
