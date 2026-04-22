import { describe, expect, it } from "vitest";

import { canStudentRetakeExam, getEffectiveStudentExamStatus } from "./utils";

describe("getEffectiveStudentExamStatus", () => {
  it("treats a started but unsubmitted exam as ongoing even if backend status is upcoming", () => {
    expect(
      getEffectiveStudentExamStatus(
        {
          status: "upcoming",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T10:00:00.000Z",
          participated: false,
          submitted_at: null,
        },
        new Date("2026-04-09T09:00:00.000Z"),
      ),
    ).toBe("ongoing");
  });

  it("treats a submitted exam as completed even when the exam window is still open", () => {
    expect(
      getEffectiveStudentExamStatus(
        {
          status: "ongoing",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T10:00:00.000Z",
          participated: true,
          allow_retake: true,
          submitted_at: "2026-04-09T09:00:00.000Z",
        },
        new Date("2026-04-09T09:30:00.000Z"),
      ),
    ).toBe("completed");
  });

  it("treats a submitted exam as completed once the exam window has ended", () => {
    expect(
      getEffectiveStudentExamStatus(
        {
          status: "ongoing",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T10:00:00.000Z",
          participated: true,
          allow_retake: false,
          submitted_at: "2026-04-09T09:00:00.000Z",
        },
        new Date("2026-04-09T10:30:00.000Z"),
      ),
    ).toBe("completed");
  });

  it("allows retake only when teacher enabled it and the exam is still ongoing", () => {
    expect(
      canStudentRetakeExam(
        {
          status: "ongoing",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T10:00:00.000Z",
          participated: true,
          allow_retake: true,
          submitted_at: "2026-04-09T09:00:00.000Z",
        },
        new Date("2026-04-09T09:30:00.000Z"),
      ),
    ).toBe(true);

    expect(
      canStudentRetakeExam(
        {
          status: "ongoing",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T10:00:00.000Z",
          participated: true,
          allow_retake: false,
          submitted_at: "2026-04-09T09:00:00.000Z",
        },
        new Date("2026-04-09T09:30:00.000Z"),
      ),
    ).toBe(false);
  });

  it("treats an ended but unsubmitted exam as closed even if participated is true", () => {
    expect(
      getEffectiveStudentExamStatus(
        {
          status: "ongoing",
          start_time: "2026-04-09T08:00:00.000Z",
          end_time: "2026-04-09T09:00:00.000Z",
          participated: true,
          started_at: "2026-04-09T08:05:00.000Z",
          submitted_at: null,
        },
        new Date("2026-04-09T10:00:00.000Z"),
      ),
    ).toBe("closed");
  });
});
