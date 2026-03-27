export interface ExamFormValues {
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  total_score: number;
  status: "draft" | "upcoming" | "ongoing" | "completed" | "closed";
  position_id: string | null;
  max_switch_count: number;
  show_result: boolean;
  notes_template: string;
  question_ids: string[];
  student_ids: string[];
}

export type ExamFormErrors = Partial<
  Record<
    "title" | "start_time" | "end_time" | "duration_minutes" | "total_score" | "max_switch_count",
    string
  >
>;

export const DEFAULT_NOTES = `考试注意事项：
1. 考试期间请勿切换页面，超过规定次数将自动提交试卷
2. 请在规定时间内完成所有题目
3. 答题过程中请确保网络稳定
4. 提交后不可修改答案，请仔细检查后再提交
5. 如遇技术问题，请及时联系监考老师`;

export function validateExamForm(form: ExamFormValues): ExamFormErrors {
  const errors: ExamFormErrors = {};

  const title = form.title.trim();
  if (!title) {
    errors.title = "请输入考试名称。";
  } else if (title.length > 200) {
    errors.title = "考试名称不能超过 200 个字符。";
  }

  if (!Number.isFinite(form.duration_minutes) || form.duration_minutes <= 0) {
    errors.duration_minutes = "考试时长必须大于 0。";
  }

  if (!Number.isFinite(form.total_score) || form.total_score <= 0) {
    errors.total_score = "总分必须大于 0。";
  }

  if (!Number.isFinite(form.max_switch_count) || form.max_switch_count < 0) {
    errors.max_switch_count = "允许切屏次数不能小于 0。";
  }

  if (form.start_time && form.end_time) {
    const start = new Date(form.start_time).getTime();
    const end = new Date(form.end_time).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      errors.start_time = "请输入有效的开始和结束时间。";
      errors.end_time = "请输入有效的开始和结束时间。";
    } else if (end <= start) {
      errors.start_time = "结束时间必须晚于开始时间。";
      errors.end_time = "结束时间必须晚于开始时间。";
    }
  }

  return errors;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeResponseMessage = (
      error as { response?: { data?: { detail?: unknown; message?: unknown } } }
    ).response?.data;

    if (typeof maybeResponseMessage?.detail === "string" && maybeResponseMessage.detail.trim()) {
      return maybeResponseMessage.detail;
    }

    if (typeof maybeResponseMessage?.message === "string" && maybeResponseMessage.message.trim()) {
      return maybeResponseMessage.message;
    }
  }

  return fallback;
}
