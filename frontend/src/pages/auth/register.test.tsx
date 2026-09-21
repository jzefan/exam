import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen } from "@/test/test-utils";

import { RegisterPage } from "./register";

const registerMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useRegister: () => ({ mutate: registerMock, isPending: false }),
}));

describe("RegisterPage", () => {
  it("submits evaluator role with selected account persona", async () => {
    const user = userEvent.setup();
    registerMock.mockClear();

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("radio", { name: /通用测评/ }));
    await user.type(screen.getByLabelText("用户名"), "assessor");
    await user.type(screen.getByLabelText("邮箱"), "assessor@example.com");
    await user.type(screen.getByLabelText("密码"), "123456");
    await user.type(screen.getByLabelText("确认密码"), "123456");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "assessor",
        email: "assessor@example.com",
        full_name: "assessor",
        role_name: "evaluator",
        persona: "assessor",
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("shows the registration conflict returned by the auth provider", async () => {
    const user = userEvent.setup();
    registerMock.mockImplementationOnce((_values, options) => {
      options.onSuccess({
        success: false,
        error: { name: "注册失败", message: "该用户名已存在，请更换后重试" },
      });
    });

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "jiang");
    await user.type(screen.getByLabelText("密码"), "12345678");
    await user.type(screen.getByLabelText("确认密码"), "12345678");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByText("该用户名已存在，请更换后重试")).toBeInTheDocument();
  });

  it("does not suggest phone-based account recovery before SMS is supported", () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.getByPlaceholderText("请设置登录用户名")).toBeInTheDocument();
    expect(screen.queryByText("使用手机号作为用户名，后续登录和找回账号会更方便。")).not.toBeInTheDocument();
  });

  it("does not advertise the sign-up page to students", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    // Students get an account from their teacher; the header must not invite "师生".
    expect(screen.queryByText(/师生/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /我是学生/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /我是学生/ }));
    expect(screen.getByText("学生无需注册")).toBeInTheDocument();
  });

  it("guides students to their teacher instead of registering them", async () => {
    const user = userEvent.setup();
    registerMock.mockClear();

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("radio", { name: /我是学生/ }));

    expect(screen.getByText("学生无需注册")).toBeInTheDocument();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注册" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去登录" })).toBeInTheDocument();

    // Switching back to a staff persona restores the form.
    await user.click(screen.getByRole("radio", { name: /教学考试/ }));
    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });
});
