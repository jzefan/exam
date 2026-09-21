/**
 * 课程目录（知识点树）的重排计算。
 *
 * 编辑器里两种操作共用同一条落库口径：
 * - 「上移 / 下移」= 同父节点内换位置；
 * - 「拖到某个目录上」= 换父节点后追加到末尾。
 *
 * 两者最终都归纳为「目标父节点下的完整同级顺序」，
 * 交给 `POST /api/knowledge/knowledge-points/{id}/reorder`。
 */

import type { CourseKnowledgeNode } from "./api";

export interface KnowledgeMovePlan {
  /** 目标父节点 id（必为真实节点，课程根节点也算父节点）。 */
  parent_id: string;
  /** 重排后目标父节点下的完整同级顺序。 */
  ordered_ids: string[];
}

export interface KnowledgeMoveBounds {
  /** 当前节点在兄弟中的下标。 */
  index: number;
  /** 同级节点总数（含自己）。 */
  siblingCount: number;
  parentId: string;
}

/** 深度优先查找节点。 */
export function findKnowledgeNode(
  node: CourseKnowledgeNode,
  nodeId: string,
): CourseKnowledgeNode | null {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const found = findKnowledgeNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

/** 找 nodeId 的父节点；nodeId 是根节点或不存在时返回 null。 */
export function findKnowledgeParent(
  node: CourseKnowledgeNode,
  nodeId: string,
): CourseKnowledgeNode | null {
  for (const child of node.children) {
    if (child.id === nodeId) return node;
    const found = findKnowledgeParent(child, nodeId);
    if (found) return found;
  }
  return null;
}

/** 收集某个节点及其全部后代的 id。 */
export function collectKnowledgeSubtreeIds(node: CourseKnowledgeNode): string[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(...collectKnowledgeSubtreeIds(child));
  }
  return ids;
}

/** 取某个节点的同级位置信息，用于决定「上移 / 下移」是否可用。 */
export function describeKnowledgeMove(
  tree: CourseKnowledgeNode,
  nodeId: string,
): KnowledgeMoveBounds | null {
  if (tree.id === nodeId) return null;
  const parent = findKnowledgeParent(tree, nodeId);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.id === nodeId);
  if (index < 0) return null;
  return { index, siblingCount: parent.children.length, parentId: parent.id };
}

/**
 * 计算一次移动要提交的重排请求。
 *
 * `insertIndex` 是「把被移动节点从同级里拿掉之后」的插入下标（0..n）；
 * 传 null 表示追加到末尾（拖到目录上「成为子目录」时用这个）。
 * 无法移动（节点不存在、拖到自身或自己的后代上、顺序没变化）时返回 null。
 */
export function planKnowledgeMove(
  tree: CourseKnowledgeNode,
  nodeId: string,
  targetParentId: string,
  insertIndex: number | null,
): KnowledgeMovePlan | null {
  const moved = findKnowledgeNode(tree, nodeId);
  if (!moved) return null;

  const currentParent = findKnowledgeParent(tree, nodeId);
  if (!currentParent) return null; // 课程根节点没有父节点，不可移动

  const target = findKnowledgeNode(tree, targetParentId);
  if (!target) return null;

  // 拖到自身或自己的后代下会形成环，后端也会拒，前端先拦掉。
  if (collectKnowledgeSubtreeIds(moved).includes(target.id)) return null;

  const siblings = target.children.filter((child) => child.id !== nodeId);
  const insertAt =
    insertIndex === null
      ? siblings.length
      : Math.max(0, Math.min(insertIndex, siblings.length));

  // 拖到「当前父节点」身上只是重申它已经是子节点，不该把节点莫名挪到末尾。
  if (insertIndex === null && currentParent.id === target.id) return null;

  const orderedIds = [
    ...siblings.slice(0, insertAt).map((child) => child.id),
    nodeId,
    ...siblings.slice(insertAt).map((child) => child.id),
  ];

  const unchanged =
    currentParent.id === target.id &&
    currentParent.children.length === orderedIds.length &&
    currentParent.children.every((child, index) => child.id === orderedIds[index]);
  if (unchanged) return null;

  return { parent_id: target.id, ordered_ids: orderedIds };
}

/**
 * 拖拽落点换算：
 * - 落在某个节点的「上方 / 下方」→ 与它同级插到前 / 后；
 * - 落在节点中间 → 成为它的子节点（追加到末尾）。
 */
export type KnowledgeDropZone = "before" | "after" | "inside";

export function planKnowledgeDrop(
  tree: CourseKnowledgeNode,
  draggedId: string,
  targetId: string,
  zone: KnowledgeDropZone,
): KnowledgeMovePlan | null {
  const target = findKnowledgeNode(tree, targetId);
  if (!target) return null;

  if (zone === "inside") {
    return planKnowledgeMove(tree, draggedId, target.id, null);
  }

  const parent = findKnowledgeParent(tree, target.id);
  if (!parent) return null; // 根节点没有同级，只能"成为其子节点"

  // 落点下标要在「已移除被拖节点的同级列表」里算。
  const siblings = parent.children.filter((child) => child.id !== draggedId);
  const targetIndex = siblings.findIndex((child) => child.id === target.id);
  if (targetIndex < 0) return null;
  return planKnowledgeMove(
    tree,
    draggedId,
    parent.id,
    zone === "before" ? targetIndex : targetIndex + 1,
  );
}

/** 根据指针在行内的相对位置判断落点区域。 */
export function resolveKnowledgeDropZone(offsetRatio: number): KnowledgeDropZone {
  if (offsetRatio < 0.25) return "before";
  if (offsetRatio > 0.75) return "after";
  return "inside";
}
