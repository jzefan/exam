import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveStateLabel } from "./save-state-label";

describe("SaveStateLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 已本地保存 by default (idle)", () => {
    render(<SaveStateLabel saveState="idle" />);
    expect(screen.getByText("已本地保存")).toBeInTheDocument();
  });

  it("shows 同步中... after 400ms debounce when saving", async () => {
    render(<SaveStateLabel saveState="saving" />);
    // Before debounce: still shows saved-local
    expect(screen.getByText("已本地保存")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("同步中...")).toBeInTheDocument();
  });

  it("does not show 同步中... if saving resolves before 400ms", () => {
    const { rerender } = render(<SaveStateLabel saveState="saving" />);
    act(() => {
      vi.advanceTimersByTime(300); // before the 400ms debounce
    });
    rerender(<SaveStateLabel saveState="saved" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Debounce was cancelled, syncing label should not appear
    expect(screen.queryByText("同步中...")).not.toBeInTheDocument();
    expect(screen.getByText("已同步")).toBeInTheDocument();
  });

  it("shows 已同步 immediately when saved, then fades to 已本地保存 after 2s", () => {
    render(<SaveStateLabel saveState="saved" />);
    expect(screen.getByText("已同步")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("已本地保存")).toBeInTheDocument();
  });

  it("shows pending sync label when error and pendingCount > 0", () => {
    render(<SaveStateLabel saveState="error" pendingCount={3} />);
    expect(screen.getByText("3 题待同步")).toBeInTheDocument();
  });

  it("shows 已本地保存 when error but pendingCount is 0", () => {
    render(<SaveStateLabel saveState="error" pendingCount={0} />);
    expect(screen.getByText("已本地保存")).toBeInTheDocument();
  });
});
