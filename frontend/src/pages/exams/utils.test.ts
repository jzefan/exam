import { describe, expect, it } from "vitest";

import { getEffectiveExamStatus } from "./utils";

describe("getEffectiveExamStatus", () => {
  it("treats a started exam as ongoing even if backend status is upcoming", () => {
    expect(
      getEffectiveExamStatus(
        {
          status: "upcoming",
          start_time: "2026-04-09T01:13:00.000Z",
          end_time: "2026-04-15T01:00:00.000Z",
        },
        new Date("2026-04-10T11:11:00.000Z"),
      ),
    ).toBe("ongoing");
  });

  it("treats an ended exam as completed", () => {
    expect(
      getEffectiveExamStatus(
        {
          status: "ongoing",
          start_time: "2026-04-09T01:13:00.000Z",
          end_time: "2026-04-10T01:00:00.000Z",
        },
        new Date("2026-04-10T11:11:00.000Z"),
      ),
    ).toBe("completed");
  });

  it("preserves draft and closed statuses", () => {
    expect(
      getEffectiveExamStatus(
        {
          status: "draft",
          start_time: "2026-04-09T01:13:00.000Z",
          end_time: "2026-04-15T01:00:00.000Z",
        },
        new Date("2026-04-10T11:11:00.000Z"),
      ),
    ).toBe("draft");

    expect(
      getEffectiveExamStatus(
        {
          status: "closed",
          start_time: "2026-04-09T01:13:00.000Z",
          end_time: "2026-04-15T01:00:00.000Z",
        },
        new Date("2026-04-10T11:11:00.000Z"),
      ),
    ).toBe("closed");
  });
});
