import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import type { IStudentNotification } from "@/types";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function useStudentNotifications() {
  const [notifications, setNotifications] = useState<IStudentNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<IStudentNotification[]>("/api/student/notifications/unread");
      if (!cancelledRef.current) setNotifications(response.data);
    } catch {
      if (!cancelledRef.current) setNotifications([]);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.post(`/api/student/notifications/${id}/read`);
    } catch {
      // Keep local dismissal even if server fails
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return {
    notifications,
    unreadCount: notifications.length,
    loading,
    refresh,
    markAsRead,
  };
}
