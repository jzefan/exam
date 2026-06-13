import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { useSwipe } from "./use-swipe";

type Pt = { clientX: number; clientY: number };

function touchEvent(touches: Pt[], changedTouches: Pt[]): ReactTouchEvent {
  return { touches, changedTouches } as unknown as ReactTouchEvent;
}

function setup() {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  const { result } = renderHook(() =>
    useSwipe({ onSwipeLeft, onSwipeRight }, { threshold: 60, restraint: 80 }),
  );
  return { handlers: result.current, onSwipeLeft, onSwipeRight };
}

describe("useSwipe", () => {
  it("fires onSwipeLeft when finger moves right-to-left past the threshold", () => {
    const { handlers, onSwipeLeft, onSwipeRight } = setup();
    handlers.onTouchStart(touchEvent([{ clientX: 300, clientY: 200 }], []));
    handlers.onTouchEnd(touchEvent([], [{ clientX: 200, clientY: 210 }]));
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("fires onSwipeRight when finger moves left-to-right past the threshold", () => {
    const { handlers, onSwipeLeft, onSwipeRight } = setup();
    handlers.onTouchStart(touchEvent([{ clientX: 100, clientY: 200 }], []));
    handlers.onTouchEnd(touchEvent([], [{ clientX: 220, clientY: 195 }]));
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("ignores short movements below the threshold (taps)", () => {
    const { handlers, onSwipeLeft, onSwipeRight } = setup();
    handlers.onTouchStart(touchEvent([{ clientX: 100, clientY: 200 }], []));
    handlers.onTouchEnd(touchEvent([], [{ clientX: 130, clientY: 205 }]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("ignores mostly-vertical gestures (scrolls)", () => {
    const { handlers, onSwipeLeft, onSwipeRight } = setup();
    handlers.onTouchStart(touchEvent([{ clientX: 200, clientY: 100 }], []));
    handlers.onTouchEnd(touchEvent([], [{ clientX: 120, clientY: 300 }]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("ignores multi-touch gestures (pinch/zoom)", () => {
    const { handlers, onSwipeLeft, onSwipeRight } = setup();
    handlers.onTouchStart(
      touchEvent(
        [
          { clientX: 300, clientY: 200 },
          { clientX: 320, clientY: 220 },
        ],
        [],
      ),
    );
    handlers.onTouchEnd(touchEvent([], [{ clientX: 100, clientY: 205 }]));
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });
});
