import { describe, expect, it } from "vitest";

import { buildExamSettingsUpdate } from "./exam-view-utils";

const settings = {
  max_switch_count: 2,
  show_result: true,
  allow_retake: true,
  show_score: false,
};

describe("buildExamSettingsUpdate", () => {
  it("persists the practice retake setting", () => {
    expect(buildExamSettingsUpdate("practice", settings)).toEqual({
      show_result: true,
      show_score: false,
      allow_retake: true,
    });
  });

  it("keeps exam-specific settings in the exam update", () => {
    expect(buildExamSettingsUpdate("exam", settings)).toEqual(settings);
  });
});
