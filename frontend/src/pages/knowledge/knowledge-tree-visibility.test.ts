import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import type { IKnowledgePointDetail } from "./types";
import {
  buildDefaultCollapsedKnowledgeNodeIds,
  buildKnowledgeChildCountMap,
  getAnchoredViewport,
  layoutVisibleKnowledgeTree,
  getVisibleKnowledgeSubtree,
  toggleKnowledgeNodeCollapse,
} from "./knowledge-tree-visibility";

function makeNode(id: string, parentId: string | null): Node {
  return {
    id,
    type: "knowledgeNode",
    position: { x: 0, y: 0 },
    data: {
      id,
      name: id,
      description: null,
      tags: [],
      difficulty: null,
      parent_id: parentId,
      direction_id: "direction-1",
      question_count: 0,
    } satisfies IKnowledgePointDetail,
  };
}

describe("knowledge tree visibility", () => {
  const nodes: Node[] = [
    makeNode("root", null),
    makeNode("chapter-1", "root"),
    makeNode("lesson-1", "chapter-1"),
    makeNode("lesson-2", "chapter-1"),
    makeNode("chapter-2", "root"),
  ];

  const edges: Edge[] = [
    { id: "root->chapter-1", source: "root", target: "chapter-1", type: "smoothstep" },
    { id: "chapter-1->lesson-1", source: "chapter-1", target: "lesson-1", type: "smoothstep" },
    { id: "chapter-1->lesson-2", source: "chapter-1", target: "lesson-2", type: "smoothstep" },
    { id: "root->chapter-2", source: "root", target: "chapter-2", type: "smoothstep" },
    { id: "lesson-1->chapter-2", source: "lesson-1", target: "chapter-2", type: "prerequisite" },
  ];

  it("keeps the full selected subtree visible by default", () => {
    const visible = getVisibleKnowledgeSubtree(nodes, edges, "root", new Set());

    expect(visible.nodes.map((node) => node.id)).toEqual([
      "root",
      "chapter-1",
      "lesson-1",
      "lesson-2",
      "chapter-2",
    ]);
    expect(visible.edges.map((edge) => edge.id)).toEqual([
      "root->chapter-1",
      "chapter-1->lesson-1",
      "chapter-1->lesson-2",
      "root->chapter-2",
      "lesson-1->chapter-2",
    ]);
  });

  it("defaults to a course-chapter graph with lower knowledge levels collapsed", () => {
    const defaultCollapsed = buildDefaultCollapsedKnowledgeNodeIds(nodes, "root");
    const visible = getVisibleKnowledgeSubtree(nodes, edges, "root", defaultCollapsed);

    expect([...defaultCollapsed]).toEqual(["chapter-1"]);
    expect(visible.nodes.map((node) => node.id)).toEqual([
      "root",
      "chapter-1",
      "chapter-2",
    ]);
    expect(visible.edges.map((edge) => edge.id)).toEqual([
      "root->chapter-1",
      "root->chapter-2",
    ]);
  });

  it("keeps a collapsed node visible while hiding all of its descendants and related edges", () => {
    const visible = getVisibleKnowledgeSubtree(nodes, edges, "root", new Set(["chapter-1"]));

    expect(visible.nodes.map((node) => node.id)).toEqual([
      "root",
      "chapter-1",
      "chapter-2",
    ]);
    expect(visible.edges.map((edge) => edge.id)).toEqual([
      "root->chapter-1",
      "root->chapter-2",
    ]);
  });

  it("counts direct children for collapse affordances", () => {
    const counts = buildKnowledgeChildCountMap(nodes);

    expect(counts.get("root")).toBe(2);
    expect(counts.get("chapter-1")).toBe(2);
    expect(counts.get("chapter-2")).toBe(0);
  });

  it("lays out visible nodes with enough space for expanded subtrees", () => {
    const expanded = layoutVisibleKnowledgeTree(nodes, edges, "root", new Set());
    const expandedById = new Map(expanded.nodes.map((node) => [node.id, node]));

    expect(expandedById.get("lesson-2")!.position.y - expandedById.get("lesson-1")!.position.y).toBeGreaterThanOrEqual(56);
    expect(expandedById.get("chapter-2")!.position.y).toBeGreaterThan(expandedById.get("lesson-2")!.position.y);
    expect(expandedById.get("chapter-1")!.position.y).toBe(
      (expandedById.get("lesson-1")!.position.y + expandedById.get("lesson-2")!.position.y) / 2,
    );

    const collapsed = layoutVisibleKnowledgeTree(nodes, edges, "root", new Set(["chapter-1"]));
    const collapsedById = new Map(collapsed.nodes.map((node) => [node.id, node]));

    expect(collapsed.nodes.map((node) => node.id)).toEqual(["root", "chapter-1", "chapter-2"]);
    expect(collapsedById.get("chapter-2")!.position.y).toBeLessThan(expandedById.get("chapter-2")!.position.y);
  });

  it("uses tighter leaf spacing when many leaf nodes are visible", () => {
    const manyLeafNodes = [
      makeNode("root", null),
      ...Array.from({ length: 30 }, (_, index) => makeNode(`leaf-${index + 1}`, "root")),
    ];
    const manyLeafEdges = manyLeafNodes
      .filter((node) => node.id !== "root")
      .map((node) => ({
        id: `root->${node.id}`,
        source: "root",
        target: node.id,
        type: "smoothstep",
      }));

    const laidOut = layoutVisibleKnowledgeTree(manyLeafNodes, manyLeafEdges, "root", new Set());
    const leaf1 = laidOut.nodes.find((node) => node.id === "leaf-1")!;
    const leaf2 = laidOut.nodes.find((node) => node.id === "leaf-2")!;

    expect(leaf2.position.y - leaf1.position.y).toBeLessThanOrEqual(48);
    expect(leaf2.position.y - leaf1.position.y).toBeGreaterThanOrEqual(36);
  });

  it("keeps the toggled node at the same screen position when its layout position changes", () => {
    expect(
      getAnchoredViewport(
        { x: 120, y: 80, zoom: 1.5 },
        { x: 280, y: 100 },
        { x: 280, y: 220 },
      ),
    ).toEqual({ x: 120, y: -100, zoom: 1.5 });
  });

  it("calculates the next collapsed ids without mutating the current set", () => {
    const current = new Set(["chapter-1"]);
    const expanded = toggleKnowledgeNodeCollapse(current, "chapter-1");
    const collapsed = toggleKnowledgeNodeCollapse(current, "chapter-2");

    expect([...current]).toEqual(["chapter-1"]);
    expect(expanded.has("chapter-1")).toBe(false);
    expect(collapsed.has("chapter-1")).toBe(true);
    expect(collapsed.has("chapter-2")).toBe(true);
  });
});
