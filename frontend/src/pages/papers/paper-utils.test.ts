import { describe, expect, it } from "vitest";

import { getDifficultyStrategyLabel } from "./api";

describe("paper api helpers", () => {
  it("labels paper AI difficulty strategies", () => {
    expect(getDifficultyStrategyLabel("similar")).toBe("接近原卷");
    expect(getDifficultyStrategyLabel("easier")).toBe("略降");
    expect(getDifficultyStrategyLabel("harder")).toBe("略升");
  });
});
