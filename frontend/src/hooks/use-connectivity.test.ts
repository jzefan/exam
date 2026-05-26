import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectivity } from "./use-connectivity";

describe("useConnectivity", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");

  function setOnline(value: boolean) {
    Object.defineProperty(window.navigator, "onLine", {
      get: () => value,
      configurable: true,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalOnLine) {
      Object.defineProperty(window.navigator, "onLine", originalOnLine);
    }
  });

  it("starts online when navigator.onLine is true", () => {
    const { result } = renderHook(() => useConnectivity());
    expect(result.current.online).toBe(true);
  });

  it("goes offline immediately on offline event", () => {
    const { result } = renderHook(() => useConnectivity());
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);
  });

  it("debounces reconnect by 2s — not online immediately after online event", () => {
    const { result } = renderHook(() => useConnectivity());

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    // Still false — debounce hasn't fired yet
    expect(result.current.online).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.online).toBe(true);
  });

  it("cancels debounce if going offline again before 2s", () => {
    const { result } = renderHook(() => useConnectivity());

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      vi.advanceTimersByTime(1000); // half debounce
    });
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.online).toBe(false);
  });

  it("updates lastChangedAt on state change", () => {
    const { result } = renderHook(() => useConnectivity());
    const before = result.current.lastChangedAt;

    act(() => {
      vi.advanceTimersByTime(100);
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.lastChangedAt).toBeGreaterThan(before);
  });
});
