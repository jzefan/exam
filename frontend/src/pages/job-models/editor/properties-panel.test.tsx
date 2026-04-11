import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PropertiesPanel } from "./properties-panel"

const onNodeDelete = vi.fn()
const onNodeUpdate = vi.fn()

vi.mock("./context", () => ({
  useEditor: () => ({
    modelVersion: 1,
  }),
}))

const mockModel = {
  id: "model-1",
  job_role: "Senior Backend Engineer",
  status: "draft",
  dimensions: [
    {
      id: "dim-1",
      name: "Technical Skills",
      description: "Core technical competencies",
      skills: [
        {
          id: "skill-1",
          name: "Backend Architecture",
          description: "System design",
          level: "L4",
          knowledge_points: [
            {
              id: "kp-1",
              name: "Microservices Design",
              difficulty: "高级",
              teaching_suggestion: "通过实验掌握",
            },
          ],
        },
      ],
    },
  ],
}

describe("PropertiesPanel", () => {
  beforeEach(() => {
    onNodeDelete.mockReset()
    onNodeUpdate.mockReset()
    vi.stubGlobal("confirm", vi.fn(() => true))
  })

  it("shows model overview when no node is selected", () => {
    render(
      <PropertiesPanel
        model={mockModel}
        nodeId={null}
        onNodeUpdate={onNodeUpdate}
        onNodeDelete={onNodeDelete}
      />
    )

    expect(screen.getByText("模型概览")).toBeInTheDocument()
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument()
    expect(screen.getByText("草稿")).toBeInTheDocument()
  })

  it("shows selected node fields", () => {
    render(
      <PropertiesPanel
        model={mockModel}
        nodeId="skill-1"
        onNodeUpdate={onNodeUpdate}
        onNodeDelete={onNodeDelete}
      />
    )

    expect(screen.getByDisplayValue("Backend Architecture")).toBeInTheDocument()
    expect(screen.getByText("技能属性")).toBeInTheDocument()
  })

  it("saves edited node values", async () => {
    render(
      <PropertiesPanel
        model={mockModel}
        nodeId="dim-1"
        onNodeUpdate={onNodeUpdate}
        onNodeDelete={onNodeDelete}
      />
    )

    const input = screen.getByDisplayValue("Technical Skills")
    await userEvent.clear(input)
    await userEvent.type(input, "Advanced Technical Skills")
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }))

    expect(onNodeUpdate).toHaveBeenCalledWith("dim-1", {
      name: "Advanced Technical Skills",
      description: "Core technical competencies",
    })
  })

  it("deletes the selected node after confirmation", () => {
    render(
      <PropertiesPanel
        model={mockModel}
        nodeId="kp-1"
        onNodeUpdate={onNodeUpdate}
        onNodeDelete={onNodeDelete}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    expect(onNodeDelete).toHaveBeenCalledWith("kp-1")
  })
})
