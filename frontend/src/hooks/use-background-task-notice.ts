import { useCallback, useState } from "react";

export interface BackgroundTaskNotice {
  id: string;
  title: string;
  description: string;
  progressText?: string;
  pagePath?: string | null;
}

let currentNotices: BackgroundTaskNotice[] = [];
let listeners: Array<(notices: BackgroundTaskNotice[]) => void> = [];

function emit(notices: BackgroundTaskNotice[]) {
  currentNotices = notices;
  listeners.forEach((listener) => listener(currentNotices));
}

export function upsertBackgroundTaskNotice(notice: BackgroundTaskNotice) {
  const existingIndex = currentNotices.findIndex((item) => item.id === notice.id);
  if (existingIndex === -1) {
    emit([...currentNotices, notice]);
    return;
  }
  const next = [...currentNotices];
  next[existingIndex] = notice;
  emit(next);
}

export function dismissBackgroundTaskNotice(id: string) {
  emit(currentNotices.filter((notice) => notice.id !== id));
}

export function clearBackgroundTaskNotices() {
  emit([]);
}

export function useBackgroundTaskNotice() {
  const showNotice = useCallback((notice: BackgroundTaskNotice) => {
    upsertBackgroundTaskNotice(notice);
  }, []);

  const dismissNotice = useCallback((id: string) => {
    dismissBackgroundTaskNotice(id);
  }, []);

  return {
    showNotice,
    dismissNotice,
  };
}

export function useBackgroundTaskNoticeState() {
  const [notices, setNotices] = useState<BackgroundTaskNotice[]>(currentNotices);

  const subscribe = useCallback(() => {
    const listener = (nextNotices: BackgroundTaskNotice[]) => {
      setNotices(nextNotices);
    };
    listeners.push(listener);
    setNotices(currentNotices);
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  }, []);

  return {
    notices,
    subscribe,
  };
}
