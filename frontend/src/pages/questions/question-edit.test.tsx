import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { QuestionEdit } from "./edit";

const { mutateMock, navigateMock, useUpdateMock, useOneMock, useListMock, paramsMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  navigateMock: vi.fn(),
  useUpdateMock: vi.fn(),
  useOneMock: vi.fn(),
  useListMock: vi.fn(),
  paramsMock: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({
  useUpdate: () => useUpdateMock(),
  useOne: (...args: unknown[]) => useOneMock(...args),
  useList: (...args: unknown[]) => useListMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => paramsMock(),
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

describe("QuestionEdit", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    navigateMock.mockReset();
    paramsMock.mockReturnValue({ id: "question-1" });
    useUpdateMock.mockReturnValue({
      mutate: mutateMock,
      mutation: { isPending: false },
    });
    useListMock.mockReturnValue({
      query: {
        data: { data: [] },
      },
    });
    useOneMock.mockReturnValue({
      query: {
        isLoading: false,
        data: {
          data: {
            id: "question-1",
            type: "code",
            title: "求和",
            content: {
              html: "<p>请输出两个整数之和</p>",
              text: "请输出两个整数之和",
              mode: "program",
              input_description: "输入两个整数",
              output_description: "输出它们的和",
              examples: [{ input: "1 2", output: "3" }],
              sample_tests: [{ input: "1 2", expected_output: "3" }],
            },
            options: null,
            answer: { code: "print(3)" },
            analysis: null,
            difficulty: 3,
            score: 10,
            usage_count: 0,
            question_bank_id: null,
            question_bank_name: null,
            tags: [],
            knowledge_points: [],
            created_by: "u1",
            created_by_name: "Teacher",
            created_at: "",
            updated_at: "",
          },
        },
      },
    });
  });

  it("loads program mode code question details and preserves mode on submit", async () => {
    const user = userEvent.setup();
    render(<QuestionEdit />);

    expect(screen.getByText("作答模式")).toBeInTheDocument();
    expect(screen.getByText("完整程序题（推荐）")).toBeInTheDocument();
    expect(screen.getByDisplayValue("输入两个整数")).toBeInTheDocument();
    expect(screen.getByDisplayValue("输出它们的和")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("输出说明"));
    await user.type(screen.getByLabelText("输出说明"), "输出一个整数，表示它们的和");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "questions",
        id: "question-1",
        values: expect.objectContaining({
          content: expect.objectContaining({
            mode: "program",
            input_description: "输入两个整数",
            output_description: "输出一个整数，表示它们的和",
          }),
        }),
      }),
      expect.any(Object),
    );
  });
});
