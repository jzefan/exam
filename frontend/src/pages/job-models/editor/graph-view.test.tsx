import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { GraphView } from "./graph-view"

const setSelectedNodeId = vi.fn()

vi.mock("./context", () => ({
  useEditor: () => ({
    setSelectedNodeId,
  }),
}))

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react")
  return {
    ...actual,
    ReactFlow: ({ nodes, children }: { nodes: Array<{ id: string; data: { label: string } }>; children?: React.ReactNode }) => (
      <div>
        {nodes.map((node) => (
          <div key={node.id} data-node-id={node.id}>
            {node.data.label}
          </div>
        ))}
        {children}
      </div>
    ),
    Controls: () => <div>controls</div>,
    Background: () => <div>background</div>,
    useNodesState: (nodes: unknown[]) => [nodes, vi.fn(), vi.fn()],
    useEdgesState: (edges: unknown[]) => [edges, vi.fn(), vi.fn()],
  }
})

const mockModel = {
  id: "model-1",
  job_role: "Senior Backend Engineer",
  dimensions: [
    {
      id: "dim-1",
      name: "Technical Skills",
      skills: [
        {
          id: "skill-1",
          name: "Backend Architecture",
          level: "L4",
          knowledge_points: [{ id: "kp-1", name: "Microservices Design", difficulty: "高级" }],
        },
      ],
    },
  ],
}

describe("GraphView", () => {
  it("renders model hierarchy labels", () => {
    render(<GraphView model={mockModel} onNodeSelect={vi.fn()} />)

    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument()
    expect(screen.getByText("Technical Skills")).toBeInTheDocument()
    expect(screen.getByText("Backend Architecture")).toBeInTheDocument()
    expect(screen.getByText("Microservices Design")).toBeInTheDocument()
  })
})
