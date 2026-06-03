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

export interface BuildGraphWorkspaceLayoutOptions {
  selectedJobId?: string | null
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

const JOB_X = 40
const SKILL_X = 410
const COURSE_X = 790
const TOP_Y = 52
const JOB_GAP = 132
const COURSE_GAP = 126
const SKILL_GAP = 92

function layoutPosition(
  layout: GraphLayoutSnapshot | null | undefined,
  id: string,
  fallback: { x: number; y: number },
) {
  return layout?.nodes?.[id] ?? fallback
}

function getSkillsForJob(skills: SkillCard[], jobId: string) {
  return skills.filter((skill) => skill.job_model_id === jobId)
}

function getMappedCourseIdsForSkills(
  mappings: SkillCourseMapping[],
  skillIds: Set<string>,
) {
  const courseIds = new Set<string>()
  for (const mapping of mappings) {
    if (skillIds.has(mapping.skill_id)) {
      courseIds.add(mapping.course_root_knowledge_point_id)
    }
  }
  return courseIds
}

export function buildGraphWorkspaceLayout(
  overview: JobModelGraphOverview,
  options: BuildGraphWorkspaceLayoutOptions = {},
): GraphWorkspaceLayout {
  const nodes: GraphWorkspaceNode[] = []
  const edges: GraphWorkspaceEdge[] = []
  const selectedJobId = options.selectedJobId ?? null
  const selectedCourseId = options.selectedCourseId ?? null
  const layout = options.layout ?? overview.layout

  const selectedSkills = selectedJobId
    ? getSkillsForJob(overview.skills, selectedJobId)
    : []
  const selectedSkillIds = new Set(selectedSkills.map((skill) => skill.id))
  const relatedCourseIds = selectedJobId
    ? getMappedCourseIdsForSkills(overview.skill_course_mappings, selectedSkillIds)
    : new Set<string>()

  overview.jobs.forEach((job, index) => {
    const nodeId = `job-${job.id}`
    nodes.push({
      id: nodeId,
      kind: "job",
      label: job.job_role,
      position: layoutPosition(layout, nodeId, { x: JOB_X, y: TOP_Y + index * JOB_GAP }),
      data: job,
      muted: Boolean(selectedJobId && selectedJobId !== job.id),
    })
  })

  if (selectedJobId) {
    const selectedJobIndex = Math.max(0, overview.jobs.findIndex((job) => job.id === selectedJobId))
    const selectedJobY = TOP_Y + selectedJobIndex * JOB_GAP
    const skillStartY = selectedJobY - ((selectedSkills.length - 1) * SKILL_GAP) / 2

    selectedSkills.forEach((skill, index) => {
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
        id: `job-${selectedJobId}__${nodeId}`,
        source: `job-${selectedJobId}`,
        target: nodeId,
        kind: "job-skill",
        muted: false,
      })
    })
  }

  overview.courses.forEach((course, index) => {
    const nodeId = `course-${course.id}`
    const isUnrelated = Boolean(selectedJobId && !relatedCourseIds.has(course.id))
    nodes.push({
      id: nodeId,
      kind: "course",
      label: course.name,
      position: layoutPosition(layout, nodeId, { x: COURSE_X, y: TOP_Y + index * COURSE_GAP }),
      data: course,
      muted: isUnrelated || Boolean(selectedCourseId && selectedCourseId !== course.id),
    })
  })

  if (selectedJobId) {
    for (const mapping of overview.skill_course_mappings) {
      if (!selectedSkillIds.has(mapping.skill_id)) continue
      edges.push({
        id: `skill-${mapping.skill_id}__course-${mapping.course_root_knowledge_point_id}`,
        source: `skill-${mapping.skill_id}`,
        target: `course-${mapping.course_root_knowledge_point_id}`,
        kind: "skill-course",
        muted: false,
        mapping,
      })
    }
  }

  return {
    nodes,
    edges,
    bounds: {
      width: 1120,
      height: Math.max(
        560,
        TOP_Y + Math.max(overview.jobs.length * JOB_GAP, overview.courses.length * COURSE_GAP),
      ),
    },
  }
}
