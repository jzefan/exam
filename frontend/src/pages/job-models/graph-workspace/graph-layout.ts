import type {
  CourseCard,
  GraphLayoutSnapshot,
  JobCard,
  JobModelGraphOverview,
  SkillCard,
  SkillCourseMapping,
} from "./types"

export type GraphNodeKind = "job" | "skill" | "course"

export interface GraphWorkspaceNode<T = JobCard | SkillCard | CourseCard> {
  id: string
  kind: GraphNodeKind
  label: string
  position: { x: number; y: number }
  data: T
  muted: boolean
}

export interface GraphWorkspaceEdge {
  id: string
  source: string
  target: string
  kind: "job-skill" | "skill-course"
  muted: boolean
  mapping?: SkillCourseMapping
}

export interface BuildFocusedJobLayoutOptions {
  jobId: string | null
  selectedCourseId?: string | null
  layout?: GraphLayoutSnapshot | null
}

export interface GraphWorkspaceLayout {
  nodes: GraphWorkspaceNode[]
  edges: GraphWorkspaceEdge[]
  bounds: {
    width: number
    height: number
  }
}

const JOB_X = 0
const SKILL_X = 420
const COURSE_X = 840
const TOP_Y = 40
const COURSE_GAP = 140
const SKILL_GAP = 120

function layoutPosition(
  layout: GraphLayoutSnapshot | null | undefined,
  id: string,
  fallback: { x: number; y: number },
) {
  return layout?.nodes?.[id] ?? fallback
}

/**
 * Build the focused subgraph for a single job: the job on the left, its skills
 * in the middle, and only the courses those skills map to on the right. Keeping
 * one job in view (instead of every job at once) keeps the canvas readable.
 */
export function buildFocusedJobLayout(
  overview: JobModelGraphOverview,
  options: BuildFocusedJobLayoutOptions,
): GraphWorkspaceLayout {
  const nodes: GraphWorkspaceNode[] = []
  const edges: GraphWorkspaceEdge[] = []
  const layout = options.layout ?? overview.layout
  const selectedCourseId = options.selectedCourseId ?? null

  const job = options.jobId ? overview.jobs.find((item) => item.id === options.jobId) : null
  if (!job) {
    return { nodes, edges, bounds: { width: COURSE_X + 320, height: 480 } }
  }

  const skills = overview.skills.filter((skill) => skill.job_model_id === job.id)
  const skillIds = new Set(skills.map((skill) => skill.id))
  const mappings = overview.skill_course_mappings.filter((mapping) => skillIds.has(mapping.skill_id))
  const courseIds = new Set(mappings.map((mapping) => mapping.course_root_knowledge_point_id))
  const courses = overview.courses.filter((course) => courseIds.has(course.id))

  const skillsSpan = Math.max(0, (skills.length - 1) * SKILL_GAP)
  const coursesSpan = Math.max(0, (courses.length - 1) * COURSE_GAP)
  const centerY = TOP_Y + Math.max(skillsSpan, coursesSpan) / 2

  const jobNodeId = `job-${job.id}`
  nodes.push({
    id: jobNodeId,
    kind: "job",
    label: job.job_role,
    position: layoutPosition(layout, jobNodeId, { x: JOB_X, y: centerY }),
    data: job,
    muted: false,
  })

  const skillStartY = centerY - skillsSpan / 2
  skills.forEach((skill, index) => {
    const nodeId = `skill-${skill.id}`
    nodes.push({
      id: nodeId,
      kind: "skill",
      label: skill.name,
      position: layoutPosition(layout, nodeId, { x: SKILL_X, y: skillStartY + index * SKILL_GAP }),
      data: skill,
      muted: false,
    })
    edges.push({
      id: `${jobNodeId}__${nodeId}`,
      source: jobNodeId,
      target: nodeId,
      kind: "job-skill",
      muted: false,
    })
  })

  const courseStartY = centerY - coursesSpan / 2
  courses.forEach((course, index) => {
    const nodeId = `course-${course.id}`
    nodes.push({
      id: nodeId,
      kind: "course",
      label: course.name,
      position: layoutPosition(layout, nodeId, { x: COURSE_X, y: courseStartY + index * COURSE_GAP }),
      data: course,
      muted: Boolean(selectedCourseId && selectedCourseId !== course.id),
    })
  })

  for (const mapping of mappings) {
    const sourceId = `skill-${mapping.skill_id}`
    const targetId = `course-${mapping.course_root_knowledge_point_id}`
    if (!courseIds.has(mapping.course_root_knowledge_point_id)) continue
    edges.push({
      id: `${sourceId}__${targetId}`,
      source: sourceId,
      target: targetId,
      kind: "skill-course",
      muted: false,
      mapping,
    })
  }

  const height = Math.max(480, TOP_Y * 2 + Math.max(skillsSpan, coursesSpan))
  return { nodes, edges, bounds: { width: COURSE_X + 320, height } }
}
