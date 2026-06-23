import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { JobModelGraphWorkspace } from "./index"
import type { JobModelGraphOverview } from "./types"

// React Flow needs a sized container + ResizeObserver that jsdom lacks, so we
// mock it: nodes render as buttons exposing their label and forwarding clicks.
vi.mock("@xyflow/react", async () => {
  const React = await import("react")
  return {
    ReactFlow: ({
      nodes,
      onNodeClick,
    }: {
      nodes: Array<{ id: string; data: { label: string } }>
      onNodeClick?: (event: unknown, node: unknown) => void
    }) => (
      <div data-testid="rf-canvas">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-node-id={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            {node.data.label}
          </button>
        ))}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
    useNodesState: (initial: unknown[]) => {
      const [value, setValue] = React.useState(initial)
      return [value, setValue, () => {}]
    },
    useEdgesState: (initial: unknown[]) => {
      const [value, setValue] = React.useState(initial)
      return [value, setValue, () => {}]
    },
  }
})

const fetchMock = vi.fn()

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
      skill_count: 1,
      version: 3,
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
  ],
  layout_scope: {
    scope_type: "org_overview",
    scope_id: "org-1",
  },
  layout: null,
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("access_token", "token-1")
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe("JobModelGraphWorkspace", () => {
  it("loads overview with auth and renders required workspace controls", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(overview))

    render(
      <MemoryRouter>
        <JobModelGraphWorkspace />
      </MemoryRouter>,
    )

    expect(await screen.findByRole("heading", { name: "岗位-课程图谱" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "返回岗位列表" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "企业快速生成" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存布局" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "自动排版" })).toBeInTheDocument()
    // Jobs live in the categorized tree; the focused job's mapped course is on the canvas.
    const tree = await screen.findByTestId("job-tree")
    expect(await within(tree).findByRole("button", { name: /后端工程师/ })).toBeInTheDocument()
    const canvas = screen.getByTestId("rf-canvas")
    expect(await within(canvas).findByRole("button", { name: /Java 微服务/ })).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/job-models/graph/overview",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-1" },
      }),
    )
  })

  it("switches the detail panel from job details to course details", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(overview))

    render(
      <MemoryRouter>
        <JobModelGraphWorkspace />
      </MemoryRouter>,
    )

    const tree = await screen.findByTestId("job-tree")
    await userEvent.click(await within(tree).findByRole("button", { name: /后端工程师/ }))

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "岗位详情" })).toBeInTheDocument(),
    )
    expect(screen.getAllByText("服务端架构").length).toBeGreaterThan(0)

    const canvas = screen.getByTestId("rf-canvas")
    await userEvent.click(await within(canvas).findByRole("button", { name: /Java 微服务/ }))

    const detail = screen.getByRole("heading", { name: "课程详情" }).closest("aside")
    expect(detail).not.toBeNull()
    expect(within(detail as HTMLElement).getByText("软件技术", { exact: false })).toBeInTheDocument()
  })

  it("saves layout using the overview layout scope", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse(overview))
      .mockResolvedValueOnce(mockJsonResponse({}))

    render(
      <MemoryRouter>
        <JobModelGraphWorkspace />
      </MemoryRouter>,
    )

    const canvas = await screen.findByTestId("rf-canvas")
    await within(canvas).findByRole("button", { name: /后端工程师/ })
    await userEvent.click(screen.getByRole("button", { name: "保存布局" }))

    await waitFor(() => expect(screen.getByText("布局已保存")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/job-models/graph/layouts/org_overview/org-1",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("layout_json"),
      }),
    )
  })
})
