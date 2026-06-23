import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ChevronDown, ChevronRight, Save, Sparkles, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageIntroHeader } from "@/components/ui/page-intro-header"
import { cn } from "@/lib/utils"
import { fetchGraphOverview, saveGraphLayout } from "./graph-api"
import { buildFocusedJobLayout } from "./graph-layout"
import type {
  CourseCard,
  GraphLayoutSnapshot,
  JobCard,
  JobModelGraphOverview,
  SkillCard,
} from "./types"

type Detail =
  | { type: "job"; id: string }
  | { type: "course"; id: string }
  | null

type FlowNodeData = {
  kind: "job" | "skill" | "course"
  card: JobCard | SkillCard | CourseCard
  label: string
  selected: boolean
  muted: boolean
}

const HANDLE_CLASS = "!h-1.5 !w-1.5 !min-w-0 !border-0"

function pill(value: string | null | undefined, fallback = "未分类") {
  return value?.trim() || fallback
}

/* ----------------------------- node renderers ----------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{children}</p>
}

function Meta({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 truncate text-[11px] text-muted-foreground">{children}</p>
}

function selectableClass(selected: boolean, muted: boolean) {
  return cn(
    "w-[248px] cursor-pointer rounded-[var(--radius)] border bg-card px-3.5 py-3 transition-all hover:border-primary/40 hover:shadow-sm",
    selected ? "border-primary bg-primary/[0.04] shadow-sm ring-1 ring-primary/20" : "border-border",
    muted && "opacity-40",
  )
}

function JobNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData
  const job = d.card as JobCard
  return (
    <div className={selectableClass(d.selected, d.muted)}>
      <Eyebrow>
        {pill(job.industry_name)} / {pill(job.direction_name)}
      </Eyebrow>
      <Title>{job.job_role}</Title>
      <Meta>
        v{job.version} · {job.skill_count} 项技能 · {job.model_type === "enterprise" ? "企业" : "标准"}
      </Meta>
      <Handle type="source" position={Position.Right} className={cn(HANDLE_CLASS, "!bg-primary/50")} />
    </div>
  )
}

function SkillNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData
  const skill = d.card as SkillCard
  return (
    <div className="w-[240px] rounded-[var(--radius)] border border-border/60 bg-muted/50 px-3.5 py-3">
      <Handle type="target" position={Position.Left} className={cn(HANDLE_CLASS, "!bg-muted-foreground/40")} />
      <Eyebrow>{pill(skill.dimension_name, "未分维度")}</Eyebrow>
      <Title>{skill.name}</Title>
      <Meta>
        {skill.level || "未定级"} · {skill.knowledge_point_count} 知识点 · {skill.course_mapping_count} 课程
      </Meta>
      <Handle type="source" position={Position.Right} className={cn(HANDLE_CLASS, "!bg-muted-foreground/40")} />
    </div>
  )
}

function CourseNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData
  const course = d.card as CourseCard
  return (
    <div className={selectableClass(d.selected, d.muted)}>
      <Handle type="target" position={Position.Left} className={cn(HANDLE_CLASS, "!bg-primary/40")} />
      <Eyebrow>
        {pill(course.major_name)} / {pill(course.direction_name)}
      </Eyebrow>
      <Title>{course.name}</Title>
      <Meta>
        {course.child_knowledge_point_count} 知识点 · {course.mapped_skill_count} 技能 · {course.resource_count} 资源
      </Meta>
    </div>
  )
}

const nodeTypes = { jobNode: JobNode, skillNode: SkillNode, courseNode: CourseNode }

/* ------------------------------- job tree -------------------------------- */

type JobGroup = {
  industry: string
  directions: { direction: string; jobs: JobCard[] }[]
}

function groupJobs(jobs: JobCard[]): JobGroup[] {
  const byIndustry = new Map<string, Map<string, JobCard[]>>()
  for (const job of jobs) {
    const industry = pill(job.industry_name)
    const direction = pill(job.direction_name)
    if (!byIndustry.has(industry)) byIndustry.set(industry, new Map())
    const byDirection = byIndustry.get(industry)!
    if (!byDirection.has(direction)) byDirection.set(direction, [])
    byDirection.get(direction)!.push(job)
  }
  return Array.from(byIndustry.entries())
    .map(([industry, byDirection]) => ({
      industry,
      directions: Array.from(byDirection.entries())
        .map(([direction, items]) => ({ direction, jobs: items }))
        .sort((a, b) => a.direction.localeCompare(b.direction, "zh-CN")),
    }))
    .sort((a, b) => a.industry.localeCompare(b.industry, "zh-CN"))
}

