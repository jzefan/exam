import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Dashboard } from "./dashboard"

const navigateMock = vi.fn()
const usePermissionsMock = vi.fn(() => ({ data: "platform_admin" }))
const useGetIdentityMock = vi.fn(() => ({ data: { name: "平台管理员" } }))

vi.mock("@refinedev/core", () => ({
  useGetIdentity: () => useGetIdentityMock(),
  usePermissions: () => usePermissionsMock(),
}))

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom")
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock("@/pages/grading/api", () => ({
  apiRequest: vi.fn().mockResolvedValue({
    total_exams: 3,
    total_questions: 10,
    total_users: 5,
    total_jobs: 2,
    total_candidates: 0,
    pending_grading: 0,
    total_students: 0,
  }),
}))

describe("Dashboard", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    useGetIdentityMock.mockReturnValue({ data: { name: "平台管理员" } })
    usePermissionsMock.mockReturnValue({ data: "platform_admin" })
  })

  it("navigates platform admin user management actions to /users", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("用户数")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("用户数"))
    expect(navigateMock).toHaveBeenCalledWith("/users")

    fireEvent.click(screen.getByText("用户管理"))
    expect(navigateMock).toHaveBeenCalledWith("/users")
  })

  it("shows teacher quick actions in the required order and routes", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("学生总数")).toBeInTheDocument()
    })

    const actions = [
      ["学生管理", "/students"],
      ["知识点管理", "/knowledge"],
      ["导入题目", "/questions/import"],
      ["创建考试", "/exams/create"],
      ["发布作业", "/exams/practice/create"],
      ["考试阅卷", "/grading"],
    ] as const

    const actionTitles = screen.getAllByRole("button").slice(-actions.length).map((button) => button.textContent)
    expect(actionTitles).toEqual(
      actions.map(([title]) => expect.stringContaining(title)),
    )

    for (const [title, path] of actions) {
      fireEvent.click(screen.getByText(title))
      expect(navigateMock).toHaveBeenLastCalledWith(path)
    }
  })
})
