import { useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

interface SwipeOptions {
  /** Minimum horizontal travel (px) required to count as a swipe. */
  threshold?: number;
  /** Maximum vertical drift (px) tolerated before the gesture is treated as a scroll. */
  restraint?: number;
}

/**
 * Detects horizontal swipe gestures from touch events.
 *
 * Returns `onTouchStart`/`onTouchEnd` handlers to spread onto an element. A
 * gesture only fires when horizontal travel exceeds `threshold` while vertical
 * drift stays under `restraint`, so vertical scrolling and taps are ignored.
 */
export function useSwipe(
  { onSwipeLeft, onSwipeRight }: SwipeHandlers,
  { threshold = 60, restraint = 80 }: SwipeOptions = {},
) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (event: ReactTouchEvent) => {
    if (event.touches.length !== 1) {
      start.current = null;
      return;
    }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: ReactTouchEvent) => {
    const origin = start.current;
    start.current = null;
    if (!origin || event.changedTouches.length === 0) return;

    const touch = event.changedTouches[0];
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;

    if (Math.abs(dx) < threshold || Math.abs(dy) > restraint) return;

    if (dx < 0) onSwipeLeft?.();
    else onSwipeRight?.();
  };

  return { onTouchStart, onTouchEnd };
}
