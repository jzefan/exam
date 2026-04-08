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
    icon: <FileEdit size={11} />,
    className:
      "bg-zinc-100 text-zinc-600 border-transparent dark:bg-zinc-800 dark:text-zinc-400",
  },
  upcoming: {
    label: "未开始",
    icon: <CalendarClock size={11} />,
    className:
      "bg-sky-50 text-sky-700 border-transparent dark:bg-sky-950 dark:text-sky-300",
  },
  ongoing: {
    label: "进行中",
    icon: <PlayCircle size={11} />,
    className:
      "bg-emerald-50 text-emerald-700 border-transparent dark:bg-emerald-950 dark:text-emerald-300",
  },
  completed: {
    label: "已结束",
    icon: <CheckCircle2 size={11} />,
    className: "bg-indigo-50 text-indigo-700 border-transparent dark:bg-indigo-950 dark:text-indigo-300",
  },
  closed: {
    label: "已关闭",
    icon: <Lock size={11} />,
    className:
      "bg-rose-50 text-rose-600 border-transparent dark:bg-rose-950 dark:text-rose-400",
  },
};

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const c = config[status] ?? config.draft;
  return (
    <Badge
      variant="secondary"
      className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-0.5 border shadow-none ${c.className}`}
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
