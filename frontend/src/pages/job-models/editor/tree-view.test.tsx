import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TreeView } from "./tree-view"

const setSelectedNodeId = vi.fn()
const setIsDirty = vi.fn()

vi.mock("./context", () => ({
  useEditor: () => ({
    setSelectedNodeId,
    setIsDirty,
  }),
}))

const mockModel = {
  id: "model-1",
  dimensions: [
    {
      id: "dim-1",
      name: "Technical Skills",
      skills: [
        {
          id: "skill-1",
          name: "Backend Architecture",
          level: "L4",
          knowledge_points: [
            {
              id: "kp-1",
              name: "Microservices Design",
              difficulty: "高级",
            },
          ],
        },
      ],
    },
  ],
}

describe("TreeView", () => {
  it("renders dimensions and nested children", () => {
    render(
      <TreeView
        model={mockModel}
        onNodeNameChange={vi.fn()}
        onNodeDelete={vi.fn()}
      />
    )

    expect(screen.getByText("Technical Skills")).toBeInTheDocument()
    expect(screen.getByText("Backend Architecture")).toBeInTheDocument()
  })

  it("selects a node when clicked", () => {
    render(
      <TreeView
        model={mockModel}
        onNodeNameChange={vi.fn()}
        onNodeDelete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText("Technical Skills"))
    expect(setSelectedNodeId).toHaveBeenCalledWith("dim-1")
  })

  it("shows add buttons when onAddNode is provided", () => {
    render(
      <TreeView
        model={mockModel}
        onNodeNameChange={vi.fn()}
        onNodeDelete={vi.fn()}
        onAddNode={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: /添加能力维度/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /添加技能/i })).toBeInTheDocument()
  })
})
