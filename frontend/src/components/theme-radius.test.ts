import { describe, expect, it } from "vitest";
import { createGenerator } from "unocss";

import unoConfig from "../../uno.config";

describe("theme radius utilities", () => {
  it("maps common rounded classes to the configurable radius token", async () => {
    const uno = await createGenerator(unoConfig);
    const { css } = await uno.generate("rounded-sm rounded-md rounded-lg rounded-xl rounded-2xl rounded-3xl");

    expect(css).toContain(".rounded-sm");
    expect(css).toContain("max(0px, calc(var(--radius) - 4px))");
    expect(css).toContain(".rounded-md");
    expect(css).toContain("max(0px, calc(var(--radius) - 2px))");
    expect(css).toContain(".rounded-lg");
    expect(css).toContain("border-radius:var(--radius)");
    expect(css).toContain(".rounded-xl");
    expect(css).toContain("calc(var(--radius) + 4px)");
    expect(css).toContain(".rounded-2xl");
    expect(css).toContain("calc(var(--radius) + 8px)");
    expect(css).toContain(".rounded-3xl");
    expect(css).toContain("calc(var(--radius) + 12px)");
  });
});
