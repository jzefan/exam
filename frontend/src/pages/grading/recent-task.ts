import { getStoredUser } from "@/lib/current-user";

export type RecentGradingTask = {
  taskId: string;
  title: string;
  questionRef: string | null;
  mode: "question" | "candidate";
  updatedAt: number;
};

function storageKey(): string | null {
  const user = getStoredUser();
  if (user?.primary_org?.role_name !== "teacher" || !user.id) return null;
  return `teacher:grading:recent:${user.id}`;
}

export function readRecentGradingTask(): RecentGradingTask | null {
  const key = storageKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RecentGradingTask>;
    if (typeof value.taskId !== "string" || !value.taskId.trim()) return null;
    return {
      taskId: value.taskId,
      title: typeof value.title === "string" && value.title.trim() ? value.title : "继续阅卷",
      questionRef: typeof value.questionRef === "string" ? value.questionRef : null,
      mode: value.mode === "candidate" ? "candidate" : "question",
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function rememberRecentGradingTask(task: Omit<RecentGradingTask, "updatedAt">): void {
  const key = storageKey();
  if (!key || !task.taskId.trim()) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      ...task,
      title: task.title.trim().slice(0, 100) || "继续阅卷",
      updatedAt: Date.now(),
    } satisfies RecentGradingTask));
  } catch {
    // 浏览器禁用本地存储时，阅卷主流程仍可继续。
  }
}

export function clearRecentGradingTask(taskId?: string): void {
  const key = storageKey();
  if (!key) return;
  if (taskId && readRecentGradingTask()?.taskId !== taskId) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // 本地存储不可用时无需阻断页面恢复。
  }
}

export function recentGradingTaskHref(task: RecentGradingTask): string {
  const params = new URLSearchParams({ taskId: task.taskId, mode: task.mode });
  if (task.questionRef) params.set("questionRef", task.questionRef);
  return `/grading?${params.toString()}`;
}
