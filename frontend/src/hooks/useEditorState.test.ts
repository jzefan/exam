import { describe, it, expect } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useEditorState } from "./useEditorState"

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

describe("useEditorState", () => {
  it("initializes with dimensions expanded by default", () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    expect(result.current.expandedNodeIds.has("dim-1")).toBe(true)
    expect(result.current.selectedNodeIds.size).toBe(0)
  })

  it("builds a flat nodeMap from model data", () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    expect(result.current.nodeMap.get("dim-1")).toMatchObject({
      id: "dim-1",
      type: "dimension",
      name: "Technical Skills",
    })
    expect(result.current.nodeMap.get("skill-1")).toMatchObject({
      id: "skill-1",
      type: "skill",
      level: "L4",
    })
    expect(result.current.nodeMap.get("kp-1")).toMatchObject({
      id: "kp-1",
      type: "kp",
      difficulty: "高级",
    })
  })

  it("toggles expansion state", () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    act(() => {
      result.current.toggleExpanded("dim-1")
    })
    expect(result.current.expandedNodeIds.has("dim-1")).toBe(false)

    act(() => {
      result.current.toggleExpanded("dim-1")
    })
    expect(result.current.expandedNodeIds.has("dim-1")).toBe(true)
  })

  it("replaces selection by default and supports multi-select", () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    act(() => {
      result.current.toggleSelected("skill-1")
    })
    expect([...result.current.selectedNodeIds]).toEqual(["skill-1"])

    act(() => {
      result.current.toggleSelected("dim-1", true)
    })
    expect(result.current.selectedNodeIds.has("skill-1")).toBe(true)
    expect(result.current.selectedNodeIds.has("dim-1")).toBe(true)
  })

  it("expandNode adds an id to the expanded set", () => {
    const { result } = renderHook(() => useEditorState({ dimensions: [] }))

    act(() => {
      result.current.expandNode("skill-1")
    })

    expect(result.current.expandedNodeIds.has("skill-1")).toBe(true)
  })
})
