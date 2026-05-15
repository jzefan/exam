import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";

import { StudentLayout } from "./student-layout";

const useGetIdentityMock = vi.fn();
const logoutMock = vi.fn();
const axiosGetMock = vi.fn();
const axiosPostMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentityMock(...args),
  useLogout: () => ({ mutate: logoutMock }),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: {
        request: {
          use: vi.fn(),
        },
      },
      get: (...args: unknown[]) => axiosGetMock(...args),
      post: (...args: unknown[]) => axiosPostMock(...args),
    }),
  },
}));

describe("StudentLayout", () => {
  it("keeps the shell focused on navigation and account actions", async () => {
    useGetIdentityMock.mockReturnValue({
      data: { name: "stud-11", username: "test-16" },
    });
    axiosGetMock.mockResolvedValue({ data: [] });
    axiosPostMock.mockResolvedValue({});

    const { container } = render(
      <MemoryRouter initialEntries={["/student"]}>
        <Routes>
          <Route element={<StudentLayout />}>
            <Route path="/student" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /工作台/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /我的考试/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /错题回顾/i })).toBeInTheDocument();
    expect(screen.getByText("stud-11")).toBeInTheDocument();

    const activeLink = screen.getByRole("link", { name: /工作台/i });
    expect(activeLink.className).not.toContain("bg-foreground");

    await userEvent.click(screen.getByRole("button", { name: /stud-11/i }));
    expect(screen.getByText("账号：test-16")).toBeInTheDocument();

    expect(screen.queryByPlaceholderText(/搜索考试/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前考生/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(axiosGetMock).toHaveBeenCalledWith("/api/student/notifications/unread");
    });

    expect(container.querySelector("aside")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll("div")).some((element) => element.className.includes("max-w-[1200px]")),
    ).toBe(true);
  });
});
