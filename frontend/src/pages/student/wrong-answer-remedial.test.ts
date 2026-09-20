import { describe, expect, it } from "vitest";

import {
  buildRemedialPracticeHref,
  distributePracticeCounts,
  getRemedialPracticeStatus,
  getWrongAnswerSourceKey,
  resolveStudentReturnHref,
  type IRemedialPracticeGroup,
  type IRemedialPracticeSummary,
} from "./wrong-answer-shared";

function buildGroup(overrides: Partial<IRemedialPracticeGroup>): IRemedialPracticeGroup {
  return {
    key: "kp:a",
    knowledge_point_id: "a",
    name: "DNS 域名系统",
    path: "计算机网络 > 应用层 > DNS 域名系统",
    wrong_question_count: 1,
    suggested_count: 0,
    ...overrides,
  };
}

function buildPractice(
  overrides: Partial<IRemedialPracticeSummary>,
): IRemedialPracticeSummary {
  return {
    id: "practice-1",
    title: "SQL 基础练习 · 错题强化练习",
    question_count: 10,
    duration_minutes: 20,
    created_at: "2026-09-19T02:00:00.000Z",
    started_at: null,
    submitted_at: null,
    score: null,
    total_score: 100,
    ...overrides,
  };
}

describe("distributePracticeCounts", () => {
  it("splits the total by wrong-answer weight and keeps the sum", () => {
    const counts = distributePracticeCounts(
      [
        buildGroup({ key: "kp:a", wrong_question_count: 3 }),
        buildGroup({ key: "kp:b", wrong_question_count: 1 }),
      ],
      8,
    );

    expect(counts).toEqual({ "kp:a": 6, "kp:b": 2 });
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(8);
  });

  it("concentrates the total on the biggest group when there are more groups than questions", () => {
    const counts = distributePracticeCounts(
      [
        buildGroup({ key: "kp:a", wrong_question_count: 5 }),
        buildGroup({ key: "kp:b", wrong_question_count: 1 }),
        buildGroup({ key: "kp:c", wrong_question_count: 1 }),
      ],
      2,
    );

    expect(counts).toEqual({ "kp:a": 2 });
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it("returns nothing for a zero total", () => {
    expect(distributePracticeCounts([buildGroup({})], 0)).toEqual({});
  });
});

describe("remedial practice helpers", () => {
  it("derives the practice status from the attempt timestamps", () => {
    expect(getRemedialPracticeStatus(buildPractice({}))).toBe("not_started");
    expect(
      getRemedialPracticeStatus(buildPractice({ started_at: "2026-09-19T03:00:00.000Z" })),
    ).toBe("in_progress");
    expect(
      getRemedialPracticeStatus(
        buildPractice({ started_at: "2026-09-19T03:00:00.000Z", submitted_at: "2026-09-19T04:00:00.000Z" }),
      ),
    ).toBe("submitted");
  });

  it("uses the legacy key when a group has no exam", () => {
    expect(getWrongAnswerSourceKey(null)).toBe("legacy");
    expect(getWrongAnswerSourceKey("exam-1")).toBe("exam-1");
  });

  it("carries the source so the practice can be traced back to the wrong-answer book", () => {
    expect(buildRemedialPracticeHref("exam-1", "practice-1", "take")).toBe(
      "/my-exams/practice-1/take?from=wrong-answers&source=exam-1",
    );
    expect(buildRemedialPracticeHref("legacy", "practice-1", "result")).toBe(
      "/my-exams/practice-1/result?from=wrong-answers&source=legacy",
    );
  });

  it("sends the student back to the wrong-answer book only when they came from there", () => {
    expect(resolveStudentReturnHref("")).toBe("/my-exams");
    expect(resolveStudentReturnHref("?retake=1")).toBe("/my-exams");
    expect(resolveStudentReturnHref("?from=wrong-answers&source=exam-1")).toBe(
      "/wrong-answers/exam/exam-1",
    );
    expect(resolveStudentReturnHref(new URLSearchParams("from=wrong-answers"))).toBe(
      "/wrong-answers",
    );
  });
});
