import { MonitorOff } from "lucide-react";

interface Props {
  switchCount: number;
  maxSwitchCount: number;
}

export function SwitchCounter({ switchCount, maxSwitchCount }: Props) {
  if (maxSwitchCount <= 0) return null;

  const remaining = maxSwitchCount - switchCount;
  const isDanger = remaining <= 0;
  const isWarning = remaining > 0 && remaining <= 2;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs tabular-nums transition-colors duration-500 ${
        isDanger
          ? "text-red-600 dark:text-red-400"
          : isWarning
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
      }`}
    >
      <MonitorOff size={13} />
      <span className="font-medium">
        {switchCount}/{maxSwitchCount}
      </span>
    </div>
  );
}
