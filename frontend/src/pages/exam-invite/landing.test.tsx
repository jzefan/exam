import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CandidateLanding } from "./landing";

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({
      data: {
        access_token: "jwt.token.here",
        exam_id: "11111111-1111-1111-1111-111111111111",
        candidate_name: "Cand A",
      },
    }),
  },
}));

describe("CandidateLanding", () => {
  it("redeems token from URL and shows welcome", async () => {
    render(
      <MemoryRouter initialEntries={["/exam-invite?token=abc123abc123abc123abc"]}>
        <CandidateLanding />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Cand A/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /开始考试/ })).toBeInTheDocument();
  });

  it("shows error on bad token", async () => {
    const { apiClient } = await import("@/lib/api");
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { data: { detail: "Invitation revoked" } },
    });

    render(
      <MemoryRouter initialEntries={["/exam-invite?token=bad"]}>
        <CandidateLanding />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Invitation revoked/)).toBeInTheDocument();
    });
  });
});
