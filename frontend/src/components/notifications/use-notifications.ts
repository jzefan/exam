import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string | null;
  link_url: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

interface UnreadCountResponse {
  unread_count: number;
}

const api = axios.create();

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function isUnread(notification: NotificationItem) {
  return notification.read_at === null;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadUnreadCount = useCallback(async () => {
    const response = await api.get<UnreadCountResponse>("/api/notifications/unread-count");
    setUnreadCount(response.data.unread_count ?? 0);
  }, []);

  const loadNotifications = useCallback(async () => {
    const response = await api.get<NotificationItem[]>(
      "/api/notifications?unread_only=false&_start=0&_end=10",
    );
    setNotifications(response.data ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([loadNotifications(), loadUnreadCount()]);
    setLoading(false);
  }, [loadNotifications, loadUnreadCount]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadUnreadCount().catch(() => {});
    }, 45_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadUnreadCount]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      let shouldDecrease = false;
      setNotifications((current) =>
        current.map((notification) => {
          if (notification.id !== notificationId || !isUnread(notification)) {
            return notification;
          }

          shouldDecrease = true;
          return { ...notification, read_at: new Date().toISOString() };
        }),
      );
      if (shouldDecrease) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }

      try {
        await api.patch(`/api/notifications/${notificationId}/read`);
      } catch {
        // Keep the optimistic local state; the next poll will correct it if needed.
      }
    },
    [],
  );

  const markAllAsRead = useCallback(async () => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at ? notification : { ...notification, read_at: new Date().toISOString() },
      ),
    );
    setUnreadCount(0);

    try {
      await api.post("/api/notifications/mark-all-read");
    } catch {
      // Keep the optimistic local state; the next poll will correct it if needed.
    }
  }, []);

  return useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      refresh,
      markAsRead,
      markAllAsRead,
    }),
    [loading, markAllAsRead, markAsRead, notifications, refresh, unreadCount],
  );
}
