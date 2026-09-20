import { CountdownTimer } from "../components/countdown-timer";
import { SaveStateLabel } from "./save-state-label";

interface ExamInfoRowProps {
  currentIndex: number;
  totalQuestions: number;
  /** 当前题题型短标签（单选 / 多选 / SQL …）。为空时只显示题号。 */
  questionTypeLabel?: string;
  saveState: "idle" | "saving" | "saved" | "error";
  startedAt: string;
  durationMinutes: number;
  endTime: string | null;
  onTimeUp: () => void;
}

/**
 * 题号行：左边「题型 · 第 N 题 / 共 M 题」，右边保存态 + 倒计时（倒计时在最右）。
 * 题型用短标签（2 字），这一行还要放保存态和倒计时，全称会把题号挤到截断。
 *
 * 倒计时从顶栏搬到这里，是因为顶栏右上角要让给交卷；放在题号行右侧
 * 既能跟底栏中间的题号呼应，也不会跟标题抢视线。
 */
export function ExamInfoRow({
  currentIndex,
  totalQuestions,
  questionTypeLabel,
  saveState,
  startedAt,
  durationMinutes,
  endTime,
  onTimeUp,
}: ExamInfoRowProps) {
  return (
    <div
      data-testid="mobile-exam-info-row"
      className="flex h-11 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden px-4"
    >
      <span className="flex min-w-0 flex-1 basis-0 items-center gap-1.5 text-xs text-muted-foreground">
        {questionTypeLabel ? (
          <>
            {/* 题型不参与截断：多选/填空这类信息比题号更能决定作答方式 */}
            <span
              data-testid="mobile-exam-question-type"
              className="shrink-0 font-medium text-foreground/70"
            >
              {questionTypeLabel}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/40">
              ·
            </span>
          </>
        ) : null}
        <span className="min-w-0 truncate">
          第{" "}
          <span className="font-semibold tabular-nums text-foreground">{currentIndex + 1}</span>
          {" 题 / 共 "}
          <span className="font-semibold tabular-nums text-foreground">{totalQuestions}</span>
          {" 题"}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <SaveStateLabel saveState={saveState} />
        <CountdownTimer
          endTime={endTime}
          startedAt={startedAt}
          durationMinutes={durationMinutes}
          onTimeUp={onTimeUp}
        />
      </div>
    </div>
  );
}
