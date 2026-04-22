import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { render, screen } from "@/test/test-utils";
import {
  clearBackgroundTaskNotices,
  upsertBackgroundTaskNotice,
} from "@/hooks/use-background-task-notice";

import { BackgroundTaskNoticeHost } from "./background-task-notice-host";

describe("BackgroundTaskNoticeHost", () => {
  beforeEach(() => {
    clearBackgroundTaskNotices();
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
});
