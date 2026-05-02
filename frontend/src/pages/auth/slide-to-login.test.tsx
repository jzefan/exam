import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SlideToLogin } from "./slide-to-login";

describe("SlideToLogin", () => {
  it("completes when pointer is released at the far right edge", async () => {
    const onComplete = vi.fn(() => true);
    const originalPointerEvent = window.PointerEvent;
    window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;

    try {
      render(<SlideToLogin onComplete={onComplete} />);

      const slider = screen.getByRole("button", { name: "滑动登录" });
      Object.defineProperty(slider, "setPointerCapture", {
        value: vi.fn(),
        configurable: true,
      });
      Object.defineProperty(slider, "getBoundingClientRect", {
        value: () => ({
          left: 0,
          top: 0,
          width: 300,
          height: 48,
          right: 300,
          bottom: 48,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
        configurable: true,
      });

      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 20 });
      await waitFor(() => expect(slider).toHaveClass("auth-slide-dragging"));
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 250 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientX: 294 });

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: "登录成功" })).toBeInTheDocument();
    } finally {
      window.PointerEvent = originalPointerEvent;
    }
  });
});
