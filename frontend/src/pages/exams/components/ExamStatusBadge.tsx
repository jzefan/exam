import {
  CalendarClock,
  CheckCircle2,
  FileEdit,
  Lock,
  PlayCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExamStatus } from "@/types";

const config: Record<
  ExamStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  draft: {
    label: "草稿",
    icon: <FileEdit size={12} />,
    className:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
  },
  upcoming: {
    label: "未开始",
    icon: <CalendarClock size={12} />,
    className:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  },
  ongoing: {
    label: "进行中",
    icon: <PlayCircle size={12} />,
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800",
  },
  completed: {
    label: "已结束",
    icon: <CheckCircle2 size={12} />,
    className: "bg-muted text-muted-foreground border-border",
  },
  closed: {
    label: "已关闭",
    icon: <Lock size={12} />,
    className:
      "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800",
  },
};

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const c = config[status] ?? config.draft;
  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 ${c.className}`}
    >
      {c.icon}
      {c.label}
    </Badge>
  );
}

export const examStatusOptions: { value: ExamStatus; label: string }[] = [
  { value: "draft", label: "草稿" },
  { value: "upcoming", label: "未开始" },
  { value: "ongoing", label: "进行中" },
  { value: "completed", label: "已结束" },
  { value: "closed", label: "已关闭" },
];
