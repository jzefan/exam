import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExamTopBarProps {
  title: string;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

/**
 * 顶栏：返回 / 标题 / 右上角交卷。
 *
 * 交卷是不可逆操作、挪到顶栏后又离「返回」更近，所以这里只负责触发，
 * 真正的拦截交给 SubmitConfirmSheet（带已答/未答数据）。
 * 底边不画 border —— 下面紧跟着 ExamTimeBar 那 2px 时间条，画了会成双线。
 */
export function ExamTopBar({ title, onBack, onSubmit, isSubmitting }: ExamTopBarProps) {
  return (
    <header
      className="z-50 flex h-12 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden bg-background px-2.5"
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
      <span className="min-w-0 flex-1 basis-0 truncate text-sm font-medium">{title}</span>
      <Button
        size="sm"
        className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs"
        onClick={onSubmit}
        disabled={isSubmitting}
        aria-label="交卷"
      >
        {isSubmitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        交卷
      </Button>
    </header>
  );
}
