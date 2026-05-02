import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CandidatePublicLanding } from "./public-landing";

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({
      data: {
        access_token: "public.jwt.token",
        exam_id: "22222222-2222-2222-2222-222222222222",
        candidate_name: "外部考生",
      },
    }),
  },
}));

describe("CandidatePublicLanding", () => {
  it("asks for candidate information and redeems a public link", async () => {
    const user = userEvent.setup();
    const { apiClient } = await import("@/lib/api");

    render(
      <MemoryRouter initialEntries={["/exam-public?token=public-token"]}>
        <Routes>
          <Route path="/exam-public" element={<CandidatePublicLanding />} />
          <Route path="/exam-invite/take/:examId" element={<div>进入答题页</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("姓名"), "张三");
    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.click(screen.getByRole("button", { name: "进入考试/练习" }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith("/api/exam-public/redeem", {
        token: "public-token",
        full_name: "张三",
        phone: "13800138000",
      });
    });
    expect(await screen.findByText("进入答题页")).toBeInTheDocument();
  });

  it("shows an error when token is missing", () => {
    render(
      <MemoryRouter initialEntries={["/exam-public"]}>
        <CandidatePublicLanding />
      </MemoryRouter>,
    );

    expect(screen.getByText("缺少公开链接令牌")).toBeInTheDocument();
  });
});
