import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Toolbar } from "./toolbar"

const navigateMock = vi.fn()
const setViewMode = vi.fn()

const editorState = {
  viewMode: "tree" as const,
  setViewMode,
  isDirty: false,
  isSaving: false,
}

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}))

vi.mock("./context", () => ({
  useEditor: () => editorState,
}))

describe("Toolbar", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    setViewMode.mockReset()
    editorState.viewMode = "tree"
    editorState.isDirty = false
    editorState.isSaving = false
  })

  it("renders view toggle buttons", () => {
    render(<Toolbar onSave={vi.fn()} onPublish={vi.fn()} />)

    expect(screen.getByRole("button", { name: "切换到树形视图" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "切换到图形视图" })).toBeInTheDocument()
  })

  it("switches view mode", () => {
    render(<Toolbar onSave={vi.fn()} onPublish={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "切换到图形视图" }))
    expect(setViewMode).toHaveBeenCalledWith("graph")
  })

  it("disables save when clean", () => {
    render(<Toolbar onSave={vi.fn()} onPublish={vi.fn()} />)

    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled()
  })

  it("calls save when dirty", () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    editorState.isDirty = true
    render(<Toolbar onSave={onSave} onPublish={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "保存更改" }))
    expect(onSave).toHaveBeenCalled()
  })
})
