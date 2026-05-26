import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { render, screen, waitFor } from "@/test/test-utils";

import { OperationsActivityLogsPage } from "./activity-logs";

const apiGetMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/operations/activity-logs"]}>
      <OperationsActivityLogsPage />
    </MemoryRouter>,
  );
}

describe("OperationsActivityLogsPage", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it("renders rows returned by the API and shows the filter bar", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/api/operations/activity-logs/facets") {
        return Promise.resolve({
          data: {
            event_categories: ["auth", "exam"],
            event_types: ["login", "exam_start"],
            roles: ["teacher", "student"],
          },
        });
      }
      if (url === "/api/operations/activity-logs") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "log-1",
                user_id: "u1",
                username: "alice",
                full_name: "Alice Liu",
                role_name: "teacher",
                event_category: "auth",
                event_type: "login",
                target_type: null,
                target_id: null,
                event_metadata: { ip: "1.2.3.4" },
                ip_address: "1.2.3.4",
                user_agent: "Mozilla",
                success: true,
                created_at: "2026-05-17T08:00:00Z",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Alice Liu")).toBeInTheDocument();
    });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("教师")).toBeInTheDocument();
    expect(screen.getByText("登录")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索用户名 / 姓名")).toBeInTheDocument();
  });

  it("shows empty state when no rows returned", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/api/operations/activity-logs/facets") {
        return Promise.resolve({ data: { event_categories: [], event_types: [], roles: [] } });
      }
      if (url === "/api/operations/activity-logs") {
        return Promise.resolve({ data: { items: [], total: 0, page: 1, page_size: 20 } });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("没有符合条件的活动日志")).toBeInTheDocument();
    });
  });
});
