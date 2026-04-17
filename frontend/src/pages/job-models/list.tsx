import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { normalizeJobModelsResponse } from "./list-utils"
import {
  Edit2,
  Layers,
  GitBranch,
  Clock,
  Briefcase,
  Sparkles,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  List,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { cn } from "@/lib/utils"

interface JobModel {
  id: string
  current_version_id?: string | null
  job_role: string
  industry_name?: string | null
  direction_name?: string | null
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

interface IndustryNode {
  name: string
  directions: string[]
}

type ViewMode = "list" | "card"

const VIEW_MODE_STORAGE_KEY = "job-models:view-mode"

function getViewModeFromStorage(): ViewMode {
  if (typeof window === "undefined") return "list"
  const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
  return saved === "card" ? "card" : "list"
}

export function JobModelList() {
  const navigate = useNavigate()
  const [models, setModels] = useState<JobModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null)
  const [selectedDirection, setSelectedDirection] = useState<string | null>(null)
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>(() => getViewModeFromStorage())

  useEffect(() => {
    const token = localStorage.getItem("access_token")
    fetch("/api/job-models/models?_start=0&_end=200", {
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

  // Build industry tree from models
  const industryTree = models.reduce((acc, model) => {
    const industry = model.industry_name || "未分类"
    const direction = model.direction_name || "未分类"

    if (!acc[industry]) {
      acc[industry] = new Set<string>()
    }
    acc[industry].add(direction)

    return acc
  }, {} as Record<string, Set<string>>)

  const industries: IndustryNode[] = Object.entries(industryTree).map(([name, directions]) => ({
    name,
    directions: Array.from(directions).sort(),
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // Filter models by selected direction
  const filteredModels = selectedDirection
    ? models.filter(m =>
        (m.industry_name || "未分类") === selectedIndustry &&
        (m.direction_name || "未分类") === selectedDirection
      )
    : models

  const toggleIndustry = (industryName: string) => {
    const newExpanded = new Set(expandedIndustries)
    if (newExpanded.has(industryName)) {
      newExpanded.delete(industryName)
    } else {
      newExpanded.add(industryName)
    }
    setExpandedIndustries(newExpanded)
  }

  const selectDirection = (industryName: string, directionName: string) => {
    setSelectedIndustry(industryName)
    setSelectedDirection(directionName)
    if (!expandedIndustries.has(industryName)) {
      setExpandedIndustries(new Set([...expandedIndustries, industryName]))
    }
  }

  const clearSelection = () => {
    setSelectedIndustry(null)
    setSelectedDirection(null)
  }

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    }
  }

  const renderEntryActions = () => (
    <div className="flex flex-wrap gap-2">
      <div className="inline-flex items-center rounded-lg border border-border bg-background p-1">
        <Button
          variant={viewMode === "list" ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 px-3"
          onClick={() => handleViewModeChange("list")}
        >
          <List className="h-4 w-4" />
          列表
        </Button>
        <Button
          variant={viewMode === "card" ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 px-3"
          onClick={() => handleViewModeChange("card")}
        >
          <LayoutGrid className="h-4 w-4" />
          卡片
        </Button>
      </div>
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

      {/* Left-Right Layout */}
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Left: Industry & Direction Tree */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">产业与方向</h2>
            {selectedDirection && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="h-7 text-xs"
              >
                清除筛选
              </Button>
            )}
          </div>
          <div className="space-y-1">
            {industries.map((industry) => (
              <div key={industry.name}>
                {/* Industry */}
                <button
                  onClick={() => toggleIndustry(industry.name)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                    "hover:bg-muted",
                    selectedIndustry === industry.name && !selectedDirection
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground"
                  )}
                >
                  {expandedIndustries.has(industry.name) ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{industry.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {industry.directions.length}
                  </span>
                </button>

                {/* Directions */}
                {expandedIndustries.has(industry.name) && (
                  <div className="ml-6 mt-1 space-y-1">
                    {industry.directions.map((direction) => (
                      <button
                        key={direction}
                        onClick={() => selectDirection(industry.name, direction)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors",
                          "hover:bg-muted",
                          selectedIndustry === industry.name &&
                            selectedDirection === direction
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground/80"
                        )}
                      >
                        <span className="truncate">{direction}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {models.filter(
                            (m) =>
                              (m.industry_name || "未分类") === industry.name &&
                              (m.direction_name || "未分类") === direction
                          ).length}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Model Cards */}
        <div className="space-y-3">
          {selectedDirection && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{selectedIndustry}</span>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground font-medium">{selectedDirection}</span>
              <span className="ml-2">({filteredModels.length} 个岗位)</span>
            </div>
          )}
          {viewMode === "card" ? (
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {filteredModels.map((model) => {
                return (
                  <div
                    key={model.id}
                    className="group min-h-[152px] rounded-[var(--radius)] border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-md cursor-pointer"
                    onClick={() => {
                      if (!model.current_version_id) return
                      navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
                    }}
                  >
                    <div className="flex h-full items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                        <Briefcase className="h-5 w-5" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <h3 className="truncate text-sm font-semibold text-foreground">{model.job_role}</h3>
                            <p className="truncate text-xs text-muted-foreground">
                              {[model.industry_name, model.direction_name].filter(Boolean).join(" / ") || "未分类"}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
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
                        <div className="grid gap-1 text-xs text-foreground/70">
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-3.5 w-3.5 shrink-0" />
                            <span>v{model.current_version?.version ?? 1}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {formatDistanceToNow(new Date(model.updated_at), {
                                addSuffix: true,
                                locale: zhCN,
                            })}
                          </span>
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredModels.map((model) => (
                <div
                  key={model.id}
                  className="group rounded-[var(--radius)] border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-primary/[0.02] hover:shadow-md cursor-pointer"
                  onClick={() => {
                    if (!model.current_version_id) return
                    navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-11 w-11 rounded-[var(--radius)] bg-primary/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary/15">
                      <Briefcase className="h-5 w-5 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-foreground truncate">
                        {model.job_role}
                      </h3>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-foreground/70">
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3.5 w-3.5" />
                          v{model.current_version?.version ?? 1}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDistanceToNow(new Date(model.updated_at), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </span>
                      </div>
                    </div>

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
          )}
        </div>
      </div>
    </div>
  )
}
