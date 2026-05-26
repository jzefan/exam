import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { Layout } from "./layout";

const useGetIdentityMock = vi.fn();
const logoutMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentityMock(...args),
  useLogout: () => ({ mutate: logoutMock }),
}));

vi.mock("./theme-customizer", () => ({
  ThemeCustomizer: () => <button type="button">界面定制</button>,
}));

vi.mock("./notifications/notification-center", () => ({
  NotificationCenter: () => <button type="button">消息</button>,
}));

describe("Layout operations navigation", () => {
  beforeEach(() => {
    useGetIdentityMock.mockReset();
    logoutMock.mockReset();
  });

  it("shows operations management only for platform admins", () => {
    useGetIdentityMock.mockReturnValue({
      data: { name: "Admin", primary_org: { role_name: "platform_admin" } },
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("运营管理")).toBeInTheDocument();
  });

  it("hides operations management from teachers", () => {
    useGetIdentityMock.mockReturnValue({
      data: { name: "Teacher", primary_org: { role_name: "teacher" } },
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("运营管理")).not.toBeInTheDocument();
  });
});
