import { describe, expect, it } from "vitest";

import { allocateExpansionQuestionIds } from "./paper-expand-utils";

describe("allocateExpansionQuestionIds", () => {
  it("按现有题型占比扩充到目标题数", () => {
    const current = ["single_choice", "multi_choice"] as const;
    const candidates = [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `s-${index}`,
        displayType: "single_choice" as const,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `m-${index}`,
        displayType: "multi_choice" as const,
      })),
    ];
    const picked = allocateExpansionQuestionIds([...current], candidates, 5);
    expect(picked).toHaveLength(3);
    expect(picked.filter((id) => id.startsWith("s-"))).toHaveLength(2);
    expect(picked.filter((id) => id.startsWith("m-"))).toHaveLength(1);
  });

  it("某个题型候选不足时用其它题型补齐", () => {
    const picked = allocateExpansionQuestionIds(
      ["single_choice", "multi_choice"] as const,
      [
        { id: "s-1", displayType: "single_choice" },
        { id: "t-1", displayType: "true_false" },
        { id: "t-2", displayType: "true_false" },
      ],
      5,
    );
    expect(picked).toHaveLength(3);
    expect(picked).toContain("s-1");
  });

  it("目标题数不超过现有题数时不补充", () => {
    expect(
      allocateExpansionQuestionIds(
        ["single_choice", "single_choice"] as const,
        [{ id: "s-1", displayType: "single_choice" }],
        2,
      ),
    ).toEqual([]);
  });
});
