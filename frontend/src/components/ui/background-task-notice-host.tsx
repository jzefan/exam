import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useBackgroundTaskNoticeState } from "@/hooks/use-background-task-notice";

export function BackgroundTaskNoticeHost() {
  const location = useLocation();
  const { notices, subscribe } = useBackgroundTaskNoticeState();

  useEffect(() => {
    return subscribe();
  }, [subscribe]);

  return (
    <>
      {notices.map((notice) => {
        const isOnSourcePage = Boolean(notice.pagePath && location.pathname === notice.pagePath);
        const position = isOnSourcePage ? "center" : "floating";

        return (
          <div
            key={notice.id}
            data-position={position}
            data-testid={`background-task-notice-${notice.id}`}
            className={cn(
              "pointer-events-none fixed z-[95]",
              isOnSourcePage
                ? "left-1/2 top-6 w-[min(92vw,760px)] -translate-x-1/2"
                : "bottom-6 right-6 w-[min(92vw,360px)]",
            )}
          >
            <Alert
              variant="warning"
              className={cn(
                "pointer-events-auto rounded-[28px] border-amber-300 bg-amber-50/98 px-5 py-4 text-amber-900 shadow-[0_24px_60px_rgba(180,83,9,0.18)] backdrop-blur",
                isOnSourcePage ? "min-h-[92px]" : "rounded-2xl px-4 py-3",
              )}
            >
              <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-amber-600" />
              <div className={cn("pl-7", isOnSourcePage ? "space-y-2" : "space-y-1.5")}>
                <div className="flex items-center gap-2">
                  <AlertTitle className={cn("mb-0 text-base font-semibold", !isOnSourcePage && "text-sm")}>
                    {notice.title}
                  </AlertTitle>
                  {notice.progressText ? (
                    <span className="rounded-full border border-amber-300 bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      {notice.progressText}
                    </span>
                  ) : null}
                </div>
                <AlertDescription className={cn("text-sm leading-6 text-amber-800", !isOnSourcePage && "text-xs")}>
                  {notice.description}
                </AlertDescription>
              </div>
            </Alert>
          </div>
        );
      })}
    </>
  );
}
