import type { Edge, Node } from "@xyflow/react";

import type { IKnowledgePointDetail } from "./types";

const HORIZONTAL_SPACING = 280;
const SUBTREE_GAP = 20;

type FlowPosition = { x: number; y: number };
type ViewportLike = FlowPosition & { zoom: number };

function getLeafSpacing(leafCount: number): number {
  if (leafCount > 40) {
    return 38;
  }
  if (leafCount > 20) {
    return 44;
  }
  if (leafCount > 8) {
    return 52;
  }
  return 64;
}

function buildKnowledgeChildMap(nodes: Node[]): Map<string, string[]> {
  const childIdsByParent = new Map<string, string[]>();

  for (const node of nodes) {
    const data = node.data as IKnowledgePointDetail;
    if (!data.parent_id) {
      continue;
    }
    const siblings = childIdsByParent.get(data.parent_id) ?? [];
    siblings.push(node.id);
    childIdsByParent.set(data.parent_id, siblings);
  }

  return childIdsByParent;
}

export function buildKnowledgeChildCountMap(nodes: Node[]): Map<string, number> {
  const childIdsByParent = buildKnowledgeChildMap(nodes);
  const counts = new Map<string, number>();

  for (const node of nodes) {
    counts.set(node.id, childIdsByParent.get(node.id)?.length ?? 0);
  }

  return counts;
}

export function buildDefaultCollapsedKnowledgeNodeIds(
  nodes: Node[],
  rootId: string | null,
): Set<string> {
  const collapsedNodeIds = new Set<string>();
  if (!rootId) {
    return collapsedNodeIds;
  }

  const childIdsByParent = buildKnowledgeChildMap(nodes);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  const visitedIds = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visitedIds.has(current.id)) {
      continue;
    }
    visitedIds.add(current.id);

    const childIds = childIdsByParent.get(current.id) ?? [];
    if (current.depth >= 1 && childIds.length > 0) {
      collapsedNodeIds.add(current.id);
    }

    for (const childId of childIds) {
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }

  return collapsedNodeIds;
}

export function getVisibleKnowledgeSubtree(
  nodes: Node[],
  edges: Edge[],
  rootId: string | null,
  collapsedNodeIds: Set<string>,
) {
  if (!rootId) {
    return { nodes: [], edges: [] };
  }

  const childIdsByParent = buildKnowledgeChildMap(nodes);
  const visibleIds = new Set<string>();
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visibleIds.has(currentId)) {
      continue;
    }

    visibleIds.add(currentId);
    if (collapsedNodeIds.has(currentId)) {
      continue;
    }

    for (const childId of childIdsByParent.get(currentId) ?? []) {
      queue.push(childId);
    }
  }

  return {
    nodes: nodes.filter((node) => visibleIds.has(node.id)),
    edges: edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}

export function layoutVisibleKnowledgeTree(
  nodes: Node[],
  edges: Edge[],
  rootId: string | null,
  collapsedNodeIds: Set<string>,
) {
  const visibleGraph = getVisibleKnowledgeSubtree(nodes, edges, rootId, collapsedNodeIds);
  if (!rootId || visibleGraph.nodes.length === 0) {
    return visibleGraph;
  }

  const childIdsByParent = buildKnowledgeChildMap(nodes);
  const visibleIds = new Set(visibleGraph.nodes.map((node) => node.id));
  const positions = new Map<string, FlowPosition>();
  const getVisibleChildIds = (nodeId: string) =>
    (childIdsByParent.get(nodeId) ?? []).filter((childId) => visibleIds.has(childId));
  const visibleLeafCount = visibleGraph.nodes.filter((node) => getVisibleChildIds(node.id).length === 0).length;
  const leafSpacing = getLeafSpacing(visibleLeafCount);

  const assignPosition = (nodeId: string, depth: number, yCursor: number): number => {
    const visibleChildIds = getVisibleChildIds(nodeId);

    if (visibleChildIds.length === 0) {
      positions.set(nodeId, {
        x: depth * HORIZONTAL_SPACING,
        y: yCursor,
      });
      return yCursor + leafSpacing;
    }

    let nextY = yCursor;
    visibleChildIds.forEach((childId, index) => {
      nextY = assignPosition(childId, depth + 1, nextY);
      const currentHasChildren = getVisibleChildIds(childId).length > 0;
      const nextChildId = visibleChildIds[index + 1];
      const nextHasChildren = nextChildId ? getVisibleChildIds(nextChildId).length > 0 : false;
      if (index < visibleChildIds.length - 1 && (currentHasChildren || nextHasChildren)) {
        nextY += SUBTREE_GAP;
      }
    });

    const firstChildY = positions.get(visibleChildIds[0])?.y ?? yCursor;
    const lastChildY =
      positions.get(visibleChildIds[visibleChildIds.length - 1])?.y ?? firstChildY;
    positions.set(nodeId, {
      x: depth * HORIZONTAL_SPACING,
      y: (firstChildY + lastChildY) / 2,
    });
    return nextY;
  };

  assignPosition(rootId, 0, 0);

  return {
    nodes: visibleGraph.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
    edges: visibleGraph.edges,
  };
}

export function getAnchoredViewport(
  viewport: ViewportLike,
  anchorBefore: FlowPosition,
  anchorAfter: FlowPosition,
): ViewportLike {
  return {
    x: viewport.x - (anchorAfter.x - anchorBefore.x) * viewport.zoom,
    y: viewport.y - (anchorAfter.y - anchorBefore.y) * viewport.zoom,
    zoom: viewport.zoom,
  };
}

export function toggleKnowledgeNodeCollapse(
  collapsedNodeIds: Set<string>,
  nodeId: string,
): Set<string> {
  const next = new Set(collapsedNodeIds);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
}
