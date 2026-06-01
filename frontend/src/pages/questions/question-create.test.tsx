import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@/test/test-utils";

import { QuestionCreate } from "./create";

const { mutateMock, navigateMock, useCreateMock, useListMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  navigateMock: vi.fn(),
  useCreateMock: vi.fn(),
  useListMock: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({
  useCreate: () => useCreateMock(),
  useGetIdentity: () => ({ data: null }),
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="select" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
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

vi.mock("@/components/ui/page-intro-header", () => ({
  PageIntroHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/ui/rich-text-editor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder ?? "富文本编辑器"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  htmlToPlainText: (value: string) => value.replace(/<[^>]+>/g, "").trim(),
}));

vi.mock("@/components/ui/tag-selector", () => ({
  TagSelector: () => <div>TagSelector</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandInput: () => null,
  CommandList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandEmpty: () => null,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

describe("QuestionCreate", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    navigateMock.mockReset();
    useCreateMock.mockReturnValue({
      mutate: mutateMock,
      mutation: { isPending: false },
    });
    useListMock.mockReturnValue({
      query: {
        data: { data: [] },
      },
    });
  });

  it("defaults code questions to program mode and submits program content", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <QuestionCreate />
      </MemoryRouter>,
    );

    const selects = screen.getAllByLabelText("select");
    await user.selectOptions(selects[0], "code");

    expect(screen.getByText("作答模式")).toBeInTheDocument();
    expect(screen.getByText("完整程序题（推荐）")).toBeInTheDocument();
    expect(screen.getByText("输入说明")).toBeInTheDocument();
    expect(screen.getByText("输出说明")).toBeInTheDocument();

    await user.type(screen.getByLabelText("输入题目内容..."), "<p>请输出两个整数之和</p>");
    await user.type(screen.getByLabelText("输入说明"), "输入一行，包含两个整数。");
    await user.type(screen.getByLabelText("输出说明"), "输出它们的和。");
    await user.type(screen.getByLabelText("示例输入 1"), "1 2");
    await user.type(screen.getByLabelText("示例输出 1"), "3");
    await user.type(screen.getByLabelText("测试输入 1"), "1 2");
    await user.type(screen.getByLabelText("期望输出 1"), "3");

    await user.click(screen.getByRole("button", { name: "创建题目" }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "questions",
        values: expect.objectContaining({
          type: "code",
          content: expect.objectContaining({
            mode: "program",
            input_description: "输入一行，包含两个整数。",
            output_description: "输出它们的和。",
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  it("keeps the originating course knowledge node as create context", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/questions/create",
            state: {
              courseKpId: "node-1",
              successTo: "/courses/course-1?tab=knowledge&node_id=node-1",
            },
          },
        ]}
      >
        <QuestionCreate />
      </MemoryRouter>,
    );

    await user.selectOptions(screen.getAllByLabelText("select")[0], "code");
    await user.type(screen.getByLabelText("输入题目内容..."), "测试题目");
    await user.click(screen.getByRole("button", { name: "创建题目" }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          knowledge_point_ids: ["node-1"],
        }),
      }),
      expect.any(Object),
    );

    const [, options] = mutateMock.mock.calls[0];
    (options as { onSuccess: () => void }).onSuccess();
    expect(navigateMock).toHaveBeenCalledWith(
      "/courses/course-1?tab=knowledge&node_id=node-1",
    );
  });
});
