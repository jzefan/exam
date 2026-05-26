import { ChevronLeft, ChevronRight, LayoutGrid, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExamBottomBarProps {
  currentIndex: number;
  totalQuestions: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenMap: () => void;
  onSubmit: () => void;
  isNavigating: boolean;
  isSubmitting: boolean;
}

export function ExamBottomBar({
  currentIndex,
  totalQuestions,
  onPrev,
  onNext,
  onOpenMap,
  onSubmit,
  isNavigating,
  isSubmitting,
}: ExamBottomBarProps) {
  return (
    <footer
      className="z-50 flex h-14 shrink-0 items-center justify-between gap-1 border-t border-border/60 bg-background px-3"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={onPrev}
        disabled={currentIndex === 0 || isNavigating}
        aria-label="上一题"
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={onOpenMap}
        aria-label="题目导航"
      >
        <LayoutGrid className="size-5" />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {currentIndex + 1}/{totalQuestions}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={onNext}
        disabled={currentIndex === totalQuestions - 1 || isNavigating}
        aria-label="下一题"
      >
        <ChevronRight className="size-5" />
      </Button>
      <Button
        size="sm"
        className="h-11 min-w-[72px]"
        onClick={onSubmit}
        disabled={isSubmitting}
        aria-label="交卷"
      >
        <Send className="size-4 mr-1" />
        交卷
      </Button>
    </footer>
  );
}
