import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { fetchGraphOverview, saveGraphLayout } from "./graph-api"
import { buildGraphWorkspaceLayout, type GraphWorkspaceNode } from "./graph-layout"
import type { CourseCard, JobCard, JobModelGraphOverview, SkillCard } from "./types"
import { JobModelList } from "../list"
import "./workspace.css"

type Selection =
  | { type: "job"; id: string }
  | { type: "course"; id: string }
  | null

function pill(value: string | null | undefined, fallback = "未分类") {
  return value?.trim() || fallback
}

function isJobNode(node: GraphWorkspaceNode): node is GraphWorkspaceNode<JobCard> {
  return node.kind === "job"
}

function isSkillNode(node: GraphWorkspaceNode): node is GraphWorkspaceNode<SkillCard> {
  return node.kind === "skill"
}

function isCourseNode(node: GraphWorkspaceNode): node is GraphWorkspaceNode<CourseCard> {
  return node.kind === "course"
}

function getNodeClassName(node: GraphWorkspaceNode, selection: Selection) {
  const selected =
    (selection?.type === "job" && node.kind === "job" && node.data.id === selection.id) ||
    (selection?.type === "course" && node.kind === "course" && node.data.id === selection.id)

  return [
    "graph-card",
    `graph-card--${node.kind}`,
    node.muted ? "is-muted" : "",
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function JobCardButton({
  node,
  selection,
  onSelect,
}: {
  node: GraphWorkspaceNode<JobCard>
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const job = node.data
  return (
    <button
      type="button"
      className={getNodeClassName(node, selection)}
      style={{ left: node.position.x, top: node.position.y }}
      onClick={() => onSelect({ type: "job", id: job.id })}
    >
      <span className="graph-card__eyebrow">{pill(job.industry_name)} / {pill(job.direction_name)}</span>
      <strong>{job.job_role}</strong>
      <span className="graph-card__meta">
        v{job.version} · {job.skill_count} 项技能 · {job.model_type === "enterprise" ? "企业" : "标准"}
      </span>
    </button>
  )
}

function SkillCardView({ node }: { node: GraphWorkspaceNode<SkillCard> }) {
  const skill = node.data
  return (
    <div
      className={getNodeClassName(node, null)}
      style={{ left: node.position.x, top: node.position.y }}
    >
      <span className="graph-card__eyebrow">{pill(skill.dimension_name, "未分维度")}</span>
      <strong>{skill.name}</strong>
      <span className="graph-card__meta">
        {skill.level || "未定级"} · {skill.knowledge_point_count} 知识点 · {skill.course_mapping_count} 课程
      </span>
    </div>
  )
}

function CourseCardButton({
  node,
  selection,
  onSelect,
}: {
  node: GraphWorkspaceNode<CourseCard>
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const course = node.data
  return (
    <button
      type="button"
      className={getNodeClassName(node, selection)}
      style={{ left: node.position.x, top: node.position.y }}
      onClick={() => onSelect({ type: "course", id: course.id })}
    >
      <span className="graph-card__eyebrow">{pill(course.major_name)} / {pill(course.direction_name)}</span>
      <strong>{course.name}</strong>
      <span className="graph-card__meta">
        {course.child_knowledge_point_count} 知识点 · {course.mapped_skill_count} 技能 · {course.resource_count} 资源
      </span>
    </button>
  )
}

function DetailPanel({
  overview,
  selection,
}: {
  overview: JobModelGraphOverview | null
  selection: Selection
}) {
  if (!overview || !selection) {
    return (
      <aside className="graph-detail">
        <p className="graph-detail__kicker">详情</p>
        <h2>选择一个节点</h2>
        <p>点击左侧岗位或右侧课程，查看技能、知识点与映射关系。</p>
      </aside>
    )
  }

  if (selection.type === "job") {
    const job = overview.jobs.find((item) => item.id === selection.id)
    const skills = overview.skills.filter((skill) => skill.job_model_id === selection.id)
    if (!job) return null

    return (
      <aside className="graph-detail">
        <p className="graph-detail__kicker">岗位详情</p>
        <h2>岗位详情</h2>
        <h3>{job.job_role}</h3>
        <p>{pill(job.industry_name)} / {pill(job.direction_name)} · v{job.version} · {job.status}</p>
        <div className="graph-detail__list">
          {skills.map((skill) => (
            <div key={skill.id} className="graph-detail__item">
              <strong>{skill.name}</strong>
              <span>{pill(skill.dimension_name, "未分维度")} · {skill.level || "未定级"} · {skill.knowledge_point_count} 知识点</span>
            </div>
          ))}
        </div>
      </aside>
    )
  }

  const course = overview.courses.find((item) => item.id === selection.id)
  if (!course) return null

  return (
    <aside className="graph-detail">
      <p className="graph-detail__kicker">课程详情</p>
      <h2>课程详情</h2>
      <h3>{course.name}</h3>
      <p>{pill(course.major_name)} / {pill(course.direction_name)}</p>
      <div className="graph-detail__stats">
        <span>{course.child_knowledge_point_count} 知识点</span>
        <span>{course.mapped_skill_count} 映射技能</span>
        <span>{course.resource_count} 资源</span>
      </div>
    </aside>
  )
}

export function JobModelGraphWorkspace() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [overview, setOverview] = useState<JobModelGraphOverview | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    fetchGraphOverview(controller.signal)
      .then((data) => {
        setOverview(data)
        setSelection(data.jobs[0] ? { type: "job", id: data.jobs[0].id } : null)
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setError(err instanceof Error ? err.message : "图谱加载失败")
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [])

  const selectedJobId = selection?.type === "job" ? selection.id : null
  const selectedCourseId = selection?.type === "course" ? selection.id : null
  const graph = useMemo(
    () =>
      overview
        ? buildGraphWorkspaceLayout(overview, {
            selectedJobId,
            selectedCourseId,
            layout: layoutVersion === 0 ? overview.layout : null,
          })
        : null,
    [layoutVersion, overview, selectedCourseId, selectedJobId],
  )

  const handleSaveLayout = async () => {
    const scope = overview?.layout_scope
    if (!graph || !scope) return
    setSaveMessage(null)
    const nodes = Object.fromEntries(graph.nodes.map((node) => [node.id, node.position]))
    try {
      await saveGraphLayout(scope.scope_type, scope.scope_id, { nodes })
      setSaveMessage("布局已保存")
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "保存失败")
    }
  }

  if (searchParams.get("view") === "list") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-card px-4 py-3">
          <div>
            <h1 className="text-base font-semibold text-foreground">岗位模型列表</h1>
            <p className="mt-1 text-sm text-muted-foreground">保留原管理视图，用于筛选、编辑和删除岗位模型。</p>
          </div>
          <button
            type="button"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => navigate("/gwmx/job-models")}
          >
            返回图谱
          </button>
        </div>
        <JobModelList />
      </div>
    )
  }

  return (
    <section className="job-graph-workspace">
      <header className="graph-hero">
        <div>
          <p className="graph-hero__kicker">Job-Course Graph</p>
          <h1>岗位-课程图谱</h1>
          <p>在同一张工作台里查看岗位能力、课程知识点与技能映射关系。</p>
        </div>
        <div className="graph-toolbar" aria-label="图谱操作">
          <button type="button" onClick={() => navigate("/gwmx/job-models?view=list")}>切换到列表</button>
          <button type="button" onClick={() => navigate("/gwmx/job-models/standard-library")}>标准岗位库</button>
          <button type="button" onClick={() => navigate("/gwmx/job-models/fast-create")}>企业快速生成</button>
          <button type="button" onClick={handleSaveLayout}>保存布局</button>
          <button type="button" onClick={() => setLayoutVersion((value) => value + 1)}>自动排版</button>
        </div>
      </header>

      {saveMessage ? <p className="graph-toast">{saveMessage}</p> : null}
      {error ? <p className="graph-error">{error}</p> : null}

      <div className="graph-shell">
        <main className="graph-canvas" aria-busy={isLoading}>
          {isLoading ? <div className="graph-empty">正在加载图谱...</div> : null}
          {!isLoading && graph ? (
            <div className="graph-stage" style={{ width: graph.bounds.width, height: graph.bounds.height }}>
              <div className="graph-column-label graph-column-label--jobs">岗位</div>
              <div className="graph-column-label graph-column-label--skills">技能</div>
              <div className="graph-column-label graph-column-label--courses">课程</div>
              <svg className="graph-lines" width={graph.bounds.width} height={graph.bounds.height} aria-hidden="true">
                {graph.edges.map((edge) => {
                  const source = graph.nodes.find((node) => node.id === edge.source)
                  const target = graph.nodes.find((node) => node.id === edge.target)
                  if (!source || !target) return null
                  return (
                    <line
                      key={edge.id}
                      x1={source.position.x + 260}
                      y1={source.position.y + 46}
                      x2={target.position.x}
                      y2={target.position.y + 46}
                      className={edge.kind === "skill-course" ? "graph-line graph-line--mapping" : "graph-line"}
                    />
                  )
                })}
              </svg>
              {graph.nodes.map((node) => {
                if (isJobNode(node)) {
                  return <JobCardButton key={node.id} node={node} selection={selection} onSelect={setSelection} />
                }
                if (isSkillNode(node)) {
                  return <SkillCardView key={node.id} node={node} />
                }
                if (isCourseNode(node)) {
                  return <CourseCardButton key={node.id} node={node} selection={selection} onSelect={setSelection} />
                }
                return null
              })}
            </div>
          ) : null}
        </main>
        <DetailPanel overview={overview} selection={selection} />
      </div>
    </section>
  )
}

export default JobModelGraphWorkspace
