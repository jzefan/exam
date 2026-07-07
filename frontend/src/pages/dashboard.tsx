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
  LibraryBig,
  Upload,
} from "lucide-react";
import { apiRequest } from "@/pages/grading/api";
import { Card, CardContent } from "@/components/ui/card";
import { IcpRecordLink } from "@/components/icp-record-link";
import { getPersonaCopy } from "@/lib/persona-copy";

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

function StatCard({
  title,
  value,
  icon,
  color,
  onClick,
  loading,
}: StatCardProps) {
  return (
    <Card
      className={
        onClick
          ? "cursor-pointer transition-all hover:border-primary/55 hover:bg-primary/[0.015] hover:shadow-sm"
          : ""
      }
      onClick={onClick}
    >
      <CardContent className="p-4 pt-4 sm:pt-6">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {title}
            </p>
            {loading ? (
              <div className="h-7 sm:h-9 w-14 sm:w-16 bg-muted animate-pulse rounded-md mt-1" />
            ) : (
              <p className="mt-1 text-2xl sm:text-3xl font-bold text-foreground">
                {value}
              </p>
            )}
          </div>
          <div
            className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}
          >
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
  dataOnboarding?: string;
}

function QuickAction({
  title,
  description,
  icon,
  onClick,
  dataOnboarding,
}: QuickActionProps) {
  return (
    <button
      type="button"
      data-onboarding={dataOnboarding}
      onClick={onClick}
      className="flex w-full items-center gap-3 sm:gap-4 rounded-lg border border-border bg-card p-3 sm:p-4 text-left transition-all hover:border-primary/55 hover:bg-primary/[0.015] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {description}
        </p>
      </div>
      <ArrowRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{
    name: string;
    role?: string;
    persona?: string | null;
  }>();
  const { data: role } = usePermissions<string>({});
  const isAdmin = role === "platform_admin";
  const personaCopy = getPersonaCopy(identity?.persona);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiRequest<DashboardStats>("/analytics/dashboard-stats")
      .then((data) => {
        setStats(data);
      })
      .catch(() => {
        // silently fail — stats show 0 on error
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
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col">
      <div className="space-y-6 sm:space-y-8">
        {/* Welcome */}
        <div>
          <h1 className="text-base font-bold text-foreground tracking-tight">
            {greeting}，{identity?.name ?? "用户"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            欢迎使用智评线考试管理平台，这里是你的工作台
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {isAdmin ? (
            <>
              <StatCard
                title="考试数"
                value={stats?.total_exams ?? 0}
                loading={loading}
                icon={
                  <ClipboardList
                    size={22}
                    className="text-violet-600 dark:text-violet-400"
                  />
                }
                color="bg-violet-50 dark:bg-violet-950"
                onClick={() => navigate("/exams")}
              />
              <StatCard
                title="题目数"
                value={stats?.total_questions ?? 0}
                loading={loading}
                icon={
                  <BookOpen
                    size={22}
                    className="text-amber-600 dark:text-amber-400"
                  />
                }
                color="bg-amber-50 dark:bg-amber-950"
                onClick={() => navigate("/questions")}
              />
              <StatCard
                title="用户数"
                value={stats?.total_users ?? 0}
                loading={loading}
                icon={
                  <Users
                    size={22}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                }
                color="bg-emerald-50 dark:bg-emerald-950"
                onClick={() => navigate("/users")}
              />
              <StatCard
                title="岗位数"
                value={stats?.total_jobs ?? 0}
                loading={loading}
                icon={
                  <Briefcase
                    size={22}
                    className="text-sky-600 dark:text-sky-400"
                  />
                }
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
                icon={
                  <ClipboardList
                    size={22}
                    className="text-violet-600 dark:text-violet-400"
                  />
                }
                color="bg-violet-50 dark:bg-violet-950"
                onClick={() => navigate("/exams/students")}
              />
              <StatCard
                title="待阅卷"
                value={stats?.pending_grading ?? 0}
                loading={loading}
                icon={
                  <FileCheck
                    size={22}
                    className="text-amber-600 dark:text-amber-400"
                  />
                }
                color="bg-amber-50 dark:bg-amber-950"
                onClick={() => navigate("/grading")}
              />
              <StatCard
                title="考试/练习数"
                value={stats?.total_exams ?? 0}
                loading={loading}
                icon={
                  <ClipboardList
                    size={22}
                    className="text-sky-600 dark:text-sky-400"
                  />
                }
                color="bg-sky-50 dark:bg-sky-950"
                onClick={() => navigate("/exams")}
              />
              <StatCard
                title="题目数"
                value={stats?.total_questions ?? 0}
                loading={loading}
                icon={
                  <BookOpen
                    size={22}
                    className="text-indigo-600 dark:text-indigo-400"
                  />
                }
                color="bg-indigo-50 dark:bg-indigo-950"
                onClick={() => navigate("/questions")}
              />
            </>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            快捷操作
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
            {isAdmin ? (
              <>
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
                  description="管理平台所有用户与角色"
                  icon={<UserCog size={18} />}
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
                <QuickAction
                  title="岗位管理"
                  description="管理岗位模型与能力体系"
                  icon={<Briefcase size={18} />}
                  onClick={() => navigate("/gwmx/job-models")}
                />
              </>
            ) : (
              <>
                <QuickAction
                  title={personaCopy.management}
                  description={`管理${personaCopy.person}账号、${personaCopy.group}与导入数据`}
                  icon={<Users size={18} />}
                  onClick={() => navigate("/students")}
                  dataOnboarding="qa-students"
                />
                <QuickAction
                  title="我的课程"
                  description="维护课程知识点、资料、考试与练习"
                  icon={<LibraryBig size={18} />}
                  onClick={() => navigate("/courses")}
                />
                <QuickAction
                  title="创建课程"
                  description="新建一门课程，开始组织资料与题目"
                  icon={<Plus size={18} />}
                  onClick={() =>
                    navigate("/courses", { state: { create: true } })
                  }
                />
                <QuickAction
                  title="导入题目"
                  description="从文档识别并导入题目"
                  icon={<Upload size={18} />}
                  onClick={() => navigate("/questions/import")}
                />
                <QuickAction
                  title="考试阅卷"
                  description="处理待阅卷试卷与评分确认"
                  icon={<FileCheck size={18} />}
                  onClick={() => navigate("/grading")}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <footer
        className="mt-auto flex justify-center pt-8"
        aria-label="网站备案信息"
      >
        <IcpRecordLink />
      </footer>
    </div>
  );
}
