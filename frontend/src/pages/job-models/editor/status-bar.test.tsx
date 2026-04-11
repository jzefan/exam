import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusBar } from "./status-bar"

const editorState: {
  nodeCount: number
  modelVersion: number
  lastSavedAt: Date | null
} = {
  nodeCount: 10,
  modelVersion: 1,
  lastSavedAt: new Date("2026-04-04T10:00:00Z"),
}

vi.mock("./context", () => ({
  useEditor: () => editorState,
}))

describe("StatusBar", () => {
  beforeEach(() => {
    editorState.nodeCount = 10
    editorState.modelVersion = 1
    editorState.lastSavedAt = new Date("2026-04-04T10:00:00Z")
  })

  it("renders node count and version", () => {
    render(<StatusBar />)

    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByTestId("version-badge")).toHaveTextContent("v1")
  })

  it("shows unsaved state when there is no timestamp", () => {
    editorState.lastSavedAt = null
    render(<StatusBar />)

    expect(screen.getByText("尚未保存")).toBeInTheDocument()
  })
})
