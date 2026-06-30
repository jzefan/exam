import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test/test-utils";

import { QuestionSelector } from "./QuestionSelector";

const useListMock = vi.fn();

vi.mock("@refinedev/core", () => ({
  useList: (...args: unknown[]) => useListMock(...args),
  useGetIdentity: () => ({ data: { primary_org: { role_name: "teacher" } } }),
}));

describe("QuestionSelector", () => {
  it("shows a full question preview after clicking a manual selection row", async () => {
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

    await user.click(screen.getByRole("button", { name: /下面关于 tcp 三次握手的说法/i }));

    await waitFor(() => {
      expect(screen.getAllByText("下面关于 TCP 三次握手的说法，正确的是？").length).toBeGreaterThan(1);
    });
    expect(
      screen.getAllByText((_, element) => element?.textContent === "A. 客户端发送 SYN").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("解析")).toBeInTheDocument();
    expect(screen.getByText("握手的第一步由客户端发起 SYN。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭题目详情" }));

    await waitFor(() => {
      expect(screen.queryByText("解析")).not.toBeInTheDocument();
    });
  });

  it("calls the edit handler from the expanded question preview", async () => {
    const question = {
      id: "question-edit",
      type: "choice",
      title: "默认标题",
      content: { text: "可以被编辑的题目" },
      options: { A: "选项 A", B: "选项 B" },
      answer: { correct: "A" },
      analysis: "解析",
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
    };
    useListMock.mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      return {
        query: {
          data: {
            data: [question],
            total: 1,
          },
          isLoading: false,
        },
      };
    });

    const user = userEvent.setup();
    const onEditQuestion = vi.fn();
    render(<QuestionSelector onChange={vi.fn()} selectedIds={[]} onEditQuestion={onEditQuestion} />);

    await user.click(screen.getByRole("button", { name: /可以被编辑的题目/i }));
    await user.click(await screen.findByRole("button", { name: "编辑题目" }));

    expect(onEditQuestion).toHaveBeenCalledWith(question);
  });

  it("renders latex content in the manual selection list row", async () => {
    useListMock.mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }

      return {
        query: {
          data: {
            data: [
              {
                id: "question-latex",
                type: "fill_in",
                title: "latex-title",
                content: { text: "求解方程 $x^2 + 1 = 0$ 的复数根。" },
                options: null,
                answer: { correct: ["i", "-i"] },
                analysis: null,
                difficulty: 3,
                score: 5,
                usage_count: 0,
                question_bank_id: "bank-1",
                question_bank_name: "数学",
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

    render(<QuestionSelector onChange={vi.fn()} selectedIds={[]} />);

    const rowButton = await screen.findByRole("button", { name: /求解方程/i });
    expect(rowButton.querySelector(".katex")).not.toBeNull();
  });
});
