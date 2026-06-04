import { describe, expect, it } from "vitest";

import { parseTimeInput, stepTime } from "./date-picker-utils";

describe("parseTimeInput", () => {
  it("normalizes single-digit hours and minutes", () => {
    expect(parseTimeInput("9:5")).toBe("09:05");
  });

  it("keeps well-formed times", () => {
    expect(parseTimeInput("09:30")).toBe("09:30");
    expect(parseTimeInput("23:59")).toBe("23:59");
    expect(parseTimeInput("00:00")).toBe("00:00");
  });

  it("accepts a full-width colon and surrounding whitespace", () => {
    expect(parseTimeInput("  14：00 ")).toBe("14:00");
  });

  it("rejects out-of-range values", () => {
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("12:60")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseTimeInput("0930")).toBeNull();
    expect(parseTimeInput("9")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("ab:cd")).toBeNull();
  });
});

describe("stepTime", () => {
  it("steps by whole grid units on an aligned value", () => {
    expect(stepTime("09:00", 1, 5)).toBe("09:05");
    expect(stepTime("09:00", -1, 5)).toBe("08:55");
  });

  it("snaps off-grid values to the grid before stepping", () => {
    expect(stepTime("09:03", 1, 5)).toBe("09:05");
    expect(stepTime("09:03", -1, 5)).toBe("09:00");
  });

  it("clamps within a single day", () => {
    expect(stepTime("00:00", -1, 5)).toBe("00:00");
    expect(stepTime("23:55", 1, 5)).toBe("23:59");
  });

  it("rolls across the hour boundary", () => {
    expect(stepTime("09:55", 1, 5)).toBe("10:00");
    expect(stepTime("10:00", -1, 5)).toBe("09:55");
  });
});
