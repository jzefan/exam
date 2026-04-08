import { useGetIdentity, usePermissions } from "@refinedev/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardList,
  Users,
  FileCheck,
  Plus,
  ArrowRight,
  FilePlus,
  Briefcase,
  UserCog,
} from "lucide-react";
import { apiRequest } from "@/pages/grading/api";
import { Card, CardContent } from "@/components/ui/card";

interface DashboardStats {
  total_candidates: number;
  pending_grading: number;
  total_students: number;
  total_exams: number;
  total_questions: number;
  total_users: number;
  total_jobs: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
  loading?: boolean;
}

function StatCard({ title, value, icon, color, onClick, loading }: StatCardProps) {
  return (
    <Card
      className={onClick ? "cursor-pointer transition-all hover:border-foreground/40 hover:shadow-sm" : ""}
      onClick={onClick}
    >
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <div className="h-9 w-16 bg-muted animate-pulse rounded-md mt-1" />
            ) : (
              <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
            )}
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
  const { data: role } = usePermissions<string>({});
  const isAdmin = role === "platform_admin";
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("DEBUG: Dashboard fetching stats...");
    void apiRequest<DashboardStats>("/analytics/dashboard-stats")
      .then((data) => {
        console.log("DEBUG: Dashboard stats received:", data);
        setStats(data);
      })
      .catch((err) => {
        console.error("DEBUG: Dashboard stats fetch error:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

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
        {isAdmin ? (
          <>
            <StatCard
              title="考试数"
              value={stats?.total_exams ?? 0}
              loading={loading}
              icon={<ClipboardList size={22} className="text-violet-600 dark:text-violet-400" />}
              color="bg-violet-50 dark:bg-violet-950"
              onClick={() => navigate("/exams")}
            />
            <StatCard
              title="题目数"
              value={stats?.total_questions ?? 0}
              loading={loading}
              icon={<BookOpen size={22} className="text-amber-600 dark:text-amber-400" />}
              color="bg-amber-50 dark:bg-amber-950"
              onClick={() => navigate("/questions")}
            />
            <StatCard
              title="用户数"
              value={stats?.total_users ?? 0}
              loading={loading}
              icon={<Users size={22} className="text-emerald-600 dark:text-emerald-400" />}
              color="bg-emerald-50 dark:bg-emerald-950"
              onClick={() => navigate("/admin/users")}
            />
            <StatCard
              title="岗位数"
              value={stats?.total_jobs ?? 0}
              loading={loading}
              icon={<Briefcase size={22} className="text-sky-600 dark:text-sky-400" />}
              color="bg-sky-50 dark:bg-sky-950"
              onClick={() => navigate("/gwmx/job-models")}
            />
          </>
        ) : (
          <>
            <StatCard
              title="考生总数"
              value={stats?.total_candidates ?? 0}
              loading={loading}
              icon={<ClipboardList size={22} className="text-violet-600 dark:text-violet-400" />}
              color="bg-violet-50 dark:bg-violet-950"
            />
            <StatCard
              title="待阅卷"
              value={stats?.pending_grading ?? 0}
              loading={loading}
              icon={<FileCheck size={22} className="text-amber-600 dark:text-amber-400" />}
              color="bg-amber-50 dark:bg-amber-950"
              onClick={() => navigate("/grading")}
            />
            <StatCard
              title="学生总数"
              value={stats?.total_students ?? 0}
              loading={loading}
              icon={<Users size={22} className="text-emerald-600 dark:text-emerald-400" />}
              color="bg-emerald-50 dark:bg-emerald-950"
              onClick={() => navigate("/students")}
            />
          </>
        )}
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
          {isAdmin ? (
            <QuickAction
              title="用户管理"
              description="管理平台所有用户与角色"
              icon={<UserCog size={18} />}
              onClick={() => navigate("/admin/users")}
            />
          ) : (
            <QuickAction
              title="学生管理"
              description="管理考生账号、班级与导入数据"
              icon={<Users size={18} />}
              onClick={() => navigate("/students")}
            />
          )}
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
          {isAdmin && (
            <QuickAction
              title="岗位管理"
              description="管理岗位模型与能力体系"
              icon={<Briefcase size={18} />}
              onClick={() => navigate("/gwmx/job-models")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
