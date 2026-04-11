import { afterEach, describe, expect, it } from "vitest";

import { getStudentLocale, tStudent, translateStudentError } from "./i18n";

describe("student i18n", () => {
  afterEach(() => {
    window.localStorage.removeItem("student_locale");
  });

  it("defaults to zh locale", () => {
    expect(getStudentLocale()).toBe("zh");
    expect(translateStudentError("Exam already submitted")).toBe("考试已提交");
  });

  it("supports english locale when configured", () => {
    window.localStorage.setItem("student_locale", "en");

    expect(getStudentLocale()).toBe("en");
    expect(translateStudentError("Exam already submitted")).toBe(
      "Exam already submitted",
    );
    expect(tStudent("time_up_countdown", { seconds: 3 })).toBe(
      "Time is up, auto-submitting in 3 seconds...",
    );
  });
});
