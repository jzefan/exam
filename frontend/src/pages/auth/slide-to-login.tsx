import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface SlideToLoginProps {
  disabled?: boolean;
  loading?: boolean;
  onComplete: () => boolean | void;
  resetKey?: string;
}

const COMPLETE_THRESHOLD = 0.96;

export function SlideToLogin({
  disabled = false,
  loading = false,
  onComplete,
  resetKey,
}: SlideToLoginProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const completedRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    completedRef.current = false;
    setCompleted(false);
    setProgress(0);
    setDragging(false);
    draggingRef.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (wasLoadingRef.current && !loading && completedRef.current) {
      completedRef.current = false;
      setCompleted(false);
      setProgress(0);
      draggingRef.current = false;
    }
    wasLoadingRef.current = loading;
  }, [loading]);

  const setProgressFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || disabled || loading || completedRef.current) return null;

    const rect = track.getBoundingClientRect();
    const thumbSize = 42;
    const padding = 3;
    const max = Math.max(1, rect.width - thumbSize - padding * 2);
    const next = Math.min(1, Math.max(0, (clientX - rect.left - thumbSize / 2 - padding) / max));
    setProgress(next);

    if (next >= COMPLETE_THRESHOLD) complete();
    return next;
  };

  const complete = () => {
    const shouldComplete = onComplete();
    if (shouldComplete === false) {
      completedRef.current = false;
      draggingRef.current = false;
      setCompleted(false);
      setDragging(false);
      setProgress(0);
      return;
    }
    completedRef.current = true;
    draggingRef.current = false;
    setCompleted(true);
    setProgress(1);
    setDragging(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || loading || completedRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setProgressFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setProgressFromClientX(event.clientX);
  };

  const finishDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (event) {
      setProgressFromClientX(event.clientX);
    }
    draggingRef.current = false;
    setDragging(false);
    if (!completedRef.current) {
      setProgress(0);
    }
  };

  const label = loading ? "登录中..." : completed ? "登录成功" : "滑动登录";

  return (
    <div
      ref={trackRef}
      className={cn(
        "auth-slide-track",
        dragging && "auth-slide-dragging",
        completed && "auth-slide-completed",
        (disabled || loading) && "auth-slide-disabled",
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || loading}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!disabled && !loading) complete();
        }
      }}
    >
      <div className="auth-slide-fill" style={{ width: `calc(48px + (100% - 48px) * ${progress})` }} />
      <div className="auth-slide-label" style={{ opacity: loading || completed ? 1 : Math.max(0, 1 - progress * 2) }}>
        {label}
      </div>
      <div
        className="auth-slide-thumb"
        style={{ left: `calc(3px + (100% - 48px) * ${progress})` }}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : completed ? (
          <Check aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
