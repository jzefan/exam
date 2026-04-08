import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { normalizeJobModelsResponse } from "./list-utils"
import {
  Plus,
  Edit2,
  Wand2,
  Layers,
  GitBranch,
  Clock,
  Briefcase,
  Sparkles,
  FileUp,
  ArrowRight,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"

interface JobModel {
  id: string
  project_id: string
  job_role: string
  version: number
  version_note: string | null
  is_current: boolean
  source_type: string
  created_at: string
  updated_at: string
}

export function JobModelList() {
  const navigate = useNavigate()
  const [models, setModels] = useState<JobModel[]>([])
  const [isLoading, setIsLoading] = useState(true)

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
        <div className="flex justify-between items-center">
          <h1 className="text-base font-bold text-foreground">职位能力模型</h1>
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
        <div className="flex justify-between items-center">
          <h1 className="text-base font-bold text-foreground">职位能力模型</h1>
        </div>

        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card">
          <div className="flex flex-col items-center py-16 px-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <Briefcase className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              还没有职位能力模型
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md text-center">
              创建职位能力模型来定义岗位所需的能力维度、核心技能和知识点
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 w-full max-w-lg">
              <button
                onClick={() => navigate("/gwmx/job-models/upload-ai")}
                className="group relative rounded-[var(--radius)] border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div className="h-10 w-10 rounded-[var(--radius)] bg-primary/10 flex items-center justify-center mb-3">
                  <FileUp className="h-5 w-5 text-primary" />
                </div>
                <p className="font-semibold text-foreground">AI 自动生成</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  上传职位描述文档，AI 自动分析并生成能力模型
                </p>
                <ArrowRight className="absolute top-5 right-4 h-4 w-4 text-muted-foreground/50 opacity-0 transition-all group-hover:opacity-100 group-hover:text-primary" />
              </button>

              <button
                onClick={() => navigate("/gwmx/job-models/create")}
                className="group relative rounded-[var(--radius)] border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div className="h-10 w-10 rounded-[var(--radius)] bg-primary/10 flex items-center justify-center mb-3">
                  <Plus className="h-5 w-5 text-primary" />
                </div>
                <p className="font-semibold text-foreground">手动创建</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  手工输入职位信息，在编辑器中构建能力模型
                </p>
                <ArrowRight className="absolute top-5 right-4 h-4 w-4 text-muted-foreground/50 opacity-0 transition-all group-hover:opacity-100 group-hover:text-primary" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-base font-bold text-foreground">职位能力模型</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {models.length} 个模型
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/gwmx/job-models/upload-ai")}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            AI 生成
          </Button>
          <Button onClick={() => navigate("/gwmx/job-models/create")}>
            <Plus className="mr-2 h-4 w-4" />
            新建模型
          </Button>
        </div>
      </div>

      {/* Model Cards */}
      <div className="grid gap-3">
        {models.map((model) => (
          <div
            key={model.id}
            className="group rounded-[var(--radius)] border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-md cursor-pointer"
            onClick={() =>
              navigate(
                `/gwmx/job-models/${model.project_id}/models/${model.id}/editor`
              )
            }
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
                  {getSourceBadge(model.source_type)}
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-xs text-foreground/70">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" />
                    v{model.version}
                  </span>
                  {model.version_note && (
                    <span className="truncate max-w-[200px]">
                      {model.version_note}
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
                  navigate(
                    `/gwmx/job-models/${model.project_id}/models/${model.id}/editor`
                  )
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
