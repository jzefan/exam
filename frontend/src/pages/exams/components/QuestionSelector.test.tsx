import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";

import { QuestionSelector } from "./QuestionSelector";

const useListMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
}));

describe("QuestionSelector", () => {
  it("shows a full question preview on hover for manual selection", async () => {
    useListMock.mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      return {
        query: {
          data: {
            data: [
              {
                id: "question-1",
                type: "choice",
                title: "默认标题",
                content: { text: "下面关于 TCP 三次握手的说法，正确的是？" },
                options: { A: "客户端发送 SYN", B: "服务端发送 ACK" },
                answer: { correct: "A" },
                analysis: "握手的第一步由客户端发起 SYN。",
                difficulty: 3,
                score: 5,
                usage_count: 0,
                question_bank_id: "bank-1",
                question_bank_name: "网络基础",
                tags: [],
                knowledge_points: [],
                created_by: "user-1",
                created_by_name: "Teacher",
                created_at: "2026-04-01T00:00:00Z",
                updated_at: "2026-04-01T00:00:00Z",
              },
            ],
            total: 1,
          },
          isLoading: false,
        },
      };
    });

    const user = userEvent.setup();
    render(<QuestionSelector onChange={vi.fn()} selectedIds={[]} />);

    await user.hover(screen.getByRole("button", { name: /下面关于 tcp 三次握手的说法/i }));

    await waitFor(() => {
      expect(screen.getAllByText("下面关于 TCP 三次握手的说法，正确的是？").length).toBeGreaterThan(1);
    });
    expect(screen.getByText("A. 客户端发送 SYN")).toBeInTheDocument();
    expect(screen.getByText(/答案：A/)).toBeInTheDocument();
  });
});
