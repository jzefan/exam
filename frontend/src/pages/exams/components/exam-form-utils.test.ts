import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTES,
  getPublishedExamStatus,
  toSubmitDateTime,
  validateExamForm,
  type ExamFormValues,
} from "./exam-form-utils";

function createForm(overrides: Partial<ExamFormValues> = {}): ExamFormValues {
  return {
    category: "exam",
    title: "期中考试",
    description: "",
    start_time: "2026-04-09T10:00",
    end_time: "2026-04-09T12:00",
    duration_minutes: 120,
    total_score: 100,
    status: "draft",
    position_id: null,
    max_switch_count: 3,
    allow_retake: false,
    show_result: true,
    notes_template: DEFAULT_NOTES,
    question_mode: "manual",
    question_ids: ["question-1"],
    question_items: [{ question_id: "question-1", order: 0, score_override: 100 }],
    student_ids: ["student-1"],
    ...overrides,
  };
}

describe("validateExamForm", () => {
  it("allows a start time that is only a few minutes behind the current time", () => {
    const errors = validateExamForm(
      createForm({
        start_time: "2026-04-08T09:55",
        end_time: "2026-04-08T11:00",
      }),
      new Date("2026-04-08T10:00:00"),
      { startTimeGraceMinutes: 10 },
    );

    expect(errors.start_time).toBeUndefined();
  });

  it("rejects a start time that exceeds the grace window", () => {
    const errors = validateExamForm(
      createForm({
        start_time: "2026-04-08T09:49",
        end_time: "2026-04-08T11:00",
      }),
      new Date("2026-04-08T10:00:00"),
      { startTimeGraceMinutes: 10 },
    );

    expect(errors.start_time).toBe("开始时间不能早于当前时间。");
    expect(errors.end_time).toBeUndefined();
  });

  it("rejects an end time that is not after the start time", () => {
    const errors = validateExamForm(
      createForm({
        start_time: "2026-04-09T10:00",
        end_time: "2026-04-09T10:00",
      }),
      new Date("2026-04-08T10:00:00"),
    );

    expect(errors.start_time).toBe("结束时间必须晚于开始时间。");
    expect(errors.end_time).toBe("结束时间必须晚于开始时间。");
  });

  it("allows a past start time when editing existing exams", () => {
    const errors = validateExamForm(
      createForm({
        start_time: "2026-04-08T09:00",
        end_time: "2026-04-08T11:00",
      }),
      new Date("2026-04-10T10:00:00"),
      { allowPastStartTime: true },
    );

    expect(errors.start_time).toBeUndefined();
    expect(errors.end_time).toBeUndefined();
  });
});

describe("getPublishedExamStatus", () => {
  it("treats a published exam without a start time as ongoing before the end time", () => {
    const status = getPublishedExamStatus(
      createForm({
        start_time: "",
        end_time: "2026-04-09T12:00",
      }),
      new Date("2026-04-09T10:00:00"),
    );

    expect(status).toBe("ongoing");
  });
});

describe("toSubmitDateTime", () => {
  it("converts a local datetime input into a timezone-aware ISO string", () => {
    expect(toSubmitDateTime("2026-04-23T19:48")).toMatch(/^2026-04-23T\d{2}:48:00\.000Z$/);
  });

  it("returns null for an empty datetime input", () => {
    expect(toSubmitDateTime("")).toBeNull();
  });
});
