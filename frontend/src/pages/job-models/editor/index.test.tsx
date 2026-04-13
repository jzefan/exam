import { MemoryRouter, Route, Routes } from "react-router-dom"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { EditorPage } from "./index"

const fetchMock = vi.fn()

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}))

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="toaster" />,
}))

vi.mock("./graph-view", () => ({
  GraphView: ({ onNodeSelect }: { onNodeSelect: (nodeId: string) => void }) => (
    <button data-testid="graph-panel" onClick={() => onNodeSelect("dim-1")}>
      graph
    </button>
  ),
}))

vi.mock("./content-panel", () => ({
  ContentPanel: ({ nodeId }: { nodeId: string | null }) => (
    <div data-testid="content-panel">{nodeId ?? "no-node"}</div>
  ),
}))

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/gwmx/job-models/model-1/versions/ver-1/editor"]}>
      <Routes>
        <Route
          path="/gwmx/job-models/:jobModelId/versions/:versionId/editor"
          element={<EditorPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe("EditorPage", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "model-1",
        job_role: "Senior Backend Engineer",
        current_version_id: "ver-1",
        current_version: {
          id: "ver-1",
          version: 2,
          version_note: "初始企业版",
          is_current: true,
          source_type: "manual",
          dimensions: [
            {
              id: "dim-1",
              model_version_id: "ver-1",
              name: "Technical Skills",
              description: "Core technical competencies",
              sort_order: 0,
              skills: [
                {
                  id: "skill-1",
                  dimension_id: "dim-1",
                  name: "Backend Architecture",
                  level: "L4",
                  description: "System design",
                  sort_order: 0,
                  knowledge_points: [],
                  created_at: "2026-04-13T00:00:00Z",
                  updated_at: "2026-04-13T00:00:00Z",
                },
              ],
              created_at: "2026-04-13T00:00:00Z",
              updated_at: "2026-04-13T00:00:00Z",
            },
          ],
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("loads the current version and renders the main editor layout", async () => {
    renderEditor()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/job-models/models/model-1",
        expect.objectContaining({ headers: expect.any(Object) }),
      )
    })

    expect(await screen.findByText("Technical Skills")).toBeInTheDocument()
    expect(screen.getByTestId("tree-panel")).toBeInTheDocument()
    expect(screen.getByTestId("status-bar")).toBeInTheDocument()
    expect(screen.getByTestId("toaster")).toBeInTheDocument()
  })

  it("switches between tree and graph views", async () => {
    renderEditor()

    await screen.findByText("Technical Skills")
    await userEvent.click(screen.getByRole("button", { name: "切换到图形视图" }))

    expect(screen.getAllByTestId("graph-panel").length).toBeGreaterThan(0)
  })

  it("uses the loaded current version number in the status bar", async () => {
    renderEditor()

    expect(await screen.findByTestId("version-badge")).toHaveTextContent("v2")
  })
})
