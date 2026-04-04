export type NodeType = "dimension" | "skill" | "kp"

export function getEndpointForNodeType(
  nodeType: NodeType,
  modelId: string,
  nodeId: string
): string {
  const endpoints: Record<NodeType, string> = {
    dimension: `job-models/models/${modelId}/dimensions`,
    skill: `job-models/models/${modelId}/skills`,
    kp: `job-models/models/${modelId}/knowledge-points`,
  }
  return endpoints[nodeType]
}

export function resolveNodeType(
  model: any,
  nodeId: string
): NodeType | null {
  for (const dim of model?.dimensions || []) {
    if (dim.id === nodeId) return "dimension"
    for (const skill of dim.skills || []) {
      if (skill.id === nodeId) return "skill"
      for (const kp of skill.knowledge_points || []) {
        if (kp.id === nodeId) return "kp"
      }
    }
  }
  return null
}

export function buildUpdatePayload(
  updates: Record<string, unknown>
): Record<string, unknown> {
  const allowed = [
    "name",
    "description",
    "level",
    "difficulty",
    "teaching_suggestion",
  ]
  return Object.fromEntries(
    Object.entries(updates).filter(([key]) => allowed.includes(key))
  )
}