function JobTree({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: JobCard[]
  selectedJobId: string | null
  onSelect: (jobId: string) => void
}) {
  const groups = useMemo(() => groupJobs(jobs), [jobs])
  // Open the focused job's branch by default. Users always pick jobs from an
  // already-open branch, so no further auto-expansion is needed.
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(() => {
    const job = jobs.find((item) => item.id === selectedJobId)
    return new Set(job ? [pill(job.industry_name)] : [])
  })
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(() => {
    const job = jobs.find((item) => item.id === selectedJobId)
    return new Set(job ? [`${pill(job.industry_name)}::${pill(job.direction_name)}`] : [])
  })

  const toggle = (set: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(next)
  }

  return (
    <div className="space-y-0.5 p-2" data-testid="job-tree">
      {groups.map((group) => {
        const industryOpen = expandedIndustries.has(group.industry)
        const jobCount = group.directions.reduce((sum, dir) => sum + dir.jobs.length, 0)
        return (
          <div key={group.industry}>
            <button
              type="button"
              onClick={() => toggle(expandedIndustries, group.industry, setExpandedIndustries)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted"
            >
              {industryOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{group.industry}</span>
              <span className="text-xs text-muted-foreground">{jobCount}</span>
            </button>

            {industryOpen
              ? group.directions.map((dir) => {
                  const key = `${group.industry}::${dir.direction}`
                  const directionOpen = expandedDirections.has(key)
                  return (
                    <div key={key} className="ml-3">
                      <button
                        type="button"
                        onClick={() => toggle(expandedDirections, key, setExpandedDirections)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                      >
                        {directionOpen ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        <span className="flex-1 truncate">{dir.direction}</span>
                        <span>{dir.jobs.length}</span>
                      </button>

                      {directionOpen ? (
                        <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                          {dir.jobs.map((job) => (
                            <button
                              key={job.id}
                              type="button"
                              onClick={() => onSelect(job.id)}
                              className={cn(
                                "block w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                job.id === selectedJobId
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-foreground/80 hover:bg-muted",
                              )}
                            >
                              {job.job_role}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              : null}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------ flow builder ----------------------------- */

function buildFlow(
  overview: JobModelGraphOverview,
  selectedJobId: string | null,
  detail: Detail,
  layout: GraphLayoutSnapshot | null,
): { nodes: Node[]; edges: Edge[] } {
  const graph = buildFocusedJobLayout(overview, {
    jobId: selectedJobId,
    selectedCourseId: detail?.type === "course" ? detail.id : null,
    layout,
  })

  const nodes: Node[] = graph.nodes.map((node) => {
    const selected =
      (detail?.type === "job" && node.kind === "job" && (node.data as JobCard).id === detail.id) ||
      (detail?.type === "course" && node.kind === "course" && (node.data as CourseCard).id === detail.id)
    const label =
      node.kind === "job"
        ? (node.data as JobCard).job_role
        : node.kind === "course"
          ? (node.data as CourseCard).name
          : (node.data as SkillCard).name
    return {
      id: node.id,
      type: `${node.kind}Node`,
      position: node.position,
      data: { kind: node.kind, card: node.data, label, selected, muted: node.muted } satisfies FlowNodeData,
      draggable: true,
    }
  })

  const edges: Edge[] = graph.edges.map((edge) => {
    const isMapping = edge.kind === "skill-course"
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: {
        stroke: isMapping ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
        strokeWidth: 1.5,
        strokeOpacity: isMapping ? 0.5 : 0.35,
        strokeDasharray: isMapping ? "6 6" : undefined,
      },
    }
  })

  return { nodes, edges }
}

/* ------------------------------ detail panel ----------------------------- */

function DetailStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-2.5 text-center">
      <p className="text-base font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function DetailPanel({
  overview,
  detail,
}: {
  overview: JobModelGraphOverview | null
  detail: Detail
}) {
  const panelClass =
    "flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4"

  if (!overview || !detail) {
    return (
      <aside className={panelClass}>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">详情</p>
        <h2 className="text-sm font-semibold text-foreground">选择一个节点</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          在左侧选择岗位，或点击画布上的课程，查看技能、知识点与映射关系。
        </p>
      </aside>
    )
  }

  if (detail.type === "job") {
    const job = overview.jobs.find((item) => item.id === detail.id)
    const skills = overview.skills.filter((skill) => skill.job_model_id === detail.id)
    if (!job) return null

    return (
      <aside className={panelClass}>
        <header className="space-y-1">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            岗位详情
          </h2>
          <p className="text-base font-semibold leading-snug text-foreground">{job.job_role}</p>
          <p className="text-xs text-muted-foreground">
            {pill(job.industry_name)} / {pill(job.direction_name)} · v{job.version} · {job.status}
          </p>
        </header>
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.id} className="rounded-md border border-border bg-muted/40 p-2.5">
              <p className="text-sm font-medium text-foreground">{skill.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {pill(skill.dimension_name, "未分维度")} · {skill.level || "未定级"} · {skill.knowledge_point_count} 知识点
              </p>
            </div>
          ))}
        </div>
      </aside>
    )
  }

  const course = overview.courses.find((item) => item.id === detail.id)
  if (!course) return null

  return (
    <aside className={panelClass}>
      <header className="space-y-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          课程详情
        </h2>
        <p className="text-base font-semibold leading-snug text-foreground">{course.name}</p>
        <p className="text-xs text-muted-foreground">
          {pill(course.major_name)} / {pill(course.direction_name)}
        </p>
      </header>
      <div className="grid grid-cols-3 gap-2">
        <DetailStat value={course.child_knowledge_point_count} label="知识点" />
        <DetailStat value={course.mapped_skill_count} label="映射技能" />
        <DetailStat value={course.resource_count} label="资源" />
      </div>
    </aside>
  )
}

/* ------------------------------- workspace ------------------------------- */

export function JobModelGraphWorkspace() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<JobModelGraphOverview | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [autoLayout, setAutoLayout] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchGraphOverview(controller.signal)
      .then((data) => {
        setOverview(data)
        const first = data.jobs[0]
        if (first) {
          setSelectedJobId(first.id)
          setDetail({ type: "job", id: first.id })
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setError(err instanceof Error ? err.message : "图谱加载失败")
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [])

  const flow = useMemo(
    () =>
      overview
        ? buildFlow(overview, selectedJobId, detail, autoLayout ? null : overview.layout ?? null)
        : { nodes: [] as Node[], edges: [] as Edge[] },
    [overview, selectedJobId, detail, autoLayout],
  )

  useEffect(() => {
    setNodes(flow.nodes)
    setEdges(flow.edges)
  }, [flow, setNodes, setEdges])

  // Re-frame the canvas whenever the focused job changes (it's a fresh subgraph).
  useEffect(() => {
    if (!instance || !selectedJobId) return
    const timer = setTimeout(() => instance.fitView({ padding: 0.25, maxZoom: 1, duration: 300 }), 80)
    return () => clearTimeout(timer)
  }, [instance, selectedJobId])

  const handleSelectJob = useCallback((jobId: string) => {
    setSelectedJobId(jobId)
    setDetail({ type: "job", id: jobId })
  }, [])

  const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    const d = node.data as unknown as FlowNodeData
    if (d.kind === "job") setDetail({ type: "job", id: (d.card as JobCard).id })
    else if (d.kind === "course") setDetail({ type: "course", id: (d.card as CourseCard).id })
  }, [])

  const handleSaveLayout = useCallback(async () => {
    const scope = overview?.layout_scope
    if (!scope) return
    setSaveMessage(null)
    const nodePositions = Object.fromEntries(
      nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
    )
    try {
      await saveGraphLayout(scope.scope_type, scope.scope_id, {
        nodes: nodePositions,
        viewport: instance?.getViewport(),
      })
      setSaveMessage("布局已保存")
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "保存失败")
    }
  }, [instance, nodes, overview])

  const handleAutoLayout = useCallback(() => {
    setAutoLayout(true)
    requestAnimationFrame(() => instance?.fitView({ padding: 0.25, maxZoom: 1, duration: 300 }))
  }, [instance])

  return (
    <div className="flex h-full flex-col">
      <PageIntroHeader
        embedded
        title="岗位-课程图谱"
        description="在同一张工作台里查看岗位能力、课程知识点与技能映射关系。"
        onBack={() => navigate("/gwmx/job-models")}
        backLabel="返回岗位列表"
        actions={
          <Button
            className="h-9 w-fit shrink-0 px-4 font-medium"
            onClick={() => navigate("/gwmx/job-models/fast-create")}
          >
            <Sparkles size={16} className="mr-1.5" />
            企业快速生成
          </Button>
        }
      />

      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card">
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <p className="text-sm font-semibold text-foreground">岗位分类</p>
            <p className="mt-0.5 text-xs text-muted-foreground">按产业与方向浏览，选择查看图谱</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {overview ? (
              <JobTree jobs={overview.jobs} selectedJobId={selectedJobId} onSelect={handleSelectJob} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">加载中…</p>
            )}
          </div>
        </aside>

        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute left-4 top-3 z-10 text-xs font-medium text-muted-foreground">
            岗位能力 · 技能 · 课程映射
          </div>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {saveMessage ? (
              <span className="text-xs font-medium text-primary">{saveMessage}</span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-background/90 backdrop-blur"
              onClick={handleSaveLayout}
            >
              <Save size={14} className="mr-1.5" />
              保存布局
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-background/90 backdrop-blur"
              onClick={handleAutoLayout}
            >
              <Wand2 size={14} className="mr-1.5" />
              自动排版
            </Button>
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onInit={(inst) => setInstance(inst)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.5}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="hsl(var(--border))" />
            <Controls showInteractive={false} />
          </ReactFlow>

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              正在加载图谱…
            </div>
          ) : null}
        </div>

        <DetailPanel overview={overview} detail={detail} />
      </div>
    </div>
  )
}

export default JobModelGraphWorkspace
