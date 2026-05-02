import axios from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";
import { ResetPasswordPage } from "./reset-password";

vi.mock("axios");

describe("ResetPasswordPage", () => {
  it("submits token and new password", async () => {
    const user = userEvent.setup();
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { message: "密码已重置，请使用新密码登录" },
    });

    render(
      <MemoryRouter initialEntries={["/reset-password?token=abc123"]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("新密码"), "newpass123");
    await user.type(screen.getByLabelText("确认密码"), "newpass123");
    await user.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith("/api/auth/reset-password", {
        token: "abc123",
        password: "newpass123",
      });
    });
    expect(await screen.findByText("登录页")).toBeInTheDocument();
  });
});
