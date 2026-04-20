import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("theme radius utilities", () => {
  it("keeps common rounded classes mapped to the configurable radius token", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const radiusTokens = {
      sm: "max(0px, calc(var(--radius) - 4px))",
      md: "max(0px, calc(var(--radius) - 2px))",
      lg: "var(--radius)",
      xl: "calc(var(--radius) + 4px)",
      "2xl": "calc(var(--radius) + 8px)",
      "3xl": "calc(var(--radius) + 12px)",
    };

    for (const [name, value] of Object.entries(radiusTokens)) {
      expect(styles).toContain(`--radius-${name}: ${value};`);
    }
  });
});
