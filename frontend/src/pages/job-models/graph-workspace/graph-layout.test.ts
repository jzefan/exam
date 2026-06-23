import { describe, expect, it } from "vitest"

import { buildFocusedJobLayout } from "./graph-layout"
import type { JobModelGraphOverview } from "./types"

const overview: JobModelGraphOverview = {
  jobs: [
    {
      id: "job-1",
      current_version_id: "version-1",
      job_role: "后端工程师",
      model_type: "standard",
      status: "published",
      industry_name: "互联网",
      direction_name: "研发",
      skill_count: 2,
      version: 3,
    },
    {
      id: "job-2",
      current_version_id: "version-2",
      job_role: "数据分析师",
      model_type: "enterprise",
      status: "draft",
      industry_name: "互联网",
      direction_name: "数据",
      skill_count: 1,
      version: 1,
    },
  ],
  skills: [
    {
      id: "skill-1",
      job_model_id: "job-1",
      dimension_name: "工程能力",
      name: "服务端架构",
      level: "L4",
      knowledge_point_count: 12,
      course_mapping_count: 1,
    },
    {
      id: "skill-2",
      job_model_id: "job-1",
      dimension_name: "工程能力",
      name: "接口治理",
      level: "L3",
      knowledge_point_count: 8,
      course_mapping_count: 0,
    },
    {
      id: "skill-3",
      job_model_id: "job-2",
      dimension_name: "数据能力",
      name: "指标分析",
      level: "L3",
      knowledge_point_count: 6,
      course_mapping_count: 1,
    },
  ],
  courses: [
    {
      id: "course-1",
      name: "Java 微服务",
      major_name: "软件技术",
      direction_name: "研发",
      child_knowledge_point_count: 20,
      mapped_skill_count: 1,
      resource_count: 5,
    },
    {
      id: "course-2",
      name: "数据看板实战",
      major_name: "大数据",
      direction_name: "数据",
      child_knowledge_point_count: 15,
      mapped_skill_count: 1,
      resource_count: 3,
    },
  ],
  skill_course_mappings: [
    {
      id: "mapping-1",
      skill_id: "skill-1",
      course_root_knowledge_point_id: "course-1",
      relation_type: "recommended",
      match_type: "manual",
      status: "active",
      source_type: "skill",
      target_type: "course",
    },
    {
      id: "mapping-2",
      skill_id: "skill-3",
      course_root_knowledge_point_id: "course-2",
      relation_type: "recommended",
      match_type: "manual",
      status: "active",
      source_type: "skill",
      target_type: "course",
    },
  ],
  layout: null,
}

describe("buildFocusedJobLayout", () => {
  it("returns an empty graph when no job is selected", () => {
    const graph = buildFocusedJobLayout(overview, { jobId: null })

    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it("places the focused job on the left and its mapped courses on the right", () => {
    const graph = buildFocusedJobLayout(overview, { jobId: "job-1" })

    const job = graph.nodes.find((node) => node.id === "job-job-1")
    const course = graph.nodes.find((node) => node.id === "course-course-1")

    expect(job?.kind).toBe("job")
    expect(course?.kind).toBe("course")
    expect(job?.position.x).toBeLessThan(course?.position.x ?? 0)
  })

  it("shows only the focused job's skills and the courses they map to", () => {
    const graph = buildFocusedJobLayout(overview, { jobId: "job-1" })
    const nodeIds = graph.nodes.map((node) => node.id)

    expect(nodeIds).toContain("job-job-1")
    expect(nodeIds).toContain("skill-skill-1")
    expect(nodeIds).toContain("skill-skill-2")
    expect(nodeIds).not.toContain("skill-skill-3")
    expect(nodeIds).toContain("course-course-1")
    // course-2 is mapped to skill-3 (a different job) so it must not appear.
    expect(nodeIds).not.toContain("course-course-2")
    // other jobs are never rendered on the focused canvas.
    expect(nodeIds).not.toContain("job-job-2")

    expect(graph.edges.map((edge) => edge.id)).toContain("job-job-1__skill-skill-1")
    expect(graph.edges.map((edge) => edge.id)).toContain("skill-skill-1__course-course-1")
  })

  it("mutes courses other than the selected one", () => {
    const overviewWithTwoCourses: JobModelGraphOverview = {
      ...overview,
      skill_course_mappings: [
        ...overview.skill_course_mappings,
        {
          id: "mapping-3",
          skill_id: "skill-2",
          course_root_knowledge_point_id: "course-2",
          relation_type: "recommended",
          match_type: "manual",
          status: "active",
          source_type: "skill",
          target_type: "course",
        },
      ],
    }

    const graph = buildFocusedJobLayout(overviewWithTwoCourses, {
      jobId: "job-1",
      selectedCourseId: "course-1",
    })

    expect(graph.nodes.find((node) => node.id === "course-course-1")?.muted).toBe(false)
    expect(graph.nodes.find((node) => node.id === "course-course-2")?.muted).toBe(true)
  })
})
