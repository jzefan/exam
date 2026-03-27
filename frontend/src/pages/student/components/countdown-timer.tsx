import { useState, useEffect } from "react";

interface Props {
  startedAt: string;
  durationMinutes: number;
  endTime: string | null;
  onTimeUp: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function CountdownTimer({
  startedAt,
  durationMinutes,
  endTime,
  onTimeUp,
}: Props) {
  const [remaining, setRemaining] = useState<number>(() => {
    const started = new Date(startedAt).getTime();
    const deadline = endTime
      ? Math.min(
          started + durationMinutes * 60_000,
          new Date(endTime).getTime(),
        )
      : started + durationMinutes * 60_000;
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  });

  useEffect(() => {
    if (remaining <= 0) {
      onTimeUp();
      return;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          onTimeUp();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [remaining <= 0, onTimeUp]);

  const total = durationMinutes * 60;
  const pct = total > 0 ? remaining / total : 1;
  const isUrgent = remaining <= 300;
  const isCritical = remaining <= 60;

  return (
    <div
      className={`flex items-center gap-2 font-mono text-sm tabular-nums transition-colors duration-700 ${
        isCritical
          ? "text-red-600 dark:text-red-400"
          : isUrgent
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground/70"
      }`}
    >
      {/* Mini arc — a tiny radial progress indicator */}
      <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity={0.15}
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 8}`}
          strokeDashoffset={`${2 * Math.PI * 8 * (1 - pct)}`}
          className="transition-all duration-1000"
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </svg>
      <span className={`font-semibold ${isCritical ? "animate-pulse" : ""}`}>
        {formatTime(remaining)}
      </span>
    </div>
  );
}
