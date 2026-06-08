import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Dashboard } from "./dashboard"

const navigateMock = vi.fn()
const usePermissionsMock = vi.fn(() => ({ data: "platform_admin" }))
const useGetIdentityMock = vi.fn(() => ({ data: { name: "平台管理员", persona: "teacher" as string | null } }))

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
    useGetIdentityMock.mockReturnValue({ data: { name: "平台管理员", persona: "teacher" } })
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
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("考试/练习数")).toBeInTheDocument()
    })

    expect(screen.queryByText("学生总数")).not.toBeInTheDocument()
    expect(screen.getByText("考生总数")).toBeInTheDocument()
    expect(screen.getByText("考试/练习数")).toBeInTheDocument()
    expect(screen.getByText("题目数")).toBeInTheDocument()

    fireEvent.click(screen.getByText("考生总数"))
    expect(navigateMock).toHaveBeenLastCalledWith("/exams/students")

    fireEvent.click(screen.getByText("考试/练习数"))
    expect(navigateMock).toHaveBeenLastCalledWith("/exams")

    fireEvent.click(screen.getByText("题目数"))
    expect(navigateMock).toHaveBeenLastCalledWith("/questions")

    const actions = [
      ["学生管理", "/students"],
      ["我的课程", "/courses"],
      ["导入题目", "/questions/import"],
      ["创建考试", "/exams/create"],
      ["发布练习", "/exams/practice/create"],
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

  it("uses candidate management wording for assessor dashboard", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "测评用户", persona: "assessor" } })
    usePermissionsMock.mockReturnValue({ data: "evaluator" })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("考生管理")).toBeInTheDocument()
    })

    expect(screen.getByText("管理考生账号、部门与导入数据")).toBeInTheDocument()
    expect(screen.queryByText("学生管理")).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("考生管理"))
    expect(navigateMock).toHaveBeenLastCalledWith("/students")
  })
})
