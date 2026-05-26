import { Drawer } from "vaul";
import { Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubmitConfirmSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answeredCount: number;
  totalCount: number;
  online: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
}

export function SubmitConfirmSheet({
  open,
  onOpenChange,
  answeredCount,
  totalCount,
  online,
  isSubmitting,
  onConfirm,
}: SubmitConfirmSheetProps) {
  const unanswered = totalCount - answeredCount;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-background outline-none">
          <div className="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-muted" />
          <div className="p-5 space-y-4">
            <Drawer.Title className="text-base font-semibold">确认交卷</Drawer.Title>
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3 text-sm">
              <span className="text-muted-foreground">已答题目</span>
              <span className="font-semibold tabular-nums">
                {answeredCount}
                <span className="font-normal text-muted-foreground"> / {totalCount}</span>
              </span>
            </div>
            {unanswered > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                还有 {unanswered} 题未作答
              </p>
            )}
            {!online && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                <WifiOff className="size-4 shrink-0" />
                <span>网络已断开，请恢复连接后再交卷</span>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                继续答题
              </Button>
              <Button
                className="flex-1"
                onClick={onConfirm}
                disabled={!online || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    交卷中...
                  </>
                ) : (
                  "确认交卷"
                )}
              </Button>
            </div>
          </div>
          <div style={{ height: "env(safe-area-inset-bottom)" }} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
