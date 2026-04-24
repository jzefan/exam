import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, Link, MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom";

import { render, screen, waitFor } from "@/test/test-utils";

import { AIGeneratePage } from "./ai-generate";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ui/latex-text", () => ({
  LatexText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./components/ai-generate-loading-overlay", () => ({
  AIGenerateLoadingOverlay: () => null,
}));

vi.mock("@/components/questions/ai-question-config-panel", () => ({
  AIQuestionConfigPanel: ({
    title,
    footer,
  }: {
    title: string;
    footer: React.ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {footer}
    </section>
  ),
}));

function mockStreamResponse(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    body,
  } as Response;
}

function TestLayout() {
  return (
    <div>
      <Link to="/questions">跳转到题库列表</Link>
      <NavigateButton />
      <Outlet />
    </div>
  );
}

function NavigateButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/questions")}>
      按钮跳转到题库列表
    </button>
  );
}

describe("AIGeneratePage unsaved guards", () => {
  beforeEach(() => {
    toastMock.mockReset();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("blocks in-app navigation when generated questions have not been saved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse({
          type: "question",
          data: {
            type: "choice",
            title: "MySQL 默认端口是？",
            content: { text: "MySQL 默认端口是？" },
            options: { A: "3306", B: "8080" },
            answer: { correct: "A" },
            analysis: "3306 是默认端口",
            difficulty: 2,
          },
        }),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/questions/ai-generate"]}>
        <Routes>
          <Route path="/" element={<TestLayout />}>
            <Route path="questions/ai-generate" element={<AIGeneratePage />} />
            <Route path="questions" element={<div>题库列表</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "开始生成" }));

    await screen.findByText("MySQL 默认端口是？");

    await user.click(screen.getByRole("link", { name: "跳转到题库列表" }));

    expect(screen.getByText("离开当前页面？")).toBeInTheDocument();
    expect(screen.getByText("当前生成的题目尚未保存到题库，确定离开当前页面吗？")).toBeInTheDocument();
    expect(screen.getByText("AI 智能出题")).toBeInTheDocument();
    expect(screen.queryByText("题库列表")).not.toBeInTheDocument();
  });

  it("warns before browser unload when generated questions have not been saved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse({
          type: "question",
          data: {
            type: "choice",
            title: "事务隔离级别有哪些？",
            content: { text: "事务隔离级别有哪些？" },
            options: null,
            answer: { text: "读未提交、读已提交、可重复读、串行化" },
            analysis: null,
            difficulty: 3,
          },
        }),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/questions/ai-generate"]}>
        <Routes>
          <Route path="/questions/ai-generate" element={<AIGeneratePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await screen.findByText("事务隔离级别有哪些？");

    const event = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(event, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const beforeUnloadEvent = event as unknown as { returnValue?: string };

    const dispatchResult = window.dispatchEvent(event);

    await waitFor(() => {
      expect(dispatchResult).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(beforeUnloadEvent.returnValue).toBe("");
    });
  });

  it("blocks programmatic navigation when generated questions have not been saved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse({
          type: "question",
          data: {
            type: "choice",
            title: "索引的作用是什么？",
            content: { text: "索引的作用是什么？" },
            options: { A: "提高查询效率", B: "删除数据" },
            answer: { correct: "A" },
            analysis: "索引主要用于提高查询效率",
            difficulty: 2,
          },
        }),
      ),
    );

    window.history.pushState({}, "", "/questions/ai-generate");

    render(
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TestLayout />}>
            <Route path="questions/ai-generate" element={<AIGeneratePage />} />
            <Route path="questions" element={<div>题库列表</div>} />
          </Route>
        </Routes>
      </BrowserRouter>,
    );

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await screen.findByText("索引的作用是什么？");

    await user.click(screen.getByRole("button", { name: "按钮跳转到题库列表" }));

    expect(screen.getByText("离开当前页面？")).toBeInTheDocument();
    expect(screen.getByText("当前生成的题目尚未保存到题库，确定离开当前页面吗？")).toBeInTheDocument();
    expect(screen.getByText("AI 智能出题")).toBeInTheDocument();
    expect(screen.queryByText("题库列表")).not.toBeInTheDocument();
  });

  it("does not warn after saving generated questions to the bank", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          mockStreamResponse({
            type: "question",
            data: {
              type: "choice",
              title: "MySQL 默认端口是？",
              content: { text: "MySQL 默认端口是？" },
              options: { A: "3306", B: "8080" },
              answer: { correct: "A" },
              analysis: "3306 是默认端口",
              difficulty: 2,
            },
          }),
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: "bank-1", name: "AI题库" }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ created: 1 }),
        } as Response),
    );

    render(
      <MemoryRouter initialEntries={["/questions/ai-generate"]}>
        <Routes>
          <Route path="/" element={<TestLayout />}>
            <Route path="questions/ai-generate" element={<AIGeneratePage />} />
            <Route path="questions" element={<div>题库列表</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await screen.findByText("MySQL 默认端口是？");

    await user.click(screen.getByRole("button", { name: /保存到题库/ }));

    await screen.findByText("题库列表");
    expect(screen.queryByText("离开当前页面？")).not.toBeInTheDocument();
  });
});
