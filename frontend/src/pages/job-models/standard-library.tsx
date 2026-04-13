import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, Layers, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { normalizeJobModelsResponse } from "./list-utils"

type StandardModel = {
  id: string
  current_version_id?: string | null
  job_role: string
  industry_name?: string
  direction_name?: string
  current_version?: {
    id: string
    version_note?: string | null
    source_type?: string
  } | null
}

export function StandardLibraryPage() {
  const navigate = useNavigate()
  const [models, setModels] = useState<StandardModel[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    fetch("/api/job-models/models?_start=0&_end=50&model_type=standard", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((res) => res.json())
      .then((data) => {
        setModels(normalizeJobModelsResponse<StandardModel>(data))
        setIsLoading(false)
      })
      .catch(() => {
        setModels([])
        setIsLoading(false)
      })
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge className="gap-1 border-0 bg-primary/10 text-primary">
              <Layers className="h-3 w-3" />
              标准岗位库
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3 w-3" />
              1650 分类框架
            </Badge>
          </div>
          <h1 className="text-base font-bold text-foreground">标准岗位库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按产业、方向和岗位浏览平台标准模型，并作为企业快速生成的基底
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/gwmx/job-models")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回岗位模型
          </Button>
          <Button onClick={() => navigate("/gwmx/job-models/fast-create")}>
            <ArrowRight className="mr-2 h-4 w-4" />
            企业快速生成
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm animate-pulse"
            >
              <div className="h-4 w-20 rounded bg-muted" />
              <div className="mt-4 h-5 w-32 rounded bg-muted" />
              <div className="mt-3 h-4 w-full rounded bg-muted" />
              <div className="mt-2 h-4 w-4/5 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Layers className="h-7 w-7" />
            </div>
            <h2 className="text-base font-semibold text-foreground">还没有标准岗位模型</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              先通过“创建标准岗位模型”或标准岗位 seed 脚本写入真实数据。
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button onClick={() => navigate("/gwmx/job-models/create")}>创建标准岗位模型</Button>
              <Button variant="outline" onClick={() => navigate("/gwmx/job-models")}>
                返回岗位模型
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {models.map((model) => (
            <div
              key={model.id}
              className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant="outline" className="mb-3">
                    {model.industry_name ?? "标准岗位"}
                  </Badge>
                  <h2 className="text-base font-semibold text-foreground">{model.job_role}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {model.current_version?.version_note ?? "平台标准岗位模型，可作为企业快速生成的基底。"}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
                <span className="text-xs text-muted-foreground">
                  方向：{model.direction_name ?? "待补充"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => {
                      if (!model.current_version_id) return
                      navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
                    }}
                  >
                    查看详情
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => navigate("/gwmx/job-models/fast-create")}
                  >
                    用于企业生成
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
