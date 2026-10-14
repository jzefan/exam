import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "@/test/test-utils";

import StudentManagementPage from "./index";

type MockStudent = {
  id: string;
  full_name: string;
  phone: string | null;
  student_id: string;
  username: string;
  is_active: boolean;
  class_id: string | null;
  class_name: string | null;
  owner_teacher_id: string | null;
};

const { apiRequestMock, toastMock, usePermissionsMock, useGetIdentityMock, resetStudents, setDefaultApiImplementation } = vi.hoisted(() => {
  const initialStudents: MockStudent[] = [
    {
      id: "student-1",
      full_name: "张三",
      phone: "13800000001",
      student_id: "S001",
      username: "13800000001",
      is_active: true,
      class_id: "class-1",
      class_name: "一班",
      owner_teacher_id: "teacher-1",
    },
    {
      id: "student-2",
      full_name: "李四",
      phone: null,
      student_id: "S002",
      username: "S002",
      is_active: true,
      class_id: null,
      class_name: null,
      owner_teacher_id: "teacher-1",
    },
  ];

  let currentStudents = initialStudents.map((student) => ({ ...student }));
  const defaultApiImplementation = (path: string, options?: { method?: string; body?: string }) => {
    if (path === "/rbac/students/classes") {
      return Promise.resolve([{ id: "class-1", name: "一班" }]);
    }

    if (path === "/rbac/students") {
      return Promise.resolve(currentStudents);
    }

    if (path === "/rbac/students?unassigned=true") {
      return Promise.resolve(currentStudents.filter((student) => student.class_id === null));
    }

    if (path.startsWith("/rbac/students?class_id=")) {
      const classId = path.split("=")[1];
      return Promise.resolve(currentStudents.filter((student) => student.class_id === classId));
    }

    if (path.startsWith("/rbac/students/") && options?.method === "DELETE") {
      const studentId = path.split("/").pop();
      currentStudents = currentStudents.filter((student) => student.id !== studentId);
      return Promise.resolve(undefined);
    }

    if (path.startsWith("/rbac/students/") && path.endsWith("/reset-password") && options?.method === "POST") {
      return Promise.resolve({ password_source: "student_id" });
    }

    if (path === "/rbac/students/batch-delete" && options?.method === "POST") {
      const body = JSON.parse(options.body ?? "{\"student_ids\":[]}") as { student_ids: string[] };
      currentStudents = currentStudents.filter((student) => !body.student_ids.includes(student.id));
      return Promise.resolve({ success_count: body.student_ids.length, failed_count: 0, errors: [] });
    }

    return Promise.reject(new Error(`Unexpected request: ${path}`));
  };

  const apiRequestMock = vi.fn(defaultApiImplementation);

  return {
    usePermissionsMock: vi.fn(() => ({ data: "teacher" })),
    useGetIdentityMock: vi.fn(() => ({ data: { persona: "teacher" } })),
    toastMock: vi.fn(),
    resetStudents: () => {
      currentStudents = initialStudents.map((student) => ({ ...student }));
    },
    setDefaultApiImplementation: () => {
      apiRequestMock.mockImplementation(defaultApiImplementation);
    },
    apiRequestMock,
  };
});

