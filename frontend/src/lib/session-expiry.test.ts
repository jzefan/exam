import { describe, expect, it } from "vitest";
import { sessionLoginUrl, shouldExpireSession } from "./session-expiry";

describe("course session expiry", () => {
  it("returns to authentication in the same course and preserves the pending page", () => {
    expect(
      sessionLoginUrl("/c/demo/questions/create", "?knowledge_point_id=123"),
    ).toBe("/c/demo/login?to=%2Fquestions%2Fcreate%3Fknowledge_point_id%3D123");
    expect(sessionLoginUrl("/course-share/demo/login")).toBe(
      "/course-share/demo/login?to=%2F",
    );
    expect(sessionLoginUrl("/courses")).toBe("/login");
  });
  it("ignores stale and anonymous responses after logout or an account switch", () => {
    expect(shouldExpireSession("/api/questions", "Bearer old", null)).toBe(
      false,
    );
    expect(shouldExpireSession("/api/questions", "Bearer old", "new")).toBe(
      false,
    );
    expect(shouldExpireSession("/api/questions", null, "new")).toBe(false);
    expect(shouldExpireSession("/api/auth/login", "Bearer old", "old")).toBe(
      false,
    );
    expect(
      shouldExpireSession("/api/questions", "Bearer current", "current"),
    ).toBe(true);
  });
});
