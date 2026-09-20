import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  computeExamDeadlineMs,
  examTimerState,
  remainingSeconds,
  type ExamDeadlineInput,
  type ExamTimerState,
} from "./exam-deadline";

/**
 * 顶栏底边的 2px 时间条 —— 「余光层」。
 *
 * 只做全局比例提示，不显示读数（读数在题号行的倒计时里），
 * 因此单独跑自己的 1s 心跳：这样每秒只有这一条细线重绘，
 * 不会把题目内容一起带着重渲染。
 */
const FILL_BY_STATE: Record<ExamTimerState, string> = {
  normal: "bg-primary",
  warn: "bg-amber-500",
  crit: "bg-red-500",
};

export function ExamTimeBar({ startedAt, durationMinutes, endTime }: ExamDeadlineInput) {
  const total = Math.max(1, durationMinutes * 60);
  const [remaining, setRemaining] = useState(() =>
    remainingSeconds(computeExamDeadlineMs({ startedAt, durationMinutes, endTime })),
  );

  useEffect(() => {
    const deadline = computeExamDeadlineMs({ startedAt, durationMinutes, endTime });
    setRemaining(remainingSeconds(deadline));
    const id = setInterval(() => setRemaining(remainingSeconds(deadline)), 1000);
    return () => clearInterval(id);
  }, [startedAt, durationMinutes, endTime]);

  const ratio = Math.min(1, Math.max(0, remaining / total));

  return (
    <div aria-hidden="true" className="h-0.5 w-full shrink-0 overflow-hidden bg-border/60">
      <div
        className={cn(
          "h-full transition-[width,background-color] duration-500 ease-linear",
          FILL_BY_STATE[examTimerState(remaining)],
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
