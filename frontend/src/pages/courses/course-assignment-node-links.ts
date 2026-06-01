export type KnowledgeNodeLinkable = {
  id: string;
  name: string;
  children: KnowledgeNodeLinkable[];
};

export type AssignmentLinkable = {
  id: string;
  title: string;
  course_kp_id?: string | null;
  knowledge_points: Array<{ id: string; name: string }>;
};

function collectDescendantIds(node: KnowledgeNodeLinkable): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of collectDescendantIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

function isAssignmentRelatedToNode(
  assignment: AssignmentLinkable,
  nodeIds: Set<string>,
) {
  if (assignment.course_kp_id && nodeIds.has(assignment.course_kp_id)) {
    return true;
  }
  return assignment.knowledge_points.some((kp) => nodeIds.has(kp.id));
}

function walkKnowledgeNodes(
  node: KnowledgeNodeLinkable,
  visit: (node: KnowledgeNodeLinkable) => void,
) {
  visit(node);
  for (const child of node.children) {
    walkKnowledgeNodes(child, visit);
  }
}

export function buildAssignmentLinksByNodeId<
  TAssignment extends AssignmentLinkable,
>(
  tree: KnowledgeNodeLinkable | null,
  assignments: TAssignment[],
): Record<string, TAssignment[]> {
  if (!tree) return {};

  const result: Record<string, TAssignment[]> = {};
  walkKnowledgeNodes(tree, (node) => {
    const nodeIds = collectDescendantIds(node);
    const related = assignments.filter((assignment) =>
      isAssignmentRelatedToNode(assignment, nodeIds),
    );
    if (related.length > 0) {
      result[node.id] = related;
    }
  });
  return result;
}

export function filterAssignmentsForKnowledgeNode<
  TAssignment extends AssignmentLinkable,
>(
  tree: KnowledgeNodeLinkable | null,
  assignments: TAssignment[],
  nodeId: string | null,
): TAssignment[] {
  if (!tree || !nodeId) return assignments;

  let matchedNode: KnowledgeNodeLinkable | null = null;
  walkKnowledgeNodes(tree, (node) => {
    if (node.id === nodeId) matchedNode = node;
  });
  if (!matchedNode) return assignments;

  const nodeIds = collectDescendantIds(matchedNode);
  return assignments.filter((assignment) =>
    isAssignmentRelatedToNode(assignment, nodeIds),
  );
}
