import { describe, expect, it } from "vitest";

import { displayAssesseeNoun, displayEvaluatorNoun, displayRole } from "./role-display";

describe("displayRole", () => {
  it("shows 教师 for evaluator in school", () => {
    expect(displayRole("school", "evaluator")).toBe("教师");
  });

  it("shows HR for evaluator in enterprise", () => {
    expect(displayRole("enterprise", "evaluator")).toBe("HR");
  });

  it("shows 学生 for assessee in school", () => {
    expect(displayRole("school", "assessee")).toBe("学生");
  });

  it("shows 候选人 for assessee in enterprise", () => {
    expect(displayRole("enterprise", "assessee")).toBe("候选人");
  });
});

describe("displayAssesseeNoun", () => {
  it("returns 学生 for school", () => {
    expect(displayAssesseeNoun("school")).toBe("学生");
  });

  it("returns 候选人 for enterprise", () => {
    expect(displayAssesseeNoun("enterprise")).toBe("候选人");
  });
});

describe("displayEvaluatorNoun", () => {
  it("returns HR for enterprise", () => {
    expect(displayEvaluatorNoun("enterprise")).toBe("HR");
  });
});
