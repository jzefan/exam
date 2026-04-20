import { ArrowRight, Clock, Play, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getStudentDateLocale, getStudentLocale, tStudent } from "../i18n";

type PendingExamStatus = "ongoing" | "upcoming";

interface StudentPendingExamCardProps {
  title: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  createdByName?: string | null;
  status: PendingExamStatus;
  actionLabel?: string;
  onAction: () => void;
}

function formatTimeRange(start: string | null, end: string | null): string {
  const locale = getStudentLocale();
  if (!start) return tStudent("common_time_tbd", undefined, locale);
  const formatPoint = (value: string) =>
    new Date(value).toLocaleString(getStudentDateLocale(locale), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return end ? `${formatPoint(start)} - ${formatPoint(end)}` : formatPoint(start);
}

function formatTeacherName(name: string | null | undefined): string {
  return name?.trim() ? `发布老师：${name}` : "发布老师：未注明";
}

export function StudentPendingExamCard({
  title,
  startTime,
  endTime,
  durationMinutes,
  createdByName,
  status,
  actionLabel,
  onAction,
}: StudentPendingExamCardProps) {
  const locale = getStudentLocale();
  const isOngoing = status === "ongoing";

  return (
    <div
      className={cn(
        "group flex flex-col gap-6 rounded-2xl border p-6 transition-all duration-300 md:flex-row md:items-center md:justify-between",
        isOngoing
          ? "border-primary/20 bg-primary/[0.04] shadow-md shadow-primary/10 hover:border-primary/40"
          : "border-border/50 bg-card hover:border-border",
      )}
    >
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-3">
          {isOngoing ? <span className="flex size-2 rounded-full bg-primary animate-pulse" /> : null}
          <h4 className="truncate text-base font-bold text-foreground">{title}</h4>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground/70">
          <span>{formatTeacherName(createdByName)}</span>
          <span className="flex items-center gap-1.5">
            <Clock size={14} className="opacity-50" />
            {formatTimeRange(startTime, endTime)}
          </span>
          <span className="flex items-center gap-1.5">
            <Timer size={14} className="opacity-50" />
            {tStudent("dashboard_minutes", { minutes: durationMinutes }, locale)}
          </span>
        </div>
      </div>

      <Button
        type="button"
        disabled={!isOngoing}
        onClick={onAction}
        className={cn(
          "h-10 rounded-xl px-5 font-semibold transition-all active:scale-95",
          isOngoing ? "shadow-md shadow-primary/15" : "bg-muted text-muted-foreground/50",
        )}
      >
        {isOngoing ? (
          <>
            <Play data-icon="inline-start" />
            {actionLabel ?? tStudent("dashboard_enter_exam", undefined, locale)}
          </>
        ) : (
          tStudent("dashboard_exam_not_started", undefined, locale)
        )}
        {isOngoing ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
    </div>
  );
}
