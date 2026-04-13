import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, Gavel, UserRoundCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, type BackendTaskListItem } from "./api";

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

export function GradingAnalyticsPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<BackendTaskListItem[]>([]);

  useEffect(() => {
    void apiRequest<BackendTaskListItem[]>("/grading/tasks").then(setTasks).catch(() => setTasks([]));
  }, []);

  const stats = useMemo(() => {
    const completed = tasks.filter((item) => item.status === "completed").length;
    const arbitration = tasks.filter((item) => item.arbitration_required).length;
    const manual = tasks.filter((item) => item.manual_override).length;
    const autoRate = tasks.length === 0 ? "0%" : `${Math.round(((completed - manual) / tasks.length) * 100)}%`;
    return { completed, arbitration, manual, autoRate };
  }, [tasks]);

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex items-center justify-between border-b border-border/70 pb-4">
        <h1 className="text-base font-bold text-foreground tracking-tight">阅卷统计</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate("/grading")}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="已完成任务" value={stats.completed} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard title="需仲裁" value={stats.arbitration} icon={<Gavel className="h-5 w-5" />} />
        <StatCard title="人工改分" value={stats.manual} icon={<UserRoundCheck className="h-5 w-5" />} />
        <StatCard title="AI 自动完成率" value={stats.autoRate} icon={<BarChart3 className="h-5 w-5" />} />
      </div>
    </div>
  );
}
