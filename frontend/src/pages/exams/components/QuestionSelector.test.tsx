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
      expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
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

  it("supports tree-based knowledge point filtering and selects a parent node", async () => {
    const listCalls: Array<{ resource: string; filters?: Array<{ field: string; value: unknown }> }> = [];
    useListMock.mockImplementation((params: { resource: string; filters?: Array<{ field: string; value: unknown }> }) => {
      listCalls.push(params);
      if (params.resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }
      return {
        query: {
          data: {
            data: [],
            total: 0,
          },
          isLoading: false,
        },
      };
    });

    const user = userEvent.setup();
    const tree = {
      id: "course-root",
      name: "计算机网络",
      question_count: 10,
      material_count: 0,
      children: [
        {
          id: "chapter-1",
          name: "第一章 概述",
          question_count: 4,
          material_count: 0,
          children: [
            {
              id: "kp-1-1",
              name: "1.1 互联网结构",
              question_count: 2,
              material_count: 0,
              children: [],
            },
          ],
        },
        {
          id: "chapter-2",
          name: "第二章 物理层",
          question_count: 6,
          material_count: 0,
          children: [],
        },
      ],
    };

    render(
      <QuestionSelector
        onChange={vi.fn()}
        selectedIds={[]}
        knowledgeTree={tree}
      />,
    );

    const trigger = screen.getByRole("button", { name: "按知识点筛选" });
    expect(trigger).toHaveTextContent("全部知识点");

    await user.click(trigger);

    expect(screen.getByText("计算机网络")).toBeInTheDocument();
    expect(screen.getByText("第一章 概述")).toBeInTheDocument();
    expect(screen.getByText("第二章 物理层")).toBeInTheDocument();

    await user.click(screen.getByText("第一章 概述"));

    await waitFor(() => {
      expect(trigger).toHaveTextContent("第一章 概述");
    });

    const questionFilterCall = listCalls.find(
      (c) =>
        c.resource === "questions" &&
        c.filters?.some((f) => f.field === "knowledge_point_id" && f.value === "chapter-1"),
    );
    expect(questionFilterCall).toBeDefined();

    // 重新打开并选择根知识点「计算机网络」
    await user.click(trigger);
    await user.click(screen.getByText("计算机网络"));

    await waitFor(() => {
      expect(trigger).toHaveTextContent("计算机网络");
    });

    const rootFilterCall = listCalls.find(
      (c) =>
        c.resource === "questions" &&
        c.filters?.some((f) => f.field === "knowledge_point_id" && f.value === "course-root"),
    );
    expect(rootFilterCall).toBeDefined();
  });

  it("does not show pagination buttons and displays total count cleanly", async () => {
    useListMock.mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "question-banks") {
        return { query: { data: { data: [] }, isLoading: false } };
      }
      return {
        query: {
          data: {
            data: [
              {
                id: "q-1",
                type: "choice",
                title: "题目1",
                content: { text: "滚动列表题目1" },
                options: null,
                answer: {},
                analysis: null,
                difficulty: 1,
                score: 2,
                tags: [],
                knowledge_points: [],
              },
            ],
            total: 302,
          },
          isLoading: false,
        },
      };
    });

    render(<QuestionSelector onChange={vi.fn()} selectedIds={[]} />);

    // 确认已无上一页/下一页分页按钮和页码指示
    expect(screen.queryByRole("button", { name: "上一页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前第/)).not.toBeInTheDocument();
    expect(screen.getByText("共 302 道题目")).toBeInTheDocument();
    expect(screen.getByText("滚动列表题目1")).toBeInTheDocument();
  });
});
