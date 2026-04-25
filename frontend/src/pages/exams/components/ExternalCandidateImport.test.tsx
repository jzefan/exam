import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExternalCandidateImport } from "./ExternalCandidateImport";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

describe("ExternalCandidateImport", () => {
  it("renders header and import button", () => {
    render(<ExternalCandidateImport examId="00000000-0000-0000-0000-000000000001" />);

    expect(screen.getByText(/外部候选人/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加候选人/i })).toBeInTheDocument();
  });

  it("validates phone before submit", async () => {
    render(<ExternalCandidateImport examId="00000000-0000-0000-0000-000000000001" />);

    fireEvent.click(screen.getByRole("button", { name: /添加候选人/i }));

    await waitFor(() => {
      expect(screen.getByText(/请填写姓名和手机号/)).toBeInTheDocument();
    });
  });
});
