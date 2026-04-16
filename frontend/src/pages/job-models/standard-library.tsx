import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Factory,
  Layers,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { normalizeJobModelsResponse } from "./list-utils"

type StandardModel = {
  id: string
  current_version_id?: string | null
  job_role: string
  job_family?: string | null
  industry_name?: string | null
  direction_name?: string | null
  current_version?: {
    id: string
    version_note?: string | null
    source_type?: string
  } | null
}

type IndustryGroup = {
  industry: string
  directions: {
    direction: string
    models: StandardModel[]
  }[]
}

function groupByIndustryDirection(models: StandardModel[]): IndustryGroup[] {
  const industryMap = new Map<string, Map<string, StandardModel[]>>()

  for (const model of models) {
    const industry = model.industry_name || "未分类"
    const direction = model.direction_name || "未分类"

    if (!industryMap.has(industry)) {
      industryMap.set(industry, new Map())
    }
    const dirMap = industryMap.get(industry)!
    if (!dirMap.has(direction)) {
      dirMap.set(direction, [])
    }
    dirMap.get(direction)!.push(model)
  }

  return Array.from(industryMap.entries()).map(([industry, dirMap]) => ({
    industry,
    directions: Array.from(dirMap.entries()).map(([direction, models]) => ({
      direction,
      models,
    })),
  }))
}

export function StandardLibraryPage() {
  const navigate = useNavigate()
  const [models, setModels] = useState<StandardModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set())
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set())

  const groups = useMemo(() => groupByIndustryDirection(models), [models])

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    fetch("/api/job-models/models?_start=0&_end=200&model_type=standard", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((res) => res.json())
      .then((data) => {
        const loaded = normalizeJobModelsResponse<StandardModel>(data)
        setModels(loaded)
        // Auto-expand all industries and directions
        const industries = new Set<string>()
        const directions = new Set<string>()
        for (const m of loaded) {
          industries.add(m.industry_name || "未分类")
          directions.add(`${m.industry_name || "未分类"}::${m.direction_name || "未分类"}`)
        }
        setExpandedIndustries(industries)
        setExpandedDirections(directions)
        setIsLoading(false)
      })
      .catch(() => {
        setModels([])
        setIsLoading(false)
      })
  }, [])

  const toggleIndustry = (industry: string) => {
    setExpandedIndustries((prev) => {
      const next = new Set(prev)
      if (next.has(industry)) {
        next.delete(industry)
      } else {
        next.add(industry)
      }
      return next
    })
  }

  const toggleDirection = (key: string) => {
    setExpandedDirections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge className="gap-1 border-0 bg-primary/10 text-primary">
              <Layers className="h-3 w-3" />
              标准岗位库
            </Badge>
          </div>
          <h1 className="text-base font-bold text-foreground">标准岗位库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按产业、方向和岗位浏览平台标准模型，共 {models.length} 个岗位
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
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-sm animate-pulse"
            >
              <div className="h-5 w-32 rounded bg-muted" />
              <div className="mt-4 h-4 w-48 rounded bg-muted" />
              <div className="mt-3 h-4 w-full rounded bg-muted" />
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
              先通过"创建标准岗位模型"或标准岗位 seed 脚本写入真实数据。
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
        <div className="space-y-3">
          {groups.map((group) => {
            const isIndustryExpanded = expandedIndustries.has(group.industry)
            const totalJobs = group.directions.reduce((sum, d) => sum + d.models.length, 0)

            return (
              <div
                key={group.industry}
                className="rounded-[var(--radius)] border border-border bg-card shadow-sm overflow-hidden"
              >
                {/* Industry header */}
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => toggleIndustry(group.industry)}
                >
                  {isIndustryExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Factory className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-foreground">{group.industry}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {group.directions.length} 个方向，{totalJobs} 个岗位
                    </span>
                  </div>
                </button>

                {/* Directions */}
                {isIndustryExpanded && (
                  <div className="border-t border-border/60">
                    {group.directions.map((dir) => {
                      const dirKey = `${group.industry}::${dir.direction}`
                      const isDirExpanded = expandedDirections.has(dirKey)

                      return (
                        <div key={dir.direction}>
                          {/* Direction header */}
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 pl-10 pr-5 py-3 text-left hover:bg-muted/30 transition-colors"
                            onClick={() => toggleDirection(dirKey)}
                          >
                            {isDirExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <Sparkles className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                            <span className="text-sm font-medium text-foreground">
                              {dir.direction}
                            </span>
                            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                              {dir.models.length}
                            </Badge>
                          </button>

                          {/* Job cards */}
                          {isDirExpanded && (
                            <div className="pl-[72px] pr-5 pb-3 space-y-2">
                              {dir.models.map((model) => (
                                <div
                                  key={model.id}
                                  className="group flex items-center gap-3 rounded-[var(--radius)] border border-border/60 bg-background px-4 py-3 transition-all hover:border-primary/30 hover:shadow-sm cursor-pointer"
                                  onClick={() => {
                                    if (!model.current_version_id) return
                                    navigate(
                                      `/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`
                                    )
                                  }}
                                >
                                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/60 shrink-0">
                                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-foreground">
                                      {model.job_role}
                                    </span>
                                    {model.job_family && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {model.job_family}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (!model.current_version_id) return
                                        navigate(
                                          `/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`
                                        )
                                      }}
                                    >
                                      查看详情
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        navigate("/gwmx/job-models/fast-create")
                                      }}
                                    >
                                      用于企业生成
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
