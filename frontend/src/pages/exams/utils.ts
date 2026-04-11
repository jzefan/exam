import type { ExamStatus, IExam } from "@/types";

type ExamStatusLike = Pick<IExam, "status" | "start_time" | "end_time">;

export function getEffectiveExamStatus(
  exam: ExamStatusLike,
  now = new Date(),
): ExamStatus {
  if (exam.status === "draft" || exam.status === "closed") {
    return exam.status;
  }

  const nowMs = now.getTime();
  const startMs = exam.start_time ? new Date(exam.start_time).getTime() : Number.NaN;
  const endMs = exam.end_time ? new Date(exam.end_time).getTime() : Number.NaN;

  if (!Number.isNaN(startMs) && nowMs < startMs) {
    return "upcoming";
  }

  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return "completed";
  }

  if (!Number.isNaN(startMs) && nowMs >= startMs) {
    return "ongoing";
  }

  return exam.status;
}
