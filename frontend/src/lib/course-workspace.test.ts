import { describe, expect, it } from "vitest";
import { courseWorkspaceEntry, safeCourseReturnTo } from "./course-workspace";

describe("course workspace routing", () => {
  it("keeps teaching and authentication under either public entry", () => {
    expect(courseWorkspaceEntry("/c/abc-123/login")).toEqual({
      basePath: "/c/abc-123",
      shareCode: "abc-123",
    });
    expect(courseWorkspaceEntry("/course-share/abc/questions/create")).toEqual({
      basePath: "/course-share/abc",
      shareCode: "abc",
    });
    expect(courseWorkspaceEntry("/courses/abc")).toBeNull();
  });
  it("resumes the requested action without leaving the course or looping into login", () => {
    expect(safeCourseReturnTo("/courses/123?tab=manage&create=semester")).toBe(
      "/courses/123?tab=manage&create=semester",
    );
    for (const value of [
      null,
      "https://other.test",
      "//other.test",
      "/\\other.test",
      "/login?to=/register",
      "/register",
    ]) {
      expect(safeCourseReturnTo(value)).toBe("/");
    }
  });
});
