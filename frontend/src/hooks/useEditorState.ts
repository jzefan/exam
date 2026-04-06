import { useState, useMemo } from "react"

export interface TreeNode {
  id: string
  type: "dimension" | "skill" | "kp"
  name: string
  level?: string
  difficulty?: string
  childrenIds: string[]
}

export function useEditorState(initialModel: any) {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    new Set(initialModel?.dimensions?.map((d: any) => d.id) || [])
  )
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())

  const nodeMap = useMemo(() => {
    const map = new Map<string, TreeNode>()

    initialModel?.dimensions?.forEach((dim: any) => {
      map.set(dim.id, {
        id: dim.id,
        type: "dimension",
        name: dim.name,
        childrenIds: dim.skills?.map((s: any) => s.id) || [],
      })

      dim.skills?.forEach((skill: any) => {
        map.set(skill.id, {
          id: skill.id,
          type: "skill",
          name: skill.name,
          level: skill.level,
          childrenIds: skill.knowledge_points?.map((kp: any) => kp.id) || [],
        })

        skill.knowledge_points?.forEach((kp: any) => {
          map.set(kp.id, {
            id: kp.id,
            type: "kp",
            name: kp.name,
            difficulty: kp.difficulty,
            childrenIds: [],
          })
        })
      })
    })

    return map
  }, [initialModel])

  const toggleExpanded = (nodeId: string) => {
    const newSet = new Set(expandedNodeIds)
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId)
    } else {
      newSet.add(nodeId)
    }
    setExpandedNodeIds(newSet)
  }

  const toggleSelected = (nodeId: string, multiSelect = false) => {
    const newSet = new Set(selectedNodeIds)
    if (multiSelect) {
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId)
      } else {
        newSet.add(nodeId)
      }
    } else {
      newSet.clear()
      newSet.add(nodeId)
    }
    setSelectedNodeIds(newSet)
  }

  const expandNode = (nodeId: string) => {
    setExpandedNodeIds((prev) => new Set(prev).add(nodeId))
  }

  return {
    expandedNodeIds,
    selectedNodeIds,
    nodeMap,
    toggleExpanded,
    toggleSelected,
    expandNode,
  }
}
