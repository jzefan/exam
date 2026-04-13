import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";

import { StudentSelector } from "./StudentSelector";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn((path: string) => {
  if (path === "/rbac/students") {
    return Promise.resolve([
      {
        id: "student-1",
        username: "13800000001",
        email: "zhangsan@example.com",
        full_name: "张三",
        phone: "13800000001",
        student_id: "S001",
        class_id: "class-1",
        class_name: "一班",
        is_active: true,
        primary_org: null,
        organizations: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "student-2",
        username: "13800000002",
        email: "lisi@example.com",
        full_name: "李四",
        phone: "13800000002",
        student_id: "S002",
        class_id: "class-2",
        class_name: "二班",
        is_active: true,
        primary_org: null,
        organizations: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ]);
  }

  if (path === "/rbac/students/classes") {
    return Promise.resolve([
      { id: "class-1", name: "一班" },
      { id: "class-2", name: "二班" },
    ]);
  }

  return Promise.reject(new Error(`Unexpected path: ${path}`));
  }),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

describe("StudentSelector", () => {
  it("renders selected students without applying a themed selected background to the whole item", async () => {
    const { container } = render(<StudentSelector selectedIds={["student-1"]} onChange={vi.fn()} />);

    const selectedButtons = await screen.findAllByRole("button", { name: /张三/i });
    const selectedItem = selectedButtons.find((button) => button.getAttribute("aria-pressed") === "true");
    expect(selectedItem).toBeDefined();
    expect(selectedItem?.className).not.toContain("bg-primary/5");

    const grid = container.querySelector("[data-student-grid='true']");
    expect(grid?.className).toContain("grid");
    expect(grid?.className).toContain("md:grid-cols-2");
    expect(grid?.className).toContain("xl:grid-cols-4");
  });

  it("merges the selected summary and selected student chips into a single top section", async () => {
    render(<StudentSelector selectedIds={["student-1", "student-2"]} onChange={vi.fn()} />);

    expect(
      await screen.findByText((_, element) => element?.textContent === "已选 2 名考生"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /清空选择/i })).toBeInTheDocument();
    expect(screen.getByText("张三、李四")).toBeInTheDocument();
    expect(screen.queryByText("已选考生")).not.toBeInTheDocument();
  });

  it("supports selecting students by class and across classes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<StudentSelector selectedIds={[]} onChange={onChange} />);

    await user.click(await screen.findByRole("button", { name: "一班" }));
    expect(onChange).toHaveBeenLastCalledWith(["student-1"]);

    onChange.mockClear();
    view.rerender(<StudentSelector selectedIds={["student-1"]} onChange={onChange} />);
    await user.click(await screen.findByRole("button", { name: "二班" }));
    expect(onChange).toHaveBeenLastCalledWith(["student-1", "student-2"]);
  });

  it("supports selecting all students in the current visible list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StudentSelector selectedIds={[]} onChange={onChange} />);

    await user.click(await screen.findByRole("button", { name: /全选当前列表/i }));

    expect(onChange).toHaveBeenLastCalledWith(["student-1", "student-2"]);
  });

  it("shows manual add fields for name, phone, optional student id, and class", async () => {
    const user = userEvent.setup();
    render(<StudentSelector selectedIds={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /手动添加/i }));

    expect(screen.getByLabelText("姓名")).toBeInTheDocument();
    expect(screen.getByLabelText("手机号")).toBeInTheDocument();
    expect(screen.getByLabelText("学号（可选）")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加考生/i })).toBeInTheDocument();
  });

  it("autofills phone, student id, and class when the entered name uniquely matches an existing student", async () => {
    const user = userEvent.setup();
    render(<StudentSelector selectedIds={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: /手动添加/i }));
    await user.type(screen.getByLabelText("姓名"), "张三");

    await waitFor(() => {
      expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
    });

    expect(screen.getByLabelText("学号（可选）")).toHaveValue("S001");
    expect(screen.getByRole("combobox", { name: "" })).toHaveTextContent("一班");
    expect(screen.getByText(/已匹配到系统中的学生信息/i)).toBeInTheDocument();
  });

  it("adds the matched existing student to the current exam when submitting manual add", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StudentSelector selectedIds={[]} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: /手动添加/i }));
    await user.type(screen.getByLabelText("姓名"), "张三");

    await waitFor(() => {
      expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
    });

    await user.click(screen.getByRole("button", { name: /添加考生/i }));

    expect(onChange).toHaveBeenCalledWith(["student-1"]);
  });
});
