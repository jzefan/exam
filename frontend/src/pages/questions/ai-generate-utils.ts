type KnowledgeNode = {
  id: string;
  name: string;
  parent_id: string | null;
  direction_id: string | null;
};

type TypeAllocationLike = {
  choice: number;
  true_false: number;
  fill_in: number;
  short_answer: number;
  essay: number;
  code: number;
};

type RecentKnowledgePoint = {
  id: string;
  name: string;
  path: string;
  count: number;
  updated_at: number;
};

type RecentKeyword = {
  keyword: string;
  count: number;
  updated_at: number;
};

export type RecentKnowledgePointState = Record<string, RecentKnowledgePoint>;
export type RecentKeywordState = Record<string, RecentKeyword>;

function includesKeyword(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export function buildKnowledgeTreeVisibility(nodes: KnowledgeNode[], keyword: string) {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return {
      visibleNodeIds: new Set(nodes.map((node) => node.id)),
      autoExpandedNodeIds: new Set<string>(),
    };
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleNodeIds = new Set<string>();
  const autoExpandedNodeIds = new Set<string>();

  for (const node of nodes) {
    if (!includesKeyword(node.name, trimmedKeyword)) continue;
    visibleNodeIds.add(node.id);

    let parentId = node.parent_id;
    while (parentId) {
      visibleNodeIds.add(parentId);
      autoExpandedNodeIds.add(parentId);
      parentId = nodeMap.get(parentId)?.parent_id ?? null;
    }
  }

  return { visibleNodeIds, autoExpandedNodeIds };
}

export function buildRecentKnowledgePointState(
  current: RecentKnowledgePointState,
  items: Array<{ id: string; name: string; path: string }>,
  now = Date.now(),
): RecentKnowledgePointState {
  const next = { ...current };
  for (const item of items) {
    const existing = next[item.id];
    next[item.id] = {
      id: item.id,
      name: item.name,
      path: item.path,
      count: (existing?.count ?? 0) + 1,
      updated_at: now,
    };
  }
  return next;
}

export function buildRecentKeywordState(
  current: RecentKeywordState,
  keyword: string,
  now = Date.now(),
): RecentKeywordState {
  const normalized = keyword.trim();
  if (!normalized) return current;
  const next = { ...current };
  const existing = next[normalized];
  next[normalized] = {
    keyword: normalized,
    count: (existing?.count ?? 0) + 1,
    updated_at: now,
  };
  return next;
}

export function getTopRecentKnowledgePoints(state: RecentKnowledgePointState, limit = 6) {
  return Object.values(state)
    .sort((a, b) => b.count - a.count || b.updated_at - a.updated_at)
    .slice(0, limit);
}

export function getTopRecentKeywords(state: RecentKeywordState, limit = 6) {
  return Object.values(state)
    .sort((a, b) => b.count - a.count || b.updated_at - a.updated_at)
    .slice(0, limit);
}

export function validateTypeAllocation(totalCount: number, typeAlloc: TypeAllocationLike) {
  const allocated = Object.values(typeAlloc).reduce((sum, count) => sum + count, 0);
  const hasCustomAllocation = allocated > 0;
  return {
    allocated,
    hasCustomAllocation,
    isValid: !hasCustomAllocation || allocated === totalCount,
  };
}
