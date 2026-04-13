import React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { JobModelCreate } from "./create"
import { normalizeJobModelsResponse } from "./list-utils"

const navigateMock = vi.fn()
const fetchMock = vi.fn()

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )

  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

beforeEach(() => {
  navigateMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe("normalizeJobModelsResponse", () => {
  it("returns the original value when the response is already an array", () => {
    const models = [{ id: "m1", current_version_id: "v1" }]

    expect(normalizeJobModelsResponse(models)).toEqual(models)
  })

  it("extracts models from a wrapped data payload", () => {
    const models = [{ id: "m1", current_version_id: "v1" }]

    expect(normalizeJobModelsResponse({ data: models })).toEqual(models)
  })

  it("falls back to an empty array for invalid payloads", () => {
    expect(normalizeJobModelsResponse({ items: [] })).toEqual([])
    expect(normalizeJobModelsResponse(null)).toEqual([])
  })
})

describe("JobModelCreate", () => {
  it("creates a standard model directly and jumps to the current version editor", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ id: "model-1", current_version_id: "ver-1" }))

    render(
      React.createElement(MemoryRouter, null, React.createElement(JobModelCreate)),
    )

    expect(
      screen.getByRole("heading", { name: "创建标准岗位模型" }),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("职位名称 *"), "Java 后端工程师")
    await userEvent.click(screen.getByRole("button", { name: "创建并编辑" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/job-models/models",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            job_role: "Java 后端工程师",
            version_note: null,
            source_type: "manual",
            model_type: "standard",
            status: "draft",
            industry_name: "科技",
            dimensions: [],
          }),
        }),
      ),
    )

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/gwmx/job-models/model-1/versions/ver-1/editor"),
    )
  })
})
