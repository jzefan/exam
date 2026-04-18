import { useOne } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, PieChart } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AnalysisOverall = {
  total_students: number;
  submitted_count: number;
  graded_count: number;
  average_score: number | null;
  median_score: number | null;
  highest_score: number | null;
  lowest_score: number | null;
  pass_count: number;
  pass_rate: number | null;
  total_score: number;
};

type ScoreBucket = {
  label: string;
  min_percent: number;
  max_percent: number;
  count: number;
};

type StudentRow = {
  student_id: string;
  full_name: string | null;
  username: string | null;
  submitted_at: string | null;
  grading_status: string | null;
  objective_score: number | null;
  subjective_score: number | null;
  score: number | null;
  percent: number | null;
};

type QuestionRow = {
  question_id: string;
  order: number;
  title: string | null;
  type: string | null;
  max_score: number;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  average_score: number | null;
};

type KnowledgePointRow = {
  knowledge_point_id: string;
  name: string;
  question_count: number;
  average_correct_rate: number | null;
};

type ExamAnalysis = {
  exam_id: string;
  title: string;
  overall: AnalysisOverall;
  score_distribution: ScoreBucket[];
  students: StudentRow[];
  questions: QuestionRow[];
  knowledge_points: KnowledgePointRow[];
};

const formatScore = (value: number | null): string =>
  value === null || value === undefined ? "—" : value.toFixed(1);

const formatPercent = (value: number | null): string =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

const formatDateTime = (value: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function ScoreDistributionChart({ buckets }: { buckets: ScoreBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="space-y-3">
      {buckets.map((b) => {
        const width = (b.count / max) * 100;
        return (
          <div key={b.label} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-sm text-muted-foreground">{b.label}</div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted/40">
              <div
                className="h-full rounded-md bg-primary/70 transition-all"
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
              {b.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60">
        <PieChart size={24} className="text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ExamAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { result, query } = useOne<ExamAnalysis>({
    resource: "exams",
    id: id ? `${id}/analysis` : "",
    queryOptions: { enabled: Boolean(id), retry: false },
  });

  if (!id) {
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <EmptyState message="缺少考试 ID" />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">加载分析数据…</span>
      </div>
    );
  }

  if (query.isError || !result) {
    const message =
      (query.error as { response?: { data?: { detail?: string } } } | undefined)?.response?.data
        ?.detail ?? "加载分析数据失败";
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <EmptyState message={message} />
      </div>
    );
  }

  const { title, overall, score_distribution, students, questions, knowledge_points } = result;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-base font-bold tracking-tight text-foreground">
          结果分析
          <span className="ml-2 text-muted-foreground">{title}</span>
        </h1>
        <Button
          type="button"
          variant="ghost"
          className="h-12 rounded-full bg-muted/50 px-6 text-base font-semibold text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground"
          onClick={() => navigate("/exams")}
        >
          <ArrowLeft className="size-5" />
          返回题目列表
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="参考 / 已提交"
          value={`${overall.submitted_count} / ${overall.total_students}`}
          hint={`已阅卷 ${overall.graded_count}`}
        />
        <StatCard label="平均分" value={formatScore(overall.average_score)} />
        <StatCard label="中位数" value={formatScore(overall.median_score)} />
        <StatCard
          label="最高 / 最低"
          value={`${formatScore(overall.highest_score)} / ${formatScore(overall.lowest_score)}`}
        />
        <StatCard
          label="及格率"
          value={formatPercent(overall.pass_rate)}
          hint={`≥ ${(overall.total_score * 0.6).toFixed(0)} 分：${overall.pass_count} 人`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">分数分布</CardTitle>
          <CardDescription>按满分百分比分桶</CardDescription>
        </CardHeader>
        <CardContent>
          {overall.graded_count === 0 ? (
            <EmptyState message="暂无已阅卷数据" />
          ) : (
            <ScoreDistributionChart buckets={score_distribution} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">学生成绩</CardTitle>
          <CardDescription>按总分降序</CardDescription>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <EmptyState message="暂无考生" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学生</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">客观分</TableHead>
                  <TableHead className="text-right">主观分</TableHead>
                  <TableHead className="text-right">总分</TableHead>
                  <TableHead className="text-right">得分率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.student_id}>
                    <TableCell>
                      <div className="font-medium">{s.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.username ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(s.submitted_at)}
                    </TableCell>
                    <TableCell className="text-sm">{s.grading_status ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatScore(s.objective_score)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatScore(s.subjective_score)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatScore(s.score)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {s.percent === null ? "—" : `${s.percent.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">题目分析</CardTitle>
          <CardDescription>正确率与平均得分</CardDescription>
        </CardHeader>
        <CardContent>
          {questions.length === 0 ? (
            <EmptyState message="暂无题目" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>题目</TableHead>
                  <TableHead>题型</TableHead>
                  <TableHead className="text-right">满分</TableHead>
                  <TableHead className="text-right">作答</TableHead>
                  <TableHead className="text-right">正确率</TableHead>
                  <TableHead className="text-right">平均得分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((q) => (
                  <TableRow key={q.question_id}>
                    <TableCell className="text-muted-foreground">{q.order + 1}</TableCell>
                    <TableCell className="max-w-md truncate">{q.title ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{q.type ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatScore(q.max_score)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{q.attempt_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(q.correct_rate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatScore(q.average_score)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {knowledge_points.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">知识点分析</CardTitle>
            <CardDescription>按平均正确率</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>知识点</TableHead>
                  <TableHead className="text-right">题数</TableHead>
                  <TableHead className="text-right">平均正确率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {knowledge_points.map((kp) => (
                  <TableRow key={kp.knowledge_point_id}>
                    <TableCell>{kp.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{kp.question_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(kp.average_correct_rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
