import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@/test/test-utils";

import { CodeQuestion } from "./code-question";

const { axiosPostMock, requestUseMock } = vi.hoisted(() => ({
  axiosPostMock: vi.fn(),
  requestUseMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean } | undefined)?.isAxiosError),
    create: () => ({
      post: (...args: unknown[]) => axiosPostMock(...args),
      interceptors: {
        request: {
          use: requestUseMock,
        },
      },
    }),
  },
}));

const registerCompletionItemProvider = vi.fn();

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="选择语言"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/latex-text", () => ({
  renderLatexInHtml: (value: string) => value,
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    language,
    value,
    onChange,
    options,
    beforeMount,
    path,
  }: {
    language?: string;
    value?: string;
    onChange?: (value?: string) => void;
    options?: Record<string, unknown>;
    beforeMount?: (monaco: {
      languages: {
        registerCompletionItemProvider: typeof registerCompletionItemProvider;
        CompletionItemKind: { Keyword: number; Function: number; Snippet: number; Class: number };
        CompletionItemInsertTextRule: { InsertAsSnippet: number };
      };
      Range: new (
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) => unknown;
    }) => void;
    path?: string;
  }) => {
    beforeMount?.({
      languages: {
        registerCompletionItemProvider,
        CompletionItemKind: {
          Keyword: 1,
          Function: 2,
          Snippet: 3,
          Class: 4,
        },
        CompletionItemInsertTextRule: {
          InsertAsSnippet: 4,
        },
      },
      Range: class MockRange {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
    });

    return (
      <textarea
        aria-label="代码编辑器"
        data-language={language}
        data-path={path}
        data-font-size={String(options?.fontSize ?? "")}
        data-tab-size={String(options?.tabSize ?? "")}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  },
}));

