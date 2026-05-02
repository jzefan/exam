import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import axios from "axios";

import { render, screen, waitFor } from "@/test/test-utils";

import { LoginPage } from "./login";

const loginMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useLogin: () => ({ mutate: loginMock, isPending: false }),
}));

vi.mock("axios");

describe("LoginPage", () => {
  beforeEach(() => {
    loginMock.mockReset();
    vi.mocked(axios.post).mockReset();
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
});
