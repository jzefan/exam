import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { normalizeJobModelsResponse } from "./list-utils"
import {
  Edit2,
  Layers,
  GitBranch,
  Clock,
  Briefcase,
  Sparkles,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"

interface JobModel {
  id: string
  current_version_id?: string | null
  job_role: string
  current_version?: {
    id: string
    version: number
    version_note: string | null
    is_current: boolean
    source_type: string
  } | null
  created_at: string
  updated_at: string
}

export function JobModelList() {
  const navigate = useNavigate()
  const [models, setModels] = useState<JobModel[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const renderEntryActions = () => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => navigate("/gwmx/job-models/standard-library")}
      >
        <Layers className="mr-2 h-4 w-4" />
        标准岗位库
      </Button>
      <Button onClick={() => navigate("/gwmx/job-models/fast-create")}>
        <Sparkles className="mr-2 h-4 w-4" />
        企业快速生成
      </Button>
    </div>
  )

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    fetch("/api/job-models/models?_start=0&_end=20", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setModels(normalizeJobModelsResponse(data))
        setIsLoading(false)
      })
      .catch((err) => {
        console.error("Failed to load models:", err)
        setIsLoading(false)
      })
  }, [])

  const getSourceBadge = (sourceType: string) => {
    switch (sourceType) {
      case "ai_generated":
        return (
          <Badge className="bg-primary/10 text-primary border-0 gap-1">
            <Sparkles className="h-3 w-3" />
            AI 生成
          </Badge>
        )
      case "template":
        return (
          <Badge className="bg-violet-500/10 text-violet-600 border-0 gap-1">
            <Layers className="h-3 w-3" />
            模板
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-foreground gap-1">
            <Edit2 className="h-3 w-3" />
            手动创建
          </Badge>
        )
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-bold text-foreground">岗位模型管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">标准岗位库与企业快速生成统一入口</p>
          </div>
          {renderEntryActions()}
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-[var(--radius)] border border-border bg-card p-5 animate-pulse"
            >
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-[var(--radius)] bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-muted rounded" />
                  <div className="h-3 w-32 bg-muted rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-bold text-foreground">岗位模型管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">标准岗位库与企业快速生成统一入口</p>
          </div>
          {renderEntryActions()}
        </div>

        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6">
          <div className="flex flex-col items-center py-14 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <Briefcase className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              还没有模型，先从标准岗位库开始
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
              进入标准岗位库浏览平台标准岗位，再通过企业快速生成创建你的企业版岗位模型。
            </p>
            <div className="mt-8">{renderEntryActions()}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-foreground">岗位模型管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            标准岗位库与企业快速生成统一入口，共 {models.length} 个模型
          </p>
        </div>
        {renderEntryActions()}
      </div>

      {/* Model Cards */}
      <div className="grid gap-3">
        {models.map((model) => (
          <div
            key={model.id}
            className="group rounded-[var(--radius)] border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-md cursor-pointer"
            onClick={() => {
              if (!model.current_version_id) return
              navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
            }}
          >
            <div className="flex items-center gap-4">
              {/* Icon */}
              <div className="h-11 w-11 rounded-[var(--radius)] bg-primary/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary/15">
                <Briefcase className="h-5 w-5 text-primary" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-semibold text-foreground truncate">
                    {model.job_role}
                  </h3>
                  {getSourceBadge(model.current_version?.source_type ?? "manual")}
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-xs text-foreground/70">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" />
                    v{model.current_version?.version ?? 1}
                  </span>
                  {model.current_version?.version_note && (
                    <span className="truncate max-w-[200px]">
                      {model.current_version.version_note}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDistanceToNow(new Date(model.updated_at), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </span>
                </div>
              </div>

              {/* Action */}
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!model.current_version_id) return
                  navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
                }}
              >
                <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                编辑
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
