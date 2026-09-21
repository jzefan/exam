import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import axios from "axios";

import { render, screen, waitFor } from "@/test/test-utils";

import {
  ROLE_SELECTION_REQUIRED,
  clearPendingRoleSelection,
  getPendingRoleSelection,
  loginWithSelectedRole,
} from "@/providers/auth-provider";

import { LoginPage } from "./login";

const loginMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useLogin: () => ({ mutate: loginMock, isPending: false }),
}));

vi.mock("@/providers/auth-provider", () => ({
  ROLE_SELECTION_REQUIRED: "role-selection-required",
  getPendingRoleSelection: vi.fn(),
  clearPendingRoleSelection: vi.fn(),
  loginWithSelectedRole: vi.fn(),
}));

vi.mock("axios");

describe("LoginPage", () => {
  beforeEach(() => {
    loginMock.mockReset();
    vi.mocked(axios.post).mockReset();
    vi.mocked(getPendingRoleSelection).mockReset();
    vi.mocked(clearPendingRoleSelection).mockReset();
    vi.mocked(loginWithSelectedRole).mockReset();
  });

  it("shows a visible error when slide login fails", async () => {
    const user = userEvent.setup();
    loginMock.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.({
        success: false,
        error: {
          name: "登录失败",
          message: "用户名或密码错误，请检查后重试",
        },
      });
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "teacher");
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    screen.getByRole("button", { name: "滑动登录" }).focus();
    await user.keyboard("{Enter}");

    expect(loginMock).toHaveBeenCalledWith(
      { username: "teacher", password: "wrong-password" },
      expect.any(Object),
    );
    expect(await screen.findByText("用户名或密码错误，请检查后重试")).toBeInTheDocument();
  });

  it("shows forgot password result from account lookup", async () => {
    const user = userEvent.setup();
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        status: "contact_admin",
        message: "该账号注册时未留下邮箱，请联系管理员重置密码。",
        email: null,
      },
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "忘记密码？" }));
    await user.type(screen.getByLabelText("账号"), "no-email-user");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith("/api/auth/forgot-password", {
        account: "no-email-user",
      });
    });
    expect(await screen.findByText("该账号注册时未留下邮箱，请联系管理员重置密码。")).toBeInTheDocument();
  });

  it("disables forgot password resend after reset email is sent", async () => {
    const user = userEvent.setup();
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        status: "email_sent",
        message: "重置链接已发送至绑定邮箱，请查收。",
        email: "u***r@example.com",
      },
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "忘记密码？" }));
    await user.type(screen.getByLabelText("账号"), "email-user");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));

    expect(await screen.findByText("重置链接已发送至绑定邮箱，请查收。")).toBeInTheDocument();
    const sentButton = screen.getByRole("button", { name: "已发送，请查收邮箱" });
    expect(sentButton).toBeDisabled();

    await user.click(sentButton);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("asks for a role when the account holds several roles", async () => {
    const user = userEvent.setup();
    loginMock.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.({
        success: false,
        error: { name: ROLE_SELECTION_REQUIRED, message: "该账号有多个角色，请选择登录身份" },
      });
    });
    vi.mocked(getPendingRoleSelection).mockReturnValue({
      username: "18752933596",
      selectionToken: "ticket-1",
      roles: [
        { name: "teacher", display_name: "教师", org_names: ["江苏卫生健康职业学院"] },
        { name: "student", display_name: "学生", org_names: ["2025级健康大数据班"] },
      ],
    });
    vi.mocked(loginWithSelectedRole).mockResolvedValue({ redirectTo: "/dashboard" });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "18752933596");
    await user.type(screen.getByLabelText("密码"), "pw");
    screen.getByRole("button", { name: "滑动登录" }).focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "选择登录身份" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /学生/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /教师/ }));

    await waitFor(() => {
      expect(loginWithSelectedRole).toHaveBeenCalledWith("ticket-1", "teacher");
    });
  });

  it("keeps the role step and shows the error when picking a role fails", async () => {
    const user = userEvent.setup();
    loginMock.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.({
        success: false,
        error: { name: ROLE_SELECTION_REQUIRED, message: "该账号有多个角色，请选择登录身份" },
      });
    });
    vi.mocked(getPendingRoleSelection).mockReturnValue({
      username: "18752933596",
      selectionToken: "ticket-2",
      roles: [{ name: "teacher", display_name: "教师", org_names: [] }],
    });
    vi.mocked(loginWithSelectedRole).mockRejectedValue(new Error("身份选择已过期，请重新登录"));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "18752933596");
    await user.type(screen.getByLabelText("密码"), "pw");
    screen.getByRole("button", { name: "滑动登录" }).focus();
    await user.keyboard("{Enter}");

    await user.click(await screen.findByRole("button", { name: /教师/ }));

    expect(await screen.findByText("身份选择已过期，请重新登录")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "选择登录身份" })).toBeInTheDocument();
  });

  it("returns to the credential step when the account is wrong", async () => {
    const user = userEvent.setup();
    loginMock.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.({
        success: false,
        error: { name: ROLE_SELECTION_REQUIRED, message: "该账号有多个角色，请选择登录身份" },
      });
    });
    vi.mocked(getPendingRoleSelection).mockReturnValue({
      username: "18752933596",
      selectionToken: "ticket-3",
      roles: [{ name: "teacher", display_name: "教师", org_names: [] }],
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "18752933596");
    await user.type(screen.getByLabelText("密码"), "pw");
    screen.getByRole("button", { name: "滑动登录" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "返回，换个账号" }));

    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
    expect(clearPendingRoleSelection).toHaveBeenCalled();
  });
});
