import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useEffect, type ComponentProps } from "react";

import { render, screen, waitFor } from "@/test/test-utils";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/pages/exams/components/ClassStudentSelector", () => ({
  ClassStudentSelector: ({
    onChange,
  }: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <button type="button" onClick={() => onChange(["student-1", "student-2"])}>
      选择学生
    </button>
  ),
}));

import { MaterialAIGenerateDialog } from "./MaterialAIGenerateDialog";

let latestPathname = "/";

function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    latestPathname = location.pathname;
  }, [location.pathname]);
  return null;
}

function buildGenerateStreamResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"question","data":{"type":"choice","title":"生成题目 1","content":{"text":"生成题目 1"},"options":{"A":"选项A"},"answer":{"correct":"A"},"analysis":"解析","difficulty":3}}\n\n',
        ),
      );
      controller.close();
    },
  });

  return {
    ok: true,
    body: stream,
    status: 200,
    json: async () => ({}),
  } as Response;
}

describe("MaterialAIGenerateDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastMock.mockReset();
    latestPathname = "/";
  });

  const renderDialog = (props?: Partial<ComponentProps<typeof MaterialAIGenerateDialog>>) =>
    render(
      <MemoryRouter>
        <LocationProbe />
        <MaterialAIGenerateDialog
          open
          onOpenChange={vi.fn()}
          knowledgePointId="kp-1"
          knowledgePointName="二叉树"
          knowledgePointPath="计算机科学 / 数据结构 / 二叉树"
          materialTitle="二叉树讲义"
          materialSourceText="资料正文"
          materialImages={[]}
          onSaved={vi.fn()}
          {...props}
        />
      </MemoryRouter>,
    );

  it("describes the generated question target as the root knowledge bank", () => {
    renderDialog();

    expect(screen.getByText(/题目将自动归入「主知识对应题库」/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存到「主知识对应题库」" })).toBeInTheDocument();
  });

  it("enables 生成练习 after generation and creates practice assignment from selected questions", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/questions/ai-generate/stream")) {
        return buildGenerateStreamResponse();
      }

      if (url.includes("/api/questions/save-generated-to-course-bank")) {
        return {
          ok: true,
          json: async () => ({ created: 1, created_question_ids: ["q-created-1"] }),
        } as Response;
      }

      if (url.includes("/api/exams")) {
        return {
          ok: true,
          json: async () => ({ id: "exam-1" }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ detail: "unexpected request" }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    renderDialog({ onOpenChange, onSaved });

    const createAssignmentButton = screen.getByRole("button", { name: "生成练习" });
    expect(createAssignmentButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "开始生成" }));

    await screen.findByText("生成题目 1");

    expect(createAssignmentButton).toBeEnabled();

    await user.click(createAssignmentButton);

    expect(screen.getByRole("textbox", { name: "练习标题" })).toHaveValue("二叉树 - 1题练习");

    await user.click(screen.getByRole("button", { name: "选择学生" }));
    await user.click(screen.getByRole("button", { name: "发布练习" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/questions/save-generated-to-course-bank",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/exams",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const examRequestCalls = fetchMock.mock.calls as unknown as Array<[
      RequestInfo | URL,
      RequestInit | undefined,
    ]>;
    const examRequestCall = examRequestCalls.find(([url]) => String(url).includes("/api/exams"));
    expect(examRequestCall).toBeTruthy();

    const examBody = JSON.parse(String(examRequestCall?.[1]?.body));
    expect(examBody).toMatchObject({
      title: "二叉树 - 1题练习",
      category: "practice",
      duration_minutes: 60,
      question_mode: "manual",
      student_ids: ["student-1", "student-2"],
      question_ids: ["q-created-1"],
    });
    expect(new Date(examBody.end_time).getTime()).toBeGreaterThan(new Date(examBody.start_time).getTime());

    expect(toastMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "练习已发布" })).toBeInTheDocument();
    expect(screen.getByText("二叉树 - 1题练习")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "查看练习" }));

    await waitFor(() => {
      expect(latestPathname).toBe("/exams/exam-1/view");
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows publish failure and keeps dialogs open when save succeeds but created_question_ids is empty", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/questions/ai-generate/stream")) {
        return buildGenerateStreamResponse();
      }

      if (url.includes("/api/questions/save-generated-to-course-bank")) {
        return {
          ok: true,
          json: async () => ({ created: 1, created_question_ids: [] }),
        } as Response;
      }

      if (url.includes("/api/exams")) {
        return {
          ok: true,
          json: async () => ({ id: "exam-should-not-be-called" }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ detail: "unexpected request" }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    renderDialog({ onOpenChange, onSaved });

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await screen.findByText("生成题目 1");
    await user.click(screen.getByRole("button", { name: "生成练习" }));
    await user.click(screen.getByRole("button", { name: "选择学生" }));
    await user.click(screen.getByRole("button", { name: "发布练习" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "发布练习失败",
          description: "保存题目成功但未返回可用于组卷的题目 ID",
          variant: "destructive",
        }),
      );
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/exams"))).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "生成练习" })).toBeInTheDocument();
  });

  it("shows publish failure and keeps dialogs open when /api/exams rejects after save succeeds", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/questions/ai-generate/stream")) {
        return buildGenerateStreamResponse();
      }

      if (url.includes("/api/questions/save-generated-to-course-bank")) {
        return {
          ok: true,
          json: async () => ({ created: 1, created_question_ids: ["q-created-1"] }),
        } as Response;
      }

      if (url.includes("/api/exams")) {
        return {
          ok: false,
          json: async () => ({ detail: "发布考试失败" }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ detail: "unexpected request" }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    renderDialog({ onOpenChange, onSaved });

    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await screen.findByText("生成题目 1");
    await user.click(screen.getByRole("button", { name: "生成练习" }));
    await user.click(screen.getByRole("button", { name: "选择学生" }));
    await user.click(screen.getByRole("button", { name: "发布练习" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "发布练习失败",
          description: "发布考试失败",
          variant: "destructive",
        }),
      );
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/exams"))).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "生成练习" })).toBeInTheDocument();
  });

  it("waits for the material to finish loading before generating", async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/questions/ai-generate/stream")) {
        return buildGenerateStreamResponse();
      }
      return {
        ok: false,
        json: async () => ({ detail: "unexpected request" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const buildTree = (materialLoading: boolean) => (
      <MemoryRouter>
        <MaterialAIGenerateDialog
          open
          onOpenChange={vi.fn()}
          knowledgePointId="kp-1"
          knowledgePointName="二叉树"
          knowledgePointPath="计算机科学 / 数据结构 / 二叉树"
          materialTitle="二叉树讲义"
          materialSourceText={materialLoading ? "" : "资料正文"}
          materialImages={[]}
          materialLoading={materialLoading}
          onSaved={vi.fn()}
        />
      </MemoryRouter>
    );

    const { rerender } = render(buildTree(true));

    // 资料仍在后台读取：弹窗已经打开，资料卡片给出进度提示
    expect(screen.getByText("正在读取资料…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始生成" }));

    // 资料没就绪：先挂起，不发请求，按钮转为等待态
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "等待资料就绪" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("资料读取中，完成后会自动开始生成"),
    ).toBeInTheDocument();

    // 资料读完后自动接上生成
    rerender(buildTree(false));

    await screen.findByText("生成题目 1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions/ai-generate/stream",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("blocks generation and explains when the material failed to load", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderDialog({
      materialLoadError: "仅支持 PDF / Word(.docx) / PowerPoint(.pptx) 文件用于智能出题。",
    });

    expect(screen.getByText("资料读取失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "资料读取失败",
        variant: "destructive",
      }),
    );
  });
});
