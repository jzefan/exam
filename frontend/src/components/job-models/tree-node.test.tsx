import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TreeNode } from "./tree-node"

vi.mock("@/pages/job-models/editor/context", () => ({
  useEditor: () => ({
    selectedNodeId: null,
  }),
}))

const mockDimension = {
  id: "dim-1",
  name: "Technical Skills",
  description: "Core technical competencies",
  job_role_id: "role-1",
  sort_order: 1,
  created_at: "2026-04-04T00:00:00Z",
  updated_at: "2026-04-04T00:00:00Z",
  skills: [],
}

describe("TreeNode", () => {
  it("renders node with name", () => {
    render(
      <TreeNode
        id="dim-1"
        type="dimension"
        name={mockDimension.name}
        level="L3"
        depth={0}
        childCount={1}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    expect(screen.getByText("Technical Skills")).toBeInTheDocument()
  })

  it("shows expand/collapse chevron when has children", () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <TreeNode
        id="dim-1"
        type="dimension"
        name={mockDimension.name}
        level="L3"
        depth={0}
        childCount={1}
        isExpanded={false}
        onToggleExpand={onToggle}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    const chevron = screen.getByRole("button", { name: /expand/i })
    expect(chevron).toBeInTheDocument()
    rerender(
      <TreeNode
        id="dim-1"
        type="dimension"
        name={mockDimension.name}
        level="L3"
        depth={0}
        childCount={1}
        isExpanded={true}
        onToggleExpand={onToggle}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    fireEvent.click(chevron)
    expect(onToggle).toHaveBeenCalled()
  })

  it("allows inline name editing on double click", async () => {
    const onNameChange = vi.fn()
    render(
      <TreeNode
        id="dim-1"
        type="dimension"
        name={mockDimension.name}
        level="L3"
        depth={0}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={onNameChange}
      />
    )

    const nameText = screen.getByText("Technical Skills")
    fireEvent.doubleClick(nameText)

    const input = screen.getByDisplayValue("Technical Skills")
    expect(input).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "New Skills" } })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    expect(onNameChange).toHaveBeenCalledWith("New Skills")
  })

  it("shows level badge with appropriate color", () => {
    const { rerender } = render(
      <TreeNode
        id="dim-1"
        type="skill"
        name="Backend Development"
        level="L5"
        depth={1}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    const badge = screen.getByText("L5")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass("bg-red-500", "text-white")

    rerender(
      <TreeNode
        id="dim-1"
        type="skill"
        name="Backend Development"
        level="L1"
        depth={1}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    const badge1 = screen.getByText("L1")
    expect(badge1).toHaveClass("bg-gray-400", "text-white")
  })

  it("calls onSelect when clicking node", () => {
    const onSelect = vi.fn()
    render(
      <TreeNode
        id="dim-1"
        type="dimension"
        name={mockDimension.name}
        level="L3"
        depth={0}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText("Technical Skills"))
    expect(onSelect).toHaveBeenCalled()
  })
})