function CodeQuestionHarness({
  content,
}: {
  content?: Record<string, unknown>;
}) {
  const [answer, setAnswer] = useState<Record<string, unknown>>({});

  return (
    <MemoryRouter initialEntries={["/student/exams/exam-1"]}>
      <Routes>
        <Route
          path="/student/exams/:id"
          element={(
            <CodeQuestion
              question={{
                question_id: "code-1",
                order: 0,
                score: 20,
                type: "code",
                title: "实现求和",
                content: content ?? {
                  description: "<p>请完成函数。</p>",
                  starter_code: {
                    python: "def solve():\n    pass\n",
                    javascript: "function solve() {\n  return 0;\n}\n",
                    java: "class Solution {\n    public int solve() {\n        return 0;\n    }\n}\n",
                    cpp: "#include <iostream>\nusing namespace std;\n\nint solve() {\n    return 0;\n}\n",
                  },
                  sample_tests: [
                    {
                      input: "1 2\n",
                      expected_output: "3\n",
                    },
                  ],
                },
                options: null,
              }}
              answer={answer}
              onChange={setAnswer}
            />
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("CodeQuestion", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    requestUseMock.mockReset();
  });

  it("keeps separate code content for each language when switching", async () => {
    const user = userEvent.setup();
    render(<CodeQuestionHarness />);

    const editor = screen.getByLabelText("代码编辑器");
    const languageSelect = screen.getByLabelText("选择语言");

    await user.clear(editor);
    await user.type(editor, "print('python')\n");
    await user.selectOptions(languageSelect, "javascript");

    expect(screen.getByLabelText("代码编辑器")).toHaveAttribute("data-language", "javascript");
    expect(screen.getByLabelText("代码编辑器")).toHaveValue("function solve() {\n  return 0;\n}\n");

    await user.clear(screen.getByLabelText("代码编辑器"));
    await user.type(screen.getByLabelText("代码编辑器"), "console.log('js');\n");

    await user.selectOptions(languageSelect, "python");
    expect(screen.getByLabelText("代码编辑器")).toHaveValue("print('python')\n");

    await user.selectOptions(languageSelect, "javascript");
    expect(screen.getByLabelText("代码编辑器")).toHaveValue("console.log('js');\n");
  });

  it("uses Monaco language-specific configuration and registers completion providers", () => {
    render(<CodeQuestionHarness />);

    expect(screen.getByLabelText("代码编辑器")).toHaveAttribute("data-font-size", "14");
    expect(screen.getByLabelText("代码编辑器")).toHaveAttribute("data-tab-size", "4");
    expect(screen.getByLabelText("代码编辑器")).toHaveAttribute("data-path", "file:///student-exam/code-1/solution.py");
    expect(registerCompletionItemProvider).toHaveBeenCalledWith(
      "python",
      expect.objectContaining({
        provideCompletionItems: expect.any(Function),
      }),
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledWith(
      "javascript",
      expect.objectContaining({
        provideCompletionItems: expect.any(Function),
      }),
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledWith(
      "java",
      expect.objectContaining({
        provideCompletionItems: expect.any(Function),
      }),
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledWith(
      "cpp",
      expect.objectContaining({
        provideCompletionItems: expect.any(Function),
      }),
    );
  });

  it("renders program mode guidance without function signature metadata", () => {
    render(
      <CodeQuestionHarness
        content={{
          mode: "program",
          description: "<p>请编写完整程序，输出两个整数之和。</p>",
          input_description: "输入一行，包含两个整数 a 和 b。",
          output_description: "输出一个整数，表示 a+b。",
          examples: [
            {
              input: "1 2",
              output: "3",
            },
          ],
          starter_code: {
            python: "a, b = map(int, input().split())\nprint(a + b)\n",
          },
          sample_tests: [
            {
              input: "1 2\n",
              expected_output: "3\n",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("输入说明")).toBeInTheDocument();
    expect(screen.getByText("输入一行，包含两个整数 a 和 b。")).toBeInTheDocument();
    expect(screen.getByText("输出说明")).toBeInTheDocument();
    expect(screen.getByText("输出一个整数，表示 a+b。")).toBeInTheDocument();
    expect(screen.queryByText("函数签名")).not.toBeInTheDocument();
  });

  it("renders function mode metadata for advanced function questions", () => {
    render(
      <CodeQuestionHarness
        content={{
          mode: "function",
          description: "<p>请实现 twoSum 函数。</p>",
          function_name: "twoSum",
          signature: "twoSum(nums: int[], target: int) -> int[]",
          starter_code: {
            python: "def twoSum(nums, target):\n    pass\n",
          },
          sample_tests: [
            {
              input: "nums=[2,7,11,15], target=9",
              expected_output: "[0,1]",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("函数签名")).toBeInTheDocument();
    expect(screen.getByText("twoSum(nums: int[], target: int) -> int[]")).toBeInTheDocument();
    expect(screen.getAllByText("twoSum")).toHaveLength(2);
  });

  it("disables run controls while a run is in flight", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ data: Record<string, unknown> }>();
    axiosPostMock.mockReturnValueOnce(deferred.promise);

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    expect(screen.getByRole("button", { name: "运行中..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "恢复模板" })).toBeDisabled();
    expect(screen.getByLabelText("选择语言")).toBeDisabled();

    deferred.resolve({
      data: {
        status: "passed",
        mode: "sample",
        language: "python",
        stdout: "",
        stderr: "",
        compile_output: "",
        time_ms: 18,
        memory_kb: 2048,
        case_count: 1,
        passed_count: 1,
        cases: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "运行代码" })).toBeEnabled();
    });
  });

  it("renders a draggable splitter for the lower test and result workspace", () => {
    render(<CodeQuestionHarness />);

    expect(screen.getByRole("button", { name: "调整上下区域高度" })).toBeInTheDocument();
  });

  it("restores only the current language starter code when clicking reset", async () => {
    const user = userEvent.setup();
    render(<CodeQuestionHarness />);

    const editor = screen.getByLabelText("代码编辑器");
    const languageSelect = screen.getByLabelText("选择语言");

    await user.clear(editor);
    await user.type(editor, "print('python custom')\n");
    await user.selectOptions(languageSelect, "javascript");
    await user.clear(screen.getByLabelText("代码编辑器"));
    await user.type(screen.getByLabelText("代码编辑器"), "console.log('custom js');\n");

    await user.click(screen.getByRole("button", { name: "恢复模板" }));
    expect(screen.getByLabelText("代码编辑器")).toHaveValue("function solve() {\n  return 0;\n}\n");
    expect(screen.getByText("已恢复 JavaScript 模板代码。")).toBeInTheDocument();

    await user.selectOptions(languageSelect, "python");
    expect(screen.getByLabelText("代码编辑器")).toHaveValue("print('python custom')\n");
  });

  it("renders sample run summary and per-case details", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "failed",
        mode: "sample",
        language: "python",
        stdout: "",
        stderr: "",
        compile_output: "",
        time_ms: 18,
        memory_kb: 2048,
        case_count: 2,
        passed_count: 1,
        cases: [
          {
            name: "示例 1",
            input: "1 2\n",
            expected_output: "3\n",
            actual_output: "3\n",
            status: "passed",
            time_ms: 18,
            memory_kb: 2048,
            message: "",
          },
          {
            name: "示例 2",
            input: "2 2\n",
            expected_output: "5\n",
            actual_output: "4\n",
            status: "failed",
            time_ms: 18,
            memory_kb: 2048,
            message: "答案与预期不一致",
          },
        ],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(axiosPostMock).toHaveBeenCalledWith("/api/student/exams/exam-1/questions/code-1/run", {
        language: "python",
        code: "def solve():\n    pass\n",
        mode: "sample",
      });
    });

    expect(screen.getByText("示例测试结果：1 个通过，1 个未通过")).toBeInTheDocument();
    expect(screen.getByText("通过用例")).toBeInTheDocument();
    expect(screen.getByText("未通过用例")).toBeInTheDocument();
    expect(screen.getByText("示例 1")).toBeInTheDocument();
    expect(screen.getAllByText("通过").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未通过").length).toBeGreaterThan(0);
    expect(screen.getByText("答案与预期不一致")).toBeInTheDocument();
    expect(screen.getAllByText((content) => content.trim() === "1 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.trim() === "3").length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.trim() === "4").length).toBeGreaterThan(0);
  });

  it("clears stale run details after the student edits code", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "passed",
        mode: "sample",
        language: "python",
        stdout: "",
        stderr: "",
        compile_output: "",
        time_ms: 18,
        memory_kb: 2048,
        case_count: 1,
        passed_count: 1,
        cases: [
          {
            name: "示例 1",
            input: "1 2\n",
            expected_output: "3\n",
            actual_output: "3\n",
            status: "passed",
            time_ms: 18,
            memory_kb: 2048,
            message: "",
          },
        ],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getByText("示例 1")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("代码编辑器"), "# update");

    expect(screen.queryByText("示例 1")).not.toBeInTheDocument();
    expect(screen.getByText("代码已更新，请重新运行以查看最新结果。")).toBeInTheDocument();
  });

  it("renders custom run details without sample scoring", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "compile_error",
        mode: "custom",
        language: "python",
        stdout: "stdout text\n",
        stderr: "stderr text\n",
        compile_output: "compile output text\n",
        time_ms: 12,
        memory_kb: 1024,
        case_count: 0,
        passed_count: 0,
        cases: [],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "自定义测试" }));
    fireEvent.change(screen.getByLabelText("自定义输入"), {
      target: { value: "nums = [1, 2]\n" },
    });
    await user.clear(screen.getByLabelText("代码编辑器"));
    await user.type(screen.getByLabelText("代码编辑器"), "print('custom input')\n");
    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(axiosPostMock).toHaveBeenCalledWith("/api/student/exams/exam-1/questions/code-1/run", {
        language: "python",
        code: "print('custom input')\n",
        mode: "custom",
        custom_input: "nums = [1, 2]\n",
      });
    });

    expect(screen.getByText("自定义输入执行结果：编译错误")).toBeInTheDocument();
    expect(screen.getByText("执行结果")).toBeInTheDocument();
    expect(screen.getByText("执行失败：编译错误")).toBeInTheDocument();
    expect(screen.getByText("用户输入")).toBeInTheDocument();
    expect(screen.getAllByText("nums = [1, 2]").length).toBeGreaterThan(0);
    expect(screen.getByText("运行输出")).toBeInTheDocument();
    expect(screen.getByText("stdout text")).toBeInTheDocument();
    expect(screen.getByText("错误输出")).toBeInTheDocument();
    expect(screen.getByText("stderr text")).toBeInTheDocument();
    expect(screen.getByText("编译输出")).toBeInTheDocument();
    expect(screen.getByText("compile output text")).toBeInTheDocument();
    expect(screen.queryByText(/已通过 .* 个示例测试/)).not.toBeInTheDocument();
  });

  it("shows custom runs as completed instead of passed when execution succeeds", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "passed",
        mode: "custom",
        language: "python",
        stdout: "3\n",
        stderr: "",
        compile_output: "",
        time_ms: 10,
        memory_kb: 512,
        case_count: 0,
        passed_count: 0,
        cases: [],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "自定义测试" }));
    fireEvent.change(screen.getByLabelText("自定义输入"), {
      target: { value: "nums=[1,2]\ntarget=3" },
    });
    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getByText("自定义输入已执行，运行输出见下方。")).toBeInTheDocument();
    });

    expect(screen.getByText("执行结果")).toBeInTheDocument();
    expect(screen.getByText("代码已成功执行，并产生了运行输出。")).toBeInTheDocument();
    expect(screen.getByText("运行输出")).toBeInTheDocument();
    expect(screen.queryByText("运行状态：通过")).not.toBeInTheDocument();
    expect(screen.queryByText(/已通过 .* 个示例测试/)).not.toBeInTheDocument();
  });

  it("shows explicit no-output feedback for successful custom runs without stdout", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "passed",
        mode: "custom",
        language: "python",
        stdout: "",
        stderr: "",
        compile_output: "",
        time_ms: 10,
        memory_kb: 512,
        case_count: 0,
        passed_count: 0,
        cases: [],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "自定义测试" }));
    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getByText("自定义输入已执行，但程序没有输出任何内容。")).toBeInTheDocument();
    });

    expect(screen.getByText("代码已成功执行，但没有产生标准输出。")).toBeInTheDocument();
    expect(screen.getByText("程序没有输出任何内容。")).toBeInTheDocument();
  });

  it("translates top-level run errors into Chinese copy", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          detail: "system_error",
        },
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getByText("运行失败：系统异常，请稍后重试。")).toBeInTheDocument();
    });
    expect(screen.queryByText("system_error")).not.toBeInTheDocument();
  });

  it("shows toolchain availability errors directly when the runtime is missing", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          detail: "当前运行环境未安装 go，暂不支持 go 在线运行。",
        },
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getByText("当前运行环境未安装 go，暂不支持 go 在线运行。")).toBeInTheDocument();
    });
  });

  it("shows sample-mode system errors instead of misleading 0/0 pass counts", async () => {
    const user = userEvent.setup();
    axiosPostMock.mockResolvedValue({
      data: {
        status: "system_error",
        mode: "sample",
        language: "go",
        stdout: "",
        stderr: "当前运行环境未安装 go，暂不支持 go 在线运行。",
        compile_output: "当前运行环境未安装 go，暂不支持 go 在线运行。",
        time_ms: 0,
        memory_kb: 0,
        case_count: 0,
        passed_count: 0,
        cases: [],
      },
    });

    render(<CodeQuestionHarness />);

    await user.click(screen.getByRole("button", { name: "运行代码" }));

    await waitFor(() => {
      expect(screen.getAllByText("当前运行环境未安装 go，暂不支持 go 在线运行。").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
    expect(screen.getAllByText("错误输出").length).toBeGreaterThan(0);
    expect(screen.getAllByText("编译输出").length).toBeGreaterThan(0);
  });
});
