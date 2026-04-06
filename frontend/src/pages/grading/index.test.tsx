import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";
import { GradingCenterPage } from "./index";

describe("GradingCenterPage", () => {
  it("renders an inbox grouped by status and exam, then shows candidate list and scoring panel", () => {
    render(<GradingCenterPage />);

    expect(screen.getByRole("heading", { name: "阅卷中心" })).toBeInTheDocument();
    expect(screen.getByText("待我确定")).toBeInTheDocument();
    expect(screen.getByText("AI 已确定的")).toBeInTheDocument();
    expect(screen.getByText("Java 后端期中考试")).toBeInTheDocument();
    expect(screen.getByText("考生列表")).toBeInTheDocument();
    expect(screen.getByText("评分面板")).toBeInTheDocument();
  });

  it("switches question from the inbox and updates the candidate list with the scoring panel", async () => {
    const user = userEvent.setup();
    render(<GradingCenterPage />);

    await user.click(screen.getByRole("button", { name: /代码题 5/i }));

    expect(screen.getByText("代码题 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /考生 B-208/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /考生 D-024/i })).toBeInTheDocument();
    expect(screen.getByText("Qwen")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定分数" })).toBeInTheDocument();
  });
});
