import { useEffect, useRef, useCallback } from "react";

interface UseVisibilityDetectionOptions {
  maxSwitchCount: number;
  onSwitch: (count: number) => void;
  onMaxReached: () => void;
  onWarning: (remaining: number) => void;
  enabled: boolean;
}

export function useVisibilityDetection({
  maxSwitchCount,
  onSwitch,
  onMaxReached,
  onWarning,
  enabled,
}: UseVisibilityDetectionOptions) {
  const countRef = useRef(0);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden && enabled) {
      countRef.current += 1;
      const count = countRef.current;
      onSwitch(count);

      if (maxSwitchCount > 0) {
        const remaining = maxSwitchCount - count;
        if (remaining <= 0) {
          onMaxReached();
        } else if (remaining <= 2) {
          onWarning(remaining);
        }
      }
    }
  }, [enabled, maxSwitchCount, onSwitch, onMaxReached, onWarning]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, handleVisibilityChange]);

  const setCount = useCallback((c: number) => {
    countRef.current = c;
  }, []);

  return { count: countRef, setCount };
}
