import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { render, screen, waitFor } from "@/test/test-utils";
import {
  clearBackgroundTaskNotices,
  upsertBackgroundTaskNotice,
} from "@/hooks/use-background-task-notice";
import { persistQuestionImportJobId } from "@/pages/questions/question-knowledge-recognition";

import { BackgroundTaskNoticeHost } from "./background-task-notice-host";

describe("BackgroundTaskNoticeHost", () => {
  beforeEach(() => {
    clearBackgroundTaskNotices();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows recognition progress in the top center on the import page", async () => {
    upsertBackgroundTaskNotice({
      id: "question-knowledge-recognition",
      title: "知识点正在后台识别",
      progressText: "17/1393",
      description: "可离开当前页面继续其它操作，系统会在后台继续识别知识点。",
      pagePath: "/questions/import",
    });

    render(
      <MemoryRouter initialEntries={["/questions/import"]}>
        <Routes>
          <Route
            path="*"
            element={<BackgroundTaskNoticeHost />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("知识点正在后台识别")).toBeInTheDocument();
    expect(screen.getByText("17/1393")).toBeInTheDocument();
    expect(screen.getByText("可离开当前页面继续其它操作，系统会在后台继续识别知识点。")).toBeInTheDocument();
    expect(screen.getByTestId("background-task-notice-question-knowledge-recognition")).toHaveAttribute(
      "data-position",
      "center",
    );
  });

  it("keeps the same notice as a bottom-right floating card after leaving the import page", async () => {
    upsertBackgroundTaskNotice({
      id: "question-knowledge-recognition",
      title: "知识点正在后台识别",
      progressText: "17/1393",
      description: "可离开当前页面继续其它操作，系统会在后台继续识别知识点。",
      pagePath: "/questions/import",
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="*"
            element={<BackgroundTaskNoticeHost />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("知识点正在后台识别")).toBeInTheDocument();
    expect(screen.getByTestId("background-task-notice-question-knowledge-recognition")).toHaveAttribute(
      "data-position",
      "floating",
    );
  });

  it("dismisses the floating recognition notice when the persisted import job is completed", async () => {
    persistQuestionImportJobId("job-1");
    upsertBackgroundTaskNotice({
      id: "question-knowledge-recognition",
      title: "知识点正在后台识别",
      progressText: "9/10",
      description: "可离开当前页面继续其它操作，系统会在后台继续识别知识点。",
      pagePath: "/questions/import",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "job-1",
          user_id: "user-1",
          status: "completed",
          total_count: 10,
          processed_count: 10,
          matched_count: 9,
          unmatched_count: 1,
          failed_count: 0,
          created_question_ids: [],
          error_message: null,
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z",
          completed_at: "2026-04-30T00:01:00Z",
        }),
      }),
    );

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="*"
            element={<BackgroundTaskNoticeHost />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("background-task-notice-question-knowledge-recognition")).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem("active_question_import_job_id")).toBeNull();
  });
});
