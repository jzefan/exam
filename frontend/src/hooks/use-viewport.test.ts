import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useIsMobile, useMediaQuery } from "./use-viewport";

type MqlListener = () => void;

function mockMatchMedia(initialMatches: boolean) {
  const listeners: Set<MqlListener> = new Set();

  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((_: string, cb: MqlListener) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: MqlListener) => listeners.delete(cb)),
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mql),
  });

  return { mql, trigger: () => listeners.forEach((l) => l()) };
}

describe("useMediaQuery", () => {
  it("returns true when query matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
  });

  it("returns false when query does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);
  });

  it("updates when matchMedia fires a change event", () => {
    const { mql, trigger } = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);

    act(() => {
      mql.matches = true;
      trigger();
    });

    expect(result.current).toBe(true);
  });

  it("cleans up event listener on unmount", () => {
    const { mql } = mockMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

describe("useIsMobile", () => {
  it("is true at 767px breakpoint", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("is false on desktop", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
