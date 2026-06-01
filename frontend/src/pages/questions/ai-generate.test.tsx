import { useEffect } from "react";
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

vi.mock("@/components/ui/rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value.replace(/^<p>|<\/p>$/g, "")}
      onChange={(event) => onChange(`<p>${event.target.value}</p>`)}
    />
  ),
  htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, "").trim(),
}));

vi.mock("./components/ai-generate-loading-overlay", () => ({
  AIGenerateLoadingOverlay: () => null,
}));

vi.mock("@/components/questions/ai-question-config-panel", () => ({
  AIQuestionConfigPanel: ({
    title,
    footer,
    typeAlloc,
    onTypeAllocChange,
    totalCount,
    onTotalCountChange,
  }: {
    title: string;
    footer: React.ReactNode;
    typeAlloc: Record<string, number>;
    onTypeAllocChange: (value: Record<string, number>) => void;
    totalCount: number;
    onTotalCountChange: (value: number) => void;
  }) => {
    // 「开始生成」按钮在题型数量为 0 时禁用；模拟一个已配置题型的面板，
    // 让守卫相关用例能够进入生成流程。
    useEffect(() => {
      const total = Object.values(typeAlloc).reduce((sum, value) => sum + value, 0);
      if (total === 0) onTypeAllocChange({ ...typeAlloc, choice: 1 });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // 与真实面板一致：总数由各题型数量之和自动同步，保证校验通过。
    useEffect(() => {
      const total = Object.values(typeAlloc).reduce((sum, value) => sum + value, 0);
      if (totalCount !== total) onTotalCountChange(total);
    }, [typeAlloc, totalCount, onTotalCountChange]);
    return (
      <section>
        <h1>{title}</h1>
        {footer}
      </section>
    );
  },
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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));

    await screen.findByText("MySQL 默认端口是？");

    await user.click(screen.getByRole("link", { name: "跳转到题库列表" }));

    expect(screen.getByText("离开当前页面？")).toBeInTheDocument();
    expect(screen.getByText("当前生成的题目尚未保存到题库，确定离开当前页面吗？")).toBeInTheDocument();
    expect(screen.getAllByText("AI 智能出题").length).toBeGreaterThan(0);
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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));
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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("索引的作用是什么？");

    await user.click(screen.getByRole("button", { name: "按钮跳转到题库列表" }));

    expect(screen.getByText("离开当前页面？")).toBeInTheDocument();
    expect(screen.getByText("当前生成的题目尚未保存到题库，确定离开当前页面吗？")).toBeInTheDocument();
    expect(screen.getAllByText("AI 智能出题").length).toBeGreaterThan(0);
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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("MySQL 默认端口是？");

    await user.click(screen.getByRole("button", { name: /保存到题库/ }));

    await screen.findByText("题库列表");
    expect(screen.queryByText("离开当前页面？")).not.toBeInTheDocument();
  });

  it("saves course material prefilled questions to the root knowledge bank endpoint", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(
      "ai_generate_prefill_v1",
      JSON.stringify({
        kind: "course_material",
        node_id: "kp-child",
        node_name: "第1章 Python概述",
        course_name: "Python程序设计",
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/questions/ai-generate/stream")) {
        return mockStreamResponse({
          type: "question",
          data: {
            type: "choice",
            title: "Python 的特点是？",
            content: { text: "Python 的特点是？" },
            options: { A: "解释型", B: "只能编译运行" },
            answer: { correct: "A" },
            analysis: "Python 通常以解释方式运行。",
            difficulty: 2,
          },
        });
      }
      if (url.includes("/api/questions/save-generated-to-course-bank")) {
        return {
          ok: true,
          json: async () => ({ created: 1, created_question_ids: ["q-1"] }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ detail: `unexpected request: ${url}` }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("Python 的特点是？");
    await user.click(screen.getByRole("button", { name: /保存到题库/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/questions/save-generated-to-course-bank",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const saveCall = (
      fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>
    ).find(([url]) => String(url).includes("/api/questions/save-generated-to-course-bank"));
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(body.questions[0].knowledge_point_ids).toEqual(["kp-child"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/question-banks"))).toBe(false);
  });

  it("allows editing generated questions before saving", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
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
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

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

    await user.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("MySQL 默认端口是？");

    await user.click(screen.getByRole("button", { name: /编辑/ }));
    await user.clear(screen.getByLabelText("输入题目内容..."));
    await user.type(screen.getByLabelText("输入题目内容..."), "MySQL 默认监听端口是哪个？");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(screen.getByText("MySQL 默认监听端口是哪个？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /保存到题库/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const saveRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(saveRequest.questions[0].title).toBe("MySQL 默认监听端口是哪个？");
    expect(saveRequest.questions[0].content.text).toBe("MySQL 默认监听端口是哪个？");
    expect(saveRequest.questions[0].answer.correct).toBe("A");
  });
});
