import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  getDraft,
  purgeAll,
  purgeAllExcept,
  purgeForPrincipal,
  setDraft,
} from "./exam-draft";

const PRINCIPAL = "user-001";
const ATTEMPT = "exam-abc";

const ANSWERS: Record<string, unknown> = {
  "q-1": { selected: ["A"] },
  "q-2": { text: "hello" },
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exam-draft", () => {
  describe("setDraft / getDraft", () => {
    it("roundtrips answers through localStorage", () => {
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);
      const draft = getDraft(PRINCIPAL, ATTEMPT);
      expect(draft).not.toBeNull();
      expect(draft!.answers).toEqual(ANSWERS);
      expect(draft!.principal_id).toBe(PRINCIPAL);
      expect(draft!.attempt_id).toBe(ATTEMPT);
    });

    it("keys are scoped to principal+attempt", () => {
      setDraft("user-A", "exam-1", { "q-1": { selected: ["A"] } });
      setDraft("user-B", "exam-1", { "q-1": { selected: ["B"] } });

      const draftA = getDraft("user-A", "exam-1");
      const draftB = getDraft("user-B", "exam-1");

      expect((draftA!.answers["q-1"] as { selected: string[] }).selected).toEqual(["A"]);
      expect((draftB!.answers["q-1"] as { selected: string[] }).selected).toEqual(["B"]);
    });

    it("returns null for unknown key", () => {
      expect(getDraft(PRINCIPAL, "unknown-exam")).toBeNull();
    });

    it("returns null for expired draft", () => {
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);

      // Fake Date.now() to be 15 days in the future
      const fifteenDays = 15 * 24 * 60 * 60 * 1000;
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + fifteenDays);

      expect(getDraft(PRINCIPAL, ATTEMPT)).toBeNull();
    });

    it("returns null and removes corrupted entry", () => {
      const key = `exam-draft:${PRINCIPAL}:${ATTEMPT}`;
      window.localStorage.setItem(key, "{invalid json");
      expect(getDraft(PRINCIPAL, ATTEMPT)).toBeNull();
      expect(window.localStorage.getItem(key)).toBeNull();
    });

    it("last_local_save_ms is recent", () => {
      const before = Date.now();
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);
      const after = Date.now();
      const draft = getDraft(PRINCIPAL, ATTEMPT)!;
      expect(draft.last_local_save_ms).toBeGreaterThanOrEqual(before);
      expect(draft.last_local_save_ms).toBeLessThanOrEqual(after);
    });

    it("overwrites existing draft on second setDraft", () => {
      setDraft(PRINCIPAL, ATTEMPT, { "q-1": { selected: ["A"] } });
      setDraft(PRINCIPAL, ATTEMPT, { "q-1": { selected: ["B"] } });
      const draft = getDraft(PRINCIPAL, ATTEMPT)!;
      expect((draft.answers["q-1"] as { selected: string[] }).selected).toEqual(["B"]);
    });
  });

  describe("clearDraft", () => {
    it("removes draft from localStorage", () => {
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);
      clearDraft(PRINCIPAL, ATTEMPT);
      expect(getDraft(PRINCIPAL, ATTEMPT)).toBeNull();
    });

    it("is a no-op for non-existent draft", () => {
      expect(() => clearDraft(PRINCIPAL, "no-such-exam")).not.toThrow();
    });
  });

  describe("purgeForPrincipal", () => {
    it("removes all drafts for a given principal", () => {
      setDraft(PRINCIPAL, "exam-1", ANSWERS);
      setDraft(PRINCIPAL, "exam-2", ANSWERS);
      setDraft("other-user", "exam-1", ANSWERS);

      purgeForPrincipal(PRINCIPAL);

      expect(getDraft(PRINCIPAL, "exam-1")).toBeNull();
      expect(getDraft(PRINCIPAL, "exam-2")).toBeNull();
      expect(getDraft("other-user", "exam-1")).not.toBeNull();
    });
  });

  describe("purgeAllExcept", () => {
    it("removes drafts for other principals only", () => {
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);
      setDraft("user-other", "exam-x", ANSWERS);

      purgeAllExcept(PRINCIPAL);

      expect(getDraft(PRINCIPAL, ATTEMPT)).not.toBeNull();
      expect(getDraft("user-other", "exam-x")).toBeNull();
    });
  });

  describe("purgeAll", () => {
    it("removes all drafts from localStorage", () => {
      setDraft("user-A", "exam-1", ANSWERS);
      setDraft("user-B", "exam-2", ANSWERS);

      purgeAll();

      expect(getDraft("user-A", "exam-1")).toBeNull();
      expect(getDraft("user-B", "exam-2")).toBeNull();
    });

    it("does not remove non-draft localStorage entries", () => {
      window.localStorage.setItem("other-key", "keep-me");
      setDraft(PRINCIPAL, ATTEMPT, ANSWERS);
      purgeAll();
      expect(window.localStorage.getItem("other-key")).toBe("keep-me");
    });
  });
});