vi.mock("@refinedev/core", () => ({
  usePermissions: () => usePermissionsMock(),
  useGetIdentity: () => useGetIdentityMock(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/pages/grading/api", () => ({
  apiRequest: apiRequestMock,
}));

describe("StudentManagementPage", () => {
  beforeEach(() => {
    resetStudents();
    apiRequestMock.mockReset();
    setDefaultApiImplementation();
    toastMock.mockClear();
    usePermissionsMock.mockReturnValue({ data: "teacher" });
    useGetIdentityMock.mockReturnValue({ data: { persona: "teacher" } });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("supports filtering unassigned students from the left sidebar", async () => {
    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "未分班" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students?unassigned=true");
    });

    expect(await screen.findByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.getByText("未分班学生")).toBeInTheDocument();
  });

  it("uses exam candidate and department wording for assessor persona", async () => {
    useGetIdentityMock.mockReturnValue({ data: { persona: "assessor" } });

    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("部门列表")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部考生" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "未分部门" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加考生/ })).toBeInTheDocument();
    expect(screen.queryByText("学生管理")).not.toBeInTheDocument();
  });

  it("keeps the current student rows visible while switching class filters", async () => {
    let unassignedResolver: ((value: MockStudent[]) => void) | null = null;
    const classStudents: MockStudent[] = [
      {
        id: "student-1",
        full_name: "张三",
        phone: "13800000001",
        student_id: "S001",
        username: "13800000001",
        is_active: true,
        class_id: "class-1",
        class_name: "一班",
        owner_teacher_id: "teacher-1",
      },
    ];
    let requestCount = 0;
    apiRequestMock.mockImplementation(((
      path: string,
      options?: { method?: string; body?: string }
    ) => {
        requestCount += 1;
        if (path === "/rbac/students/classes" && requestCount === 1) {
          return Promise.resolve([{ id: "class-1", name: "一班" }]);
        }
        if (path === "/rbac/students" && requestCount === 2) {
          return Promise.resolve(classStudents);
        }
        if (path === "/rbac/students?unassigned=true") {
          return new Promise<MockStudent[]>((resolve) => {
            unassignedResolver = resolve;
          });
        }
        return Promise.reject(new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`));
      }) as never);

    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "未分班" }));

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.queryByText("正在加载...")).not.toBeInTheDocument();
    expect(screen.getByText("加载中...")).toBeInTheDocument();

    const resolveUnassigned = unassignedResolver as ((value: MockStudent[]) => void) | null;
    expect(resolveUnassigned).not.toBeNull();
    if (resolveUnassigned) {
      resolveUnassigned([
        {
          id: "student-2",
          full_name: "李四",
          phone: null,
          student_id: "S002",
          username: "S002",
          is_active: true,
          class_id: null,
          class_name: null,
          owner_teacher_id: "teacher-1",
        },
      ]);
    }

    expect(await screen.findByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });

  it("supports deleting a single student from the list", async () => {
    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "移除 张三" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students/student-1", { method: "DELETE" });
    });

    await waitFor(() => {
      expect(screen.queryByText("张三")).not.toBeInTheDocument();
    });
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("supports resetting a student password from the list", async () => {
    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重置密码 张三" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students/student-1/reset-password", { method: "POST" });
    });
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "密码已重置",
          description: "张三 的初始密码已重置为学号：S001。",
        })
      );
    });
  });

  it("supports selecting current students and deleting them in batch", async () => {
    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "全选当前列表学生" }));
    await user.click(screen.getByRole("button", { name: "批量移除" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students/batch-delete", {
        method: "POST",
        body: JSON.stringify({ student_ids: ["student-1", "student-2"] }),
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("张三")).not.toBeInTheDocument();
      expect(screen.queryByText("李四")).not.toBeInTheDocument();
    });
  });

  it("shows an inline retry after the first student request fails", async () => {
    let attempts = 0;
    apiRequestMock.mockImplementation(((path: string) => {
      if (path === "/rbac/students/classes") return Promise.resolve([{ id: "class-1", name: "一班" }]);
      if (path === "/rbac/students") {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("network unavailable"))
          : Promise.resolve([{
            id: "student-1", full_name: "张三", phone: "13800000001", student_id: "S001",
            username: "13800000001", is_active: true, class_id: "class-1", class_name: "一班", owner_teacher_id: "teacher-1",
          }]);
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }) as never);

    const user = userEvent.setup();
    render(<StudentManagementPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("列表加载失败");
    expect(screen.queryByText("未找到匹配的学生。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("张三")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("lets phone users search classes, inspect a student, and enter selection mode", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" || query === "(max-width: 1199px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const user = userEvent.setup();
      render(<StudentManagementPage />);

      await user.click(await screen.findByRole("button", { name: "查看 张三" }));
      expect(screen.getByRole("dialog", { name: "张三" })).toBeInTheDocument();
      expect(screen.getByText("S001")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "返回列表" }));

      await user.click(screen.getByRole("button", { name: /班级：全部学生/ }));
      expect(screen.getByRole("dialog", { name: "选择班级" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "删除班级 一班" })).not.toBeInTheDocument();
      await user.type(screen.getByRole("textbox", { name: "搜索班级" }), "一班");
      expect(screen.getByRole("button", { name: "一班" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "一班" }));
      await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("/rbac/students?class_id=class-1"));

      await user.click(screen.getByRole("button", { name: /班级：一班/ }));
      await user.click(screen.getByRole("button", { name: "管理班级" }));
      expect(screen.getByRole("dialog", { name: "管理班级" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "返回选择" }));
      await user.click(screen.getByRole("button", { name: "Close" }));

      await user.click(screen.getByRole("button", { name: "选择" }));
      expect(screen.getByRole("checkbox", { name: "选择 张三" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "查看 张三" })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("uses the compact list with batch import at tablet widths", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 1199px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(<StudentManagementPage />);
      expect(await screen.findByRole("button", { name: "查看 张三" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /班级：全部学生/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "批量导入" })).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
