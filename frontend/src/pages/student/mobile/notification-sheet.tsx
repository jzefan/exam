import { Drawer } from "vaul";
import { Bell, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { IStudentNotification } from "@/types";

interface NotificationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: IStudentNotification[];
  onMarkAsRead: (id: string) => void;
}

export function NotificationSheet({
  open,
  onOpenChange,
  notifications,
  onMarkAsRead,
}: NotificationSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-background max-h-[80dvh]">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b shrink-0">
            <Drawer.Title className="text-base font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4" />
              通知
              {notifications.length > 0 && (
                <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {notifications.length > 9 ? "9+" : notifications.length}
                </span>
              )}
            </Drawer.Title>
            <button onClick={() => onOpenChange(false)} className="text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-4 py-3">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Bell className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">暂无未读通知</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {notifications.map((n) => (
                  <li key={n.id} className="rounded-xl border bg-card p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      <button
                        onClick={() => onMarkAsRead(n.id)}
                        className="text-xs text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                      >
                        已读
                      </button>
                    </div>
                    {n.content && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{n.content}</p>
                    )}
                    {n.related_exam_id && (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          onMarkAsRead(n.id);
                          onOpenChange(false);
                        }}
                      >
                        <Link to={`/my-exams/${n.related_exam_id}/result`}>查看结果</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
