import { useCallback, useEffect, useRef } from "react";
import { apiClient } from "@/lib/api";

interface VisibilityEvent {
  hidden: boolean;
  at_ms: number;
}

interface UseVisibilityDetectionOptions {
  examId: string | undefined;
  maxSwitchCount: number;
  initialSwitchCount?: number;
  onSwitchCountUpdate: (count: number) => void;
  onMaxReached: () => void;
  onWarning: (remaining: number) => void;
  enabled: boolean;
}

export function useVisibilityDetection({
  examId,
  initialSwitchCount = 0,
  onSwitchCountUpdate,
  onMaxReached,
  onWarning,
  enabled,
}: UseVisibilityDetectionOptions) {
  const pendingEvents = useRef<VisibilityEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverCountRef = useRef(initialSwitchCount);

  const flush = useCallback(async () => {
    if (!examId || pendingEvents.current.length === 0) return;
    const events = [...pendingEvents.current];
    pendingEvents.current = [];
    try {
      const res = await apiClient.post<{ switch_count: number; max_switch_count: number }>(
        `/api/student/exams/${examId}/visibility-events`,
        { events },
      );
      const { switch_count, max_switch_count } = res.data;
      serverCountRef.current = switch_count;
      onSwitchCountUpdate(switch_count);
      if (max_switch_count > 0) {
        const remaining = max_switch_count - switch_count;
        if (remaining <= 0) {
          onMaxReached();
        } else if (remaining <= 2) {
          onWarning(remaining);
        }
      }
    } catch {
      // Silently restore events on network failure; they'll be included next flush.
      pendingEvents.current = [...events, ...pendingEvents.current];
    }
  }, [examId, onSwitchCountUpdate, onMaxReached, onWarning]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flush();
    }, 1000);
  }, [flush]);

  const handleVisibilityChange = useCallback(() => {
    if (!enabled) return;
    pendingEvents.current.push({ hidden: document.hidden, at_ms: Date.now() });
    scheduleFlush();
  }, [enabled, scheduleFlush]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [enabled, handleVisibilityChange]);

  const setCount = useCallback((c: number) => {
    serverCountRef.current = c;
  }, []);

  return { count: serverCountRef, setCount };
}
