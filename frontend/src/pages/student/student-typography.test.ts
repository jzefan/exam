import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const targets = [
  "/Users/jzefan/work/proj/exam/frontend/src/components/student-layout.tsx",
  "/Users/jzefan/work/proj/exam/frontend/src/pages/student/dashboard.tsx",
  "/Users/jzefan/work/proj/exam/frontend/src/pages/student/my-exams.tsx",
];

describe("student typography guard", () => {
  it("keeps student-facing layout and dashboard typography at text-lg or below", () => {
    for (const file of targets) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/text-(xl|2xl|3xl|4xl|5xl|6xl)\b/);
    }
  });
});
