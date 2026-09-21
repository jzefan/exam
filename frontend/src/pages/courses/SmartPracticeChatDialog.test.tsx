import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { apiClient } from "@/lib/api";
import { render, screen, waitFor } from "@/test/test-utils";

import { SmartPracticeChatDialog } from "./SmartPracticeChatDialog";

vi.mock("@/lib/api", () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock("@/pages/exams/components/ClassStudentSelector", () => ({
  ClassStudentSelector: ({
    onChange,
    defaultClassIds,
  }: {
    onChange: (ids: string[]) => void;
    defaultClassIds?: string[];
  }) => (
    <button
      type="button"
      data-default-class-ids={defaultClassIds?.join(",") ?? ""}
      onClick={() => onChange(["student-1"])}
    >
      选择测试学生
    </button>
  ),
}));

const mockPost = vi.mocked(apiClient.post);

function streamResponse(
  title: string,
  difficulty = 3,
  statusMessage?: string,
): Response {
  return streamQuestionsResponse([title], difficulty, statusMessage);
}

function streamQuestionsResponse(
  titles: string[],
  difficulty = 3,
  statusMessage?: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (statusMessage) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "status",
              stage: "reasoning",
              message: statusMessage,
            })}\n\n`,
          ),
        );
      }
      titles.forEach((title) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
            type: "question",
            data: {
              type: "choice",
              title,
              content: { text: title },
              options: { A: "正确", B: "错误" },
              answer: { correct: "A" },
              analysis: "解析",
              difficulty,
            },
          })}\n\n`,
          ),
        );
      });
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    json: async () => ({}),
  } as Response;
}

function renderDialog() {
  return render(
    <SmartPracticeChatDialog
      open
      onOpenChange={vi.fn()}
      courseName="计算机网络"
      courseKpId="course-kp-1"
      courseSemesterId="semester-1"
      defaultClassIds={["class-1"]}
      knowledgeOptions={[
        {
          id: "kp-chapter-1",
          name: "第一章",
          path: "计算机网络 / 第一章",
        },
      ]}
    />,
  );
}

describe("SmartPracticeChatDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPost.mockReset();
  });

  it("课程没有现有题目时仍可发送提示词并生成题目", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(streamResponse("网络分层题"));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    const input = screen.getByRole("textbox", { name: "练习对话输入" });
    await user.type(input, "生成 10 道第一章的题目");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("本轮生成 1 道题")).toBeInTheDocument();
    expect(screen.getAllByText("网络分层题").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "确定题目" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("练习名称"),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("支持继续对话，并把上一轮题单作为本轮上下文", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamResponse("基础网络题", 3))
      .mockResolvedValueOnce(streamResponse("进阶网络题", 4));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    const input = screen.getByRole("textbox", { name: "练习对话输入" });
    await user.type(input, "生成 10 道题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("本轮生成 1 道题");

    await user.type(input, "再难一点");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(secondRequest.body)) as {
      total_count: number;
      difficulty: number;
      prompt: string;
    };
    expect(body.total_count).toBe(10);
    expect(body.difficulty).toBe(4);
    expect(body.prompt).toContain("基础网络题");
    expect(body.prompt).toContain("最新要求：再难一点");
  });

  it("更换第 4 题时只生成一道并合并回上一轮题单", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamQuestionsResponse(["题目1", "题目2", "题目3", "原第4题", "题目5"]),
      )
      .mockResolvedValueOnce(
        streamResponse("新第4题", 3, "正在规划替换题的考点"),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    const input = screen.getByRole("textbox", { name: "练习对话输入" });
    await user.type(input, "生成5道题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("本轮生成 5 道题");

    await user.type(input, "更换一下第4题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("已替换第 4 题");

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(secondRequest.body)) as {
      total_count: number;
      prompt: string;
      type_distribution: Record<string, number>;
    };
    expect(body.total_count).toBe(1);
    expect(body.type_distribution).toEqual({ single_choice: 1 });
    expect(body.prompt).toContain("原第4题");
    expect(screen.getByText("正在规划替换题的考点")).toBeInTheDocument();
    expect(screen.getByText("当前选择 5 道题")).toBeInTheDocument();
    expect(screen.getAllByText("新第4题").length).toBeGreaterThan(0);
  });

  it("发布最新一轮选中的 AI 题目", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamResponse("网络协议题")),
    );
    mockPost
      .mockResolvedValueOnce({
        data: { created_question_ids: ["question-1"] },
      })
      .mockResolvedValueOnce({ data: { id: "practice-1" } });
    renderDialog();

    const input = screen.getByRole("textbox", { name: "练习对话输入" });
    await user.type(input, "生成 1 道选择题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("本轮生成 1 道题");
    await user.click(screen.getByRole("button", { name: "确定题目" }));

    expect(screen.getByLabelText("练习名称")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "练习对话输入" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择测试学生" })).toHaveAttribute(
      "data-default-class-ids",
      "class-1",
    );
    await user.click(screen.getByRole("button", { name: "选择测试学生" }));
    await user.click(screen.getByRole("button", { name: /确定发布/ }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost.mock.calls[0][0]).toBe(
      "/api/questions/save-generated-to-course-bank",
    );
    expect(mockPost.mock.calls[1][0]).toBe("/api/exams");
    expect(mockPost.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        category: "practice",
        question_ids: ["question-1"],
        student_ids: ["student-1"],
      }),
    );
  });
});
