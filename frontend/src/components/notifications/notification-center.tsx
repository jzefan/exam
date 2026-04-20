import { Bell, CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { type NotificationItem, useNotifications } from "./use-notifications";

function formatNotificationTime(createdAt: string) {
  return new Date(createdAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNotificationPreview(notification: NotificationItem) {
  return notification.content?.trim() || "暂无内容";
}

function isExternalLink(linkUrl: string) {
  return /^https?:\/\//i.test(linkUrl) || linkUrl.startsWith("//");
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, refresh, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const visibleUnreadCount = useMemo(() => Math.min(unreadCount, 99), [unreadCount]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void refresh();
    }
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    await markAsRead(notification.id);
    setOpen(false);

    if (!notification.link_url) {
      return;
    }

    if (isExternalLink(notification.link_url)) {
      window.location.assign(notification.link_url);
      return;
    }

    navigate(notification.link_url);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-full border border-transparent bg-background/40 text-foreground/80 backdrop-blur-sm transition-all hover:border-border/60 hover:bg-muted/70 active:scale-95"
          aria-label="通知中心"
          title="通知中心"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[10px] font-bold leading-none"
            >
              {visibleUnreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={12} className="w-[22rem] overflow-hidden rounded-2xl p-0 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">站内通知</h3>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `你有 ${unreadCount} 条未读通知` : "暂无未读通知"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={() => void markAllAsRead()}
            disabled={unreadCount === 0}
          >
            <CheckCheck size={14} />
            全部已读
          </Button>
        </div>

        <Separator />

        <ScrollArea className="max-h-[26rem]">
          <div className="p-2">
            {loading && notifications.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                加载通知中...
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <Bell size={28} className="text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">暂无通知</p>
                <p className="text-xs text-muted-foreground">新的站内消息会显示在这里。</p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => {
                  const unread = notification.read_at === null;

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => void handleNotificationClick(notification)}
                      className={cn(
                        "group w-full rounded-xl border px-3 py-3 text-left transition-colors hover:bg-accent/70",
                        unread
                          ? "border-primary/20 bg-primary/5"
                          : "border-border/50 bg-background",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                            unread ? "bg-primary shadow-[0_0_0_4px_rgba(99,102,241,0.12)]" : "bg-muted-foreground/30",
                          )}
                        />

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="line-clamp-1 text-sm font-semibold text-foreground">
                              {notification.title}
                            </p>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatNotificationTime(notification.created_at)}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {getNotificationPreview(notification)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
