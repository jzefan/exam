import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExamBottomBarProps {
  currentIndex: number;
  totalQuestions: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenMap: () => void;
  isNavigating: boolean;
}

/**
 * 底栏：左「上一题」/ 中题号（点击开题目导航、可跳题）/ 右「下一题」。
 *
 * 交卷已移到顶栏右上角；中间那块从原来的纯文本序号改成可点按钮，
 * 顺带把原来独立的「题目导航」图标按钮并掉了。
 * 左右两块都是 flex-1 等宽，中间那块才会真正居中。
 */
export function ExamBottomBar({
  currentIndex,
  totalQuestions,
  onPrev,
  onNext,
  onOpenMap,
  isNavigating,
}: ExamBottomBarProps) {
  return (
    <footer
      className="z-50 flex h-14 shrink-0 items-center gap-2 border-t border-border/60 bg-background px-3"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Button
        variant="outline"
        className="h-11 min-w-0 flex-1 gap-1 text-sm font-medium"
        onClick={onPrev}
        disabled={currentIndex === 0 || isNavigating}
      >
        <ChevronLeft className="size-4 shrink-0" />
        上一题
      </Button>
      <Button
        variant="ghost"
        className="h-11 shrink-0 gap-1.5 px-3"
        onClick={onOpenMap}
        aria-label="题目导航"
      >
        <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold tabular-nums">
          {currentIndex + 1}
          <span className="font-normal text-muted-foreground">/{totalQuestions}</span>
        </span>
      </Button>
      <Button
        className="h-11 min-w-0 flex-1 gap-1 text-sm font-medium"
        onClick={onNext}
        disabled={currentIndex === totalQuestions - 1 || isNavigating}
      >
        下一题
        <ChevronRight className="size-4 shrink-0" />
      </Button>
    </footer>
  );
}
