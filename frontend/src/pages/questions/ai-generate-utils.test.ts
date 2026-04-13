import { describe, expect, it } from "vitest";

import {
  buildKnowledgeTreeVisibility,
  buildRecentKeywordState,
  buildRecentKnowledgePointState,
  getTopRecentKeywords,
  getTopRecentKnowledgePoints,
  validateTypeAllocation,
} from "./ai-generate-utils";

const nodes = [
  { id: "root-1", name: "数据结构", parent_id: null, direction_id: "dir-1" },
  { id: "child-1", name: "二叉树", parent_id: "root-1", direction_id: "dir-1" },
  { id: "child-2", name: "图", parent_id: "root-1", direction_id: "dir-1" },
  { id: "root-2", name: "数据库", parent_id: null, direction_id: "dir-1" },
];

describe("ai generate knowledge picker utils", () => {
  it("keeps matched nodes and all ancestors visible", () => {
    const visibility = buildKnowledgeTreeVisibility(nodes, "二叉");

    expect(visibility.visibleNodeIds.has("child-1")).toBe(true);
    expect(visibility.visibleNodeIds.has("root-1")).toBe(true);
    expect(visibility.visibleNodeIds.has("root-2")).toBe(false);
    expect(visibility.autoExpandedNodeIds.has("root-1")).toBe(true);
  });

  it("returns all nodes visible when keyword is empty", () => {
    const visibility = buildKnowledgeTreeVisibility(nodes, "");

    expect(visibility.visibleNodeIds.size).toBe(4);
    expect(visibility.autoExpandedNodeIds.size).toBe(0);
  });

  it("accumulates recent knowledge point usage and sorts by frequency", () => {
    const state = buildRecentKnowledgePointState(
      {
        kp1: { id: "kp1", name: "数组", path: "计算机 > 数据结构 > 数组", count: 1, updated_at: 1 },
      },
      [
        { id: "kp2", name: "二叉树", path: "计算机 > 数据结构 > 二叉树" },
        { id: "kp1", name: "数组", path: "计算机 > 数据结构 > 数组" },
      ],
      10,
    );

    const top = getTopRecentKnowledgePoints(state, 2);
    expect(top[0]).toMatchObject({ id: "kp1", count: 2 });
    expect(top[1]).toMatchObject({ id: "kp2", count: 1 });
  });

  it("normalizes keyword usage and sorts by frequency", () => {
    const state = buildRecentKeywordState(
      {
        树: { keyword: "树", count: 1, updated_at: 1 },
      },
      " 二叉树 ",
      10,
    );
    const next = buildRecentKeywordState(state, "树", 20);

    expect(getTopRecentKeywords(next, 2)).toEqual([
      { keyword: "树", count: 2, updated_at: 20 },
      { keyword: "二叉树", count: 1, updated_at: 10 },
    ]);
  });

  it("validates custom type allocation against total count", () => {
    expect(
      validateTypeAllocation(20, {
        choice: 10,
        true_false: 5,
        fill_in: 5,
        short_answer: 0,
        essay: 0,
        code: 0,
      }),
    ).toMatchObject({ allocated: 20, hasCustomAllocation: true, isValid: true });

    expect(
      validateTypeAllocation(20, {
        choice: 10,
        true_false: 5,
        fill_in: 4,
        short_answer: 0,
        essay: 0,
        code: 0,
      }),
    ).toMatchObject({ allocated: 19, hasCustomAllocation: true, isValid: false });
  });
});
