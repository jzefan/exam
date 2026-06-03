export interface JobCard {
  id: string
  current_version_id: string | null
  job_role: string
  model_type: string
  status: string
  industry_name: string | null
  direction_name: string | null
  skill_count: number
  version: number
}

export interface SkillCard {
  id: string
  job_model_id: string
  dimension_name: string | null
  name: string
  level: string | null
  knowledge_point_count: number
  course_mapping_count: number
}

export interface CourseCard {
  id: string
  name: string
  major_name: string | null
  direction_name: string | null
  child_knowledge_point_count: number
  mapped_skill_count: number
  resource_count: number
}

export interface SkillCourseMapping {
  id: string
  skill_id: string
  course_root_knowledge_point_id: string
  relation_type: string
  match_type: string
  status: string
  source_type: string
  target_type: string
}

export interface GraphLayoutPoint {
  x: number
  y: number
}

export interface GraphLayoutSnapshot {
  nodes?: Record<string, GraphLayoutPoint>
  viewport?: {
    x: number
    y: number
    zoom: number
  }
  [key: string]: unknown
}

export interface GraphLayoutScope {
  scope_type: string
  scope_id: string
}

export interface JobModelGraphOverview {
  jobs: JobCard[]
  courses: CourseCard[]
  skills: SkillCard[]
  skill_course_mappings: SkillCourseMapping[]
  layout_scope?: GraphLayoutScope
  layout: GraphLayoutSnapshot | null
}

export interface CreateSkillCourseMappingInput {
  skill_id: string
  course_root_knowledge_point_id: string
  relation_type?: string
  match_type?: string
  status?: string
  source_type?: string
  target_type?: string
}

export interface SaveGraphLayoutInput {
  nodes: Record<string, GraphLayoutPoint>
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}
