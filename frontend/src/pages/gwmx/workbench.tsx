import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useGetIdentity } from "@refinedev/core"
import { Briefcase, Sparkles, ArrowRight, Clock, GitBranch, Factory, ClipboardList } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { IcpRecordLink } from "@/components/icp-record-link"
import { Card, CardContent } from "@/components/ui/card"
import { getCurrentOrgType, getCurrentRoles } from "@/lib/current-user"
import { normalizeJobModelsResponse } from "@/pages/job-models/list-utils"

interface JobModel {
  id: string
  current_version_id?: string | null
  job_role: string
  model_type?: string
  industry_name?: string | null
  direction_name?: string | null
  current_version?: { id: string; version?: number } | null
  updated_at: string
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return "夜深了"
  if (h < 12) return "早上好"
  if (h < 14) return "中午好"
  if (h < 18) return "下午好"
  return "晚上好"
}

function authHeaders() {
  const token = localStorage.getItem("access_token")
  return { Authorization: `Bearer ${token}` }
}

export function GwmxWorkbench() {
  const navigate = useNavigate()
  const { data: identity } = useGetIdentity<{ name: string }>()
  const [models, setModels] = useState<JobModel[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const roles = getCurrentRoles()
  const showRecruitment = getCurrentOrgType() === "enterprise" &&
    roles.some((role) => ["evaluator", "enterprise_admin", "platform_admin"].includes(role))

  useEffect(() => {
    fetch("/api/job-models/models?_start=0&_end=10000", { headers: authHeaders() })
      .then(async (res) => {
        const header = res.headers.get("X-Total-Count")
        const list = normalizeJobModelsResponse<JobModel>(await res.json())
        setModels(list)
        setTotal(header ? Number(header) : list.length)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const industryCount = new Set(
    models.map((m) => m.industry_name).filter((n): n is string => !!n),
  ).size
  const recent = [...models]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col">
      <div className="space-y-6">
        <div>
          <h1 className="text-base font-bold text-foreground tracking-tight">
            {greeting()}，{identity?.name ?? "用户"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            欢迎使用工教桥岗位能力建模平台，这里是你的工作台
          </p>
        </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="岗位模型总数"
          value={loading ? null : total}
          icon={<Briefcase size={22} className="text-violet-600 dark:text-violet-400" />}
          color="bg-violet-50 dark:bg-violet-950"
          onClick={() => navigate("/gwmx/job-models")}
        />
        <StatCard
          title="涉及产业数"
          value={loading ? null : industryCount}
          icon={<Factory size={22} className="text-amber-600 dark:text-amber-400" />}
          color="bg-amber-50 dark:bg-amber-950"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">最近编辑的岗位</h2>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => navigate("/gwmx/job-models")}
            >
              全部岗位 <ArrowRight className="inline h-3 w-3" />
            </button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有岗位，从"企业快速生成"开始。</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!m.current_version_id) return
                      navigate(
                        `/gwmx/job-models/${m.id}/versions/${m.current_version_id}/editor`,
                      )
                    }}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.02]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {m.job_role}
                        </span>
                        <TypeTag modelType={m.model_type} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" />v{m.current_version?.version ?? 1}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(m.updated_at), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </span>
                        {(m.industry_name || m.direction_name) && (
                          <span className="truncate">
                            {[m.industry_name, m.direction_name].filter(Boolean).join(" / ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">快捷操作</h2>
          <div className="space-y-2">
            <QuickAction
              title="企业快速生成"
              description="输入 JD 或上传说明书，AI 推荐并定制岗位"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => navigate("/gwmx/job-models/fast-create")}
            />
            <QuickAction
              title="我的岗位"
              description="查看、筛选、编辑所有岗位模型"
              icon={<Briefcase className="h-4 w-4" />}
              onClick={() => navigate("/gwmx/job-models")}
            />
            {showRecruitment ? (
              <QuickAction
                title="招聘考试"
                description="发布招聘笔试，邀请外部候选人"
                icon={<ClipboardList className="h-4 w-4" />}
                onClick={() => navigate("/exams")}
              />
            ) : null}
          </div>
        </section>
      </div>

      </div>

      <footer className="mt-auto flex justify-center pt-8" aria-label="网站备案信息">
        <IcpRecordLink />
      </footer>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  color,
  onClick,
}: {
  title: string
  value: number | null
  icon: React.ReactNode
  color: string
  onClick?: () => void
}) {
  return (
    <Card
      className={
        onClick ? "cursor-pointer transition-all hover:border-foreground/40 hover:shadow-sm" : ""
      }
      onClick={onClick}
    >
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {value === null ? (
              <div className="mt-1 h-9 w-16 animate-pulse rounded-md bg-muted" />
            ) : (
              <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
            )}
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickAction({
  title,
  description,
  icon,
  onClick,
}: {
  title: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-left transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function TypeTag({ modelType }: { modelType?: string }) {
  const isEnterprise = modelType === "enterprise"
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isEnterprise
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          : "bg-primary/10 text-primary"
      }`}
    >
      {isEnterprise ? "企业" : "标准"}
    </span>
  )
}
