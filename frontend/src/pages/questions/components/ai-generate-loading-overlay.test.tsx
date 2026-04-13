import { describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";

import { AIGenerateLoadingOverlay } from "./ai-generate-loading-overlay";

describe("AIGenerateLoadingOverlay", () => {
  it("renders loading text and generated count", () => {
    render(<AIGenerateLoadingOverlay generatedCount={3} />);

    expect(screen.getByText("正在生成题目")).toBeInTheDocument();
    expect(screen.getByText("AI 正在根据已选知识点和参数生成题目，请稍候。")).toBeInTheDocument();
    expect(screen.getByText("已生成 3 道")).toBeInTheDocument();
  });
});
