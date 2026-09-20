/**
 * 考试截止时间计算 —— 倒计时与顶栏时间条共用，避免两处各写一份。
 *
 * 截止时间取「开始时间 + 时长」与「试卷结束时间」中更早的那个：
 * 考试提前结束时以 end_time 为准。
 */
export interface ExamDeadlineInput {
  startedAt: string;
  durationMinutes: number;
  endTime: string | null;
}

export const EXAM_WARN_SECONDS = 300;
export const EXAM_CRITICAL_SECONDS = 60;

export type ExamTimerState = "normal" | "warn" | "crit";

export function computeExamDeadlineMs({
  startedAt,
  durationMinutes,
  endTime,
}: ExamDeadlineInput): number {
  const started = new Date(startedAt).getTime();
  const byDuration = started + durationMinutes * 60_000;
  const byEndTime = endTime ? new Date(endTime).getTime() : Number.POSITIVE_INFINITY;
  const deadline = Math.min(byDuration, byEndTime);
  // end_time 解析失败（NaN）时退回按时长计算
  return Number.isFinite(deadline) ? deadline : byDuration;
}

export function remainingSeconds(deadlineMs: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((deadlineMs - now) / 1000));
}

export function examTimerState(remaining: number): ExamTimerState {
  if (remaining <= EXAM_CRITICAL_SECONDS) return "crit";
  if (remaining <= EXAM_WARN_SECONDS) return "warn";
  return "normal";
}
