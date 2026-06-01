export interface CourseKnowledgeUploadNode {
  id: string;
  name: string;
  children: CourseKnowledgeUploadNode[];
}

export interface CourseKnowledgeUploadTarget {
  id: string;
  name: string;
  depth: number;
  path: string;
}

export function flattenKnowledgeUploadTargets(
  node: CourseKnowledgeUploadNode | null,
  depth = 0,
  trail: string[] = [],
): CourseKnowledgeUploadTarget[] {
  if (!node) return [];
  const pathParts = [...trail, node.name];
  return [
    {
      id: node.id,
      name: node.name,
      depth,
      path: pathParts.join(" / "),
    },
    ...node.children.flatMap((child) =>
      flattenKnowledgeUploadTargets(child, depth + 1, pathParts),
    ),
  ];
}

export function resolveDefaultKnowledgeUploadTargetId(
  tree: CourseKnowledgeUploadNode | null,
): string {
  return tree?.id ?? "";
}
