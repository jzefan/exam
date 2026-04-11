import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Dashboard } from "./dashboard"

const navigateMock = vi.fn()

vi.mock("@refinedev/core", () => ({
  useGetIdentity: () => ({
    data: { name: "平台管理员" },
  }),
  usePermissions: () => ({
    data: "platform_admin",
  }),
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
})
