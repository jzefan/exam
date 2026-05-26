import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "../components/countdown-timer";
import { SaveStateLabel } from "./save-state-label";

interface ExamTopBarProps {
  title: string;
  endTime: string | null;
  startedAt: string;
  durationMinutes: number;
  saveState: "idle" | "saving" | "saved" | "error";
  onBack: () => void;
  onTimeUp: () => void;
}

export function ExamTopBar({
  title,
  endTime,
  startedAt,
  durationMinutes,
  saveState,
  onBack,
  onTimeUp,
}: ExamTopBarProps) {
  return (
    <header
      className="z-50 flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onBack}
        aria-label="返回"
      >
        <ArrowLeft className="size-4" />
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      <SaveStateLabel saveState={saveState} />
      <CountdownTimer
        endTime={endTime}
        startedAt={startedAt}
        durationMinutes={durationMinutes}
        onTimeUp={onTimeUp}
      />
    </header>
  );
}
