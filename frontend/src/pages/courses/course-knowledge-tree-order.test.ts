import { describe, expect, it } from "vitest";

import type { CourseKnowledgeNode } from "./api";
import {
  collectKnowledgeSubtreeIds,
  describeKnowledgeMove,
  findKnowledgeNode,
  findKnowledgeParent,
  planKnowledgeDrop,
  planKnowledgeMove,
  resolveKnowledgeDropZone,
} from "./course-knowledge-tree-order";

function node(
  id: string,
  name: string,
  children: CourseKnowledgeNode[] = [],
): CourseKnowledgeNode {
  return { id, name, question_count: 0, material_count: 0, children };
}

/**
 * 课程根 course
 *   ├─ A
 *   │    ├─ A1
 *   │    └─ A2
 *   └─ B
 */
const TREE = node("course", "计算机网络基础", [
  node("A", "第一章", [node("A1", "1.1"), node("A2", "1.2")]),
  node("B", "第二章"),
]);

describe("findKnowledgeNode / findKnowledgeParent / collectKnowledgeSubtreeIds", () => {
  it("能找到深层节点与它的父节点", () => {
    expect(findKnowledgeNode(TREE, "A2")?.name).toBe("1.2");
    expect(findKnowledgeParent(TREE, "A2")?.id).toBe("A");
    expect(findKnowledgeParent(TREE, "course")).toBeNull();
    expect(findKnowledgeNode(TREE, "nope")).toBeNull();
  });

  it("收集子树 id 时含自身", () => {
    expect(collectKnowledgeSubtreeIds(findKnowledgeNode(TREE, "A")!)).toEqual([
      "A",
      "A1",
      "A2",
    ]);
  });
});

describe("describeKnowledgeMove", () => {
  it("给出同级下标与总数，根节点不可移动", () => {
    expect(describeKnowledgeMove(TREE, "A")).toEqual({
      index: 0,
      siblingCount: 2,
      parentId: "course",
    });
    expect(describeKnowledgeMove(TREE, "A2")).toEqual({
      index: 1,
      siblingCount: 2,
      parentId: "A",
    });
    expect(describeKnowledgeMove(TREE, "course")).toBeNull();
  });
});

describe("planKnowledgeMove", () => {
  it("同级上移：把第二个换到第一个", () => {
    // B 上移 → B 在「移除自己后的同级列表 [A]」里插到下标 0
    expect(planKnowledgeMove(TREE, "B", "course", 0)).toEqual({
      parent_id: "course",
      ordered_ids: ["B", "A"],
    });
  });

  it("同级下移：把第一个换到第二个", () => {
    expect(planKnowledgeMove(TREE, "A", "course", 1)).toEqual({
      parent_id: "course",
      ordered_ids: ["B", "A"],
    });
  });

  it("跨层级下移：A1 移到课程根目录下并追加到末尾", () => {
    expect(planKnowledgeMove(TREE, "A1", "course", null)).toEqual({
      parent_id: "course",
      ordered_ids: ["A", "B", "A1"],
    });
  });

  it("拖到目录上成为其子节点：插到指定位置", () => {
    expect(planKnowledgeMove(TREE, "B", "A", 0)).toEqual({
      parent_id: "A",
      ordered_ids: ["B", "A1", "A2"],
    });
  });

  it("插到已有兄弟后面时下标要忽略被移动节点自身", () => {
    // A1 想排到 A2 后面：移除 A1 后同级是 [A2]，插到下标 1 → [A2, A1]
    expect(planKnowledgeMove(TREE, "A1", "A", 1)).toEqual({
      parent_id: "A",
      ordered_ids: ["A2", "A1"],
    });
  });

  it("拒绝移动到自身或自己的后代下（会成环）", () => {
    expect(planKnowledgeMove(TREE, "A", "A", null)).toBeNull();
    expect(planKnowledgeMove(TREE, "A", "A1", null)).toBeNull();
  });

  it("根节点不可移动，未知节点返回 null", () => {
    expect(planKnowledgeMove(TREE, "course", "A", null)).toBeNull();
    expect(planKnowledgeMove(TREE, "nope", "A", null)).toBeNull();
    expect(planKnowledgeMove(TREE, "A1", "nope", null)).toBeNull();
  });

  it("顺序没变化时返回 null，避免发无意义的请求", () => {
    expect(planKnowledgeMove(TREE, "A", "course", 0)).toBeNull();
    expect(planKnowledgeMove(TREE, "A1", "A", 0)).toBeNull();
  });

  it("拖到自己的当前父节点上视为无操作，不会把节点挪到末尾", () => {
    expect(planKnowledgeMove(TREE, "A1", "A", null)).toBeNull();
    expect(planKnowledgeMove(TREE, "A", "course", null)).toBeNull();
  });

  it("插入下标越界时收敛到两端，收敛后没变化就返回 null", () => {
    expect(planKnowledgeMove(TREE, "A", "course", -5)).toBeNull();
    expect(planKnowledgeMove(TREE, "A", "course", 99)).toEqual({
      parent_id: "course",
      ordered_ids: ["B", "A"],
    });
  });
});

describe("planKnowledgeDrop", () => {
  it("落在节点上/下方 = 与它同级插到前/后", () => {
    expect(planKnowledgeDrop(TREE, "B", "A", "before")).toEqual({
      parent_id: "course",
      ordered_ids: ["B", "A"],
    });
    expect(planKnowledgeDrop(TREE, "A", "B", "after")).toEqual({
      parent_id: "course",
      ordered_ids: ["B", "A"],
    });
  });

  it("落在节点中间 = 成为它的子节点，追加到末尾", () => {
    expect(planKnowledgeDrop(TREE, "B", "A", "inside")).toEqual({
      parent_id: "A",
      ordered_ids: ["A1", "A2", "B"],
    });
  });

  it("落点是被拖节点自身或其后代时不可用", () => {
    expect(planKnowledgeDrop(TREE, "A", "A", "inside")).toBeNull();
    expect(planKnowledgeDrop(TREE, "A", "A1", "inside")).toBeNull();
    expect(planKnowledgeDrop(TREE, "A", "A1", "before")).toBeNull();
  });

  it("根节点没有同级，只能成为其子节点", () => {
    expect(planKnowledgeDrop(TREE, "A1", "course", "before")).toBeNull();
    expect(planKnowledgeDrop(TREE, "A1", "course", "inside")).toEqual({
      parent_id: "course",
      ordered_ids: ["A", "B", "A1"],
    });
  });
});

describe("resolveKnowledgeDropZone", () => {
  it("按行内相对位置划分三段", () => {
    expect(resolveKnowledgeDropZone(0)).toBe("before");
    expect(resolveKnowledgeDropZone(0.24)).toBe("before");
    expect(resolveKnowledgeDropZone(0.5)).toBe("inside");
    expect(resolveKnowledgeDropZone(0.76)).toBe("after");
    expect(resolveKnowledgeDropZone(1)).toBe("after");
  });
});
