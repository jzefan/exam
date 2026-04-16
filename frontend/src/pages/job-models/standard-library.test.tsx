import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { render, screen } from "@/test/test-utils"

import { JobModelList } from "./list"
import { StandardLibraryPage } from "./standard-library"

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

describe("job model library entry points", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      json: async () => [],
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("shows the standard library and enterprise quick-create entry points on the list page", async () => {
    render(
      <MemoryRouter>
        <JobModelList />
      </MemoryRouter>,
    )

    expect(await screen.findByRole("heading", { name: "岗位模型管理" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "标准岗位库" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "企业快速生成" }).length).toBeGreaterThan(0)
  })

  it("renders the standard library page shell", async () => {
    fetchMock.mockResolvedValue({
      json: async () => [
        {
          id: "std-1",
          current_version_id: "ver-1",
          job_role: "Java 后端工程师",
          industry_name: "软件和信息服务",
          direction_name: "工业软件",
          current_version: {
            id: "ver-1",
            version_note: "平台标准岗位模型",
            source_type: "manual",
          },
        },
      ],
    })

    render(
      <MemoryRouter>
        <StandardLibraryPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole("heading", { name: "标准岗位库" })).toBeInTheDocument()
    expect(
      screen.getByText(/按产业、方向和岗位浏览平台标准模型/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/job-models/models?_start=0&_end=200&model_type=standard",
        expect.any(Object),
      ),
    )
  })

  it("shows an empty state when there are no real standard models", async () => {
    fetchMock.mockResolvedValue({
      json: async () => [],
    })

    render(
      <MemoryRouter>
        <StandardLibraryPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText("还没有标准岗位模型")).toBeInTheDocument()
    expect(screen.getByText("先通过\"创建标准岗位模型\"或标准岗位 seed 脚本写入真实数据。")).toBeInTheDocument()
  })

  it("navigates to the existing editor route when clicking detail on a real standard model", async () => {
    fetchMock.mockResolvedValue({
      json: async () => [
        {
          id: "std-1",
          current_version_id: "ver-1",
          job_role: "Java 后端工程师",
          industry_name: "软件和信息服务",
          direction_name: "工业软件",
          current_version: {
            id: "ver-1",
            version_note: "平台标准岗位模型",
            source_type: "manual",
          },
        },
      ],
    })

    render(
      <MemoryRouter>
        <StandardLibraryPage />
      </MemoryRouter>,
    )

    await userEvent.click(await screen.findByRole("button", { name: "查看详情" }))
    expect(navigateMock).toHaveBeenCalledWith("/gwmx/job-models/std-1/versions/ver-1/editor")
  })
})
