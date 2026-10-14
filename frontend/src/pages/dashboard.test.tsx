import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Dashboard } from "./dashboard"
import { apiRequest } from "@/pages/grading/api"
import { rememberRecentGradingTask } from "@/pages/grading/recent-task"
import { listTeacherCourses } from "@/pages/courses/api"

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
  apiRequest: vi.fn((url: string) => Promise.resolve(
    url === "/grading/inbox"
      ? { exams: [{ exam_id: "exam-1", exam_label: "数据库期末考试", exam_date: "2026-09-27", pending_submission_count: 1, questions: [
          { question_id: "q-1", pending_count: 1, latest_updated_at: "2026-09-27" },
          { question_id: "q-2", pending_count: 1, latest_updated_at: "2026-09-27" },
        ] }] }
      : {
          total_exams: 3,
          total_questions: 10,
          total_users: 5,
          total_jobs: 2,
          total_candidates: 0,
          pending_grading: 0,
          total_students: 0,
        },
  )),
}))

vi.mock("@/pages/courses/api", () => ({
  listTeacherCourses: vi.fn().mockResolvedValue([
    { id: "course-1", name: "数据结构", can_write: true, is_deleted: false, updated_at: "2026-09-26", exam_count: 1, assignment_count: 2 },
  ]),
}))

describe("Dashboard", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    localStorage.clear()
    useGetIdentityMock.mockReturnValue({ data: { name: "平台管理员", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "platform_admin" })
    vi.mocked(listTeacherCourses).mockReset().mockResolvedValue([
      { id: "course-1", name: "数据结构", can_write: true, is_deleted: false, updated_at: "2026-09-26", exam_count: 1, assignment_count: 2 } as Awaited<ReturnType<typeof listTeacherCourses>>[number],
    ])
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

  it("shows teacher grading tasks and recent courses with direct routes", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText("数据库期末考试")).toBeInTheDocument())
    expect(screen.getByText("1 份待阅")).toBeInTheDocument()
    expect(screen.getByText("1 份待阅 · 1 门课程")).toBeInTheDocument()
    expect(screen.getByText("数据结构")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /^创建课程/ }))
    expect(navigateMock).toHaveBeenLastCalledWith("/courses", { state: { create: true } })

    fireEvent.click(screen.getByText("数据库期末考试"))
    expect(navigateMock).toHaveBeenLastCalledWith("/grading?examId=exam-1&mode=candidate")
    fireEvent.click(screen.getByText("数据结构"))
    expect(navigateMock).toHaveBeenLastCalledWith("/courses/course-1")
  })

  it.each([
    ["智能出题", "/courses/course-1/question-skills", undefined],
    ["导入题目", "/questions/import", {
      state: {
        backTo: "/courses/course-1?tab=questions",
        backLabel: "返回课程详情",
        successTo: "/courses/course-1?tab=questions",
        courseKpId: "course-1",
        courseName: "数据结构",
      },
    }],
    ["导入试卷", "/papers/import", {
      state: {
        backTo: "/courses/course-1?tab=papers",
        backLabel: "返回课程详情",
        successTo: "/courses/course-1?tab=papers",
        courseOrigin: true,
        rootKnowledgePointId: "course-1",
        rootKnowledgePointName: "数据结构",
      },
    }],
  ] as const)("requires a course before %s", async (action, path, options) => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    const actionButton = () => screen.getByRole("button", { name: new RegExp(`^${action}`) })
    await waitFor(() => expect(actionButton()).toBeEnabled())
    fireEvent.click(actionButton())
    expect(navigateMock).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "数据结构" }))
    if (options) expect(navigateMock).toHaveBeenLastCalledWith(path, options)
    else expect(navigateMock).toHaveBeenLastCalledWith(path)
  })

  it("opens course creation when there is no writable course", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })
    vi.mocked(listTeacherCourses).mockResolvedValueOnce([])
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await waitFor(() => expect(screen.getByRole("button", { name: /^导入题目/ })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /^导入题目/ }))
    expect(navigateMock).toHaveBeenLastCalledWith("/courses", { state: { create: true } })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
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

  it("does not present a failed teacher inbox request as an empty queue", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("offline"))

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText("阅卷任务加载失败，请重试。")).toBeInTheDocument())
    expect(screen.queryByText("目前没有待阅答卷。")).not.toBeInTheDocument()
    expect(screen.queryByText("0 份待阅")).not.toBeInTheDocument()
    expect(screen.getByText("数据结构")).toBeInTheDocument()
  })

  it("resumes the last valid teacher grading task", async () => {
    useGetIdentityMock.mockReturnValue({ data: { name: "教师", persona: "teacher" } })
    usePermissionsMock.mockReturnValue({ data: "teacher" })
    localStorage.setItem("user", JSON.stringify({ id: "teacher-1", primary_org: { role_name: "teacher" } }))
    rememberRecentGradingTask({ taskId: "task-1", title: "数据库期末考试 · 第 3 题", questionRef: "exam-1::q-1", mode: "question" })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText("数据库期末考试")).toBeInTheDocument())
    fireEvent.click(screen.getByText("继续上次阅卷"))
    expect(navigateMock).toHaveBeenLastCalledWith("/grading?taskId=task-1&mode=question&questionRef=exam-1%3A%3Aq-1")
  })
})
