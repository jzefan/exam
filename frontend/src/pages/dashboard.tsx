import { useList, useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardList,
  Users,
  FileCheck,
  Plus,
  ArrowRight,
  FilePlus,
} from "lucide-react";
import type { IQuestion } from "../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
}

function StatCard({ title, value, icon, color, onClick }: StatCardProps) {
  return (
    <Card
      className={onClick ? "cursor-pointer transition-all hover:border-foreground/40 hover:shadow-sm" : ""}
      onClick={onClick}
    >
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
          </div>
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${color}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "outline";
}

function QuickAction({ title, description, icon, onClick }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 w-full rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-foreground/40 hover:shadow-sm"
    >
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ArrowRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{ name: string; role?: string }>();

  const { query: questionsQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 1 },
  });
  const { query: usersQuery } = useList({
    resource: "users",
    pagination: { currentPage: 1, pageSize: 1 },
  });

  const totalQuestions = questionsQuery.data?.total ?? "—";
  const totalUsers = usersQuery.data?.total ?? "—";

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return "夜深了";
    if (h < 12) return "早上好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  })();

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-base font-bold text-foreground tracking-tight">
          {greeting}，{identity?.name ?? "用户"} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          欢迎使用智评云考试管理平台，这里是你的工作台
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="题目总数"
          value={totalQuestions}
          icon={<BookOpen size={22} className="text-blue-600 dark:text-blue-400" />}
          color="bg-blue-50 dark:bg-blue-950"
          onClick={() => navigate("/questions")}
        />
        <StatCard
          title="考试总数"
          value="—"
          icon={<ClipboardList size={22} className="text-violet-600 dark:text-violet-400" />}
          color="bg-violet-50 dark:bg-violet-950"
        />
        <StatCard
          title="待阅卷"
          value="—"
          icon={<FileCheck size={22} className="text-amber-600 dark:text-amber-400" />}
          color="bg-amber-50 dark:bg-amber-950"
        />
        <StatCard
          title="用户总数"
          value={totalUsers}
          icon={<Users size={22} className="text-emerald-600 dark:text-emerald-400" />}
          color="bg-emerald-50 dark:bg-emerald-950"
          onClick={() => navigate("/users")}
        />
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">快捷操作</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            title="新建题目"
            description="创建选择题、填空题、主观题等"
            icon={<FilePlus size={18} />}
            onClick={() => navigate("/questions/create")}
          />
          <QuickAction
            title="题库管理"
            description="浏览、搜索和管理所有题目"
            icon={<BookOpen size={18} />}
            onClick={() => navigate("/questions")}
          />
          <QuickAction
            title="用户管理"
            description="管理教师、学生账号与权限"
            icon={<Users size={18} />}
            onClick={() => navigate("/users")}
          />
          <QuickAction
            title="创建考试"
            description="组卷、设置考试时间与规则"
            icon={<Plus size={18} />}
            onClick={() => navigate("/exams/create")}
          />
          <QuickAction
            title="考试管理"
            description="查看所有考试及当前状态"
            icon={<ClipboardList size={18} />}
            onClick={() => navigate("/exams")}
          />
          <QuickAction
            title="阅卷中心"
            description="人工阅卷与 AI 智能评分"
            icon={<FileCheck size={18} />}
            onClick={() => navigate("/grading")}
          />
        </div>
      </div>

      {/* CTA — placeholder for future widgets */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            更多功能即将上线
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>· 数据分析：考试成绩分布、题目难度分析</p>
          <p>· AI 评分：多模型协同批改主观题</p>
          <p>· 成绩申诉：学生申诉与仲裁流程</p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigate("/questions")}>
          进入题库管理
          <ArrowRight size={13} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}
