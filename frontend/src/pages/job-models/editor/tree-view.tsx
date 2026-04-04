import { Input } from "@/components/ui/input"
import { TreeNode } from "@/components/job-models/tree-node"
import { useEditor } from "./context"
import { useEditorState } from "@/hooks/useEditorState"

interface TreeViewProps {
  model: any
  onNodeNameChange: (nodeId: string, newName: string) => void
  onNodeDelete: (nodeId: string) => void
  onNodeLevelChange?: (nodeId: string, level: string) => void
}

export function TreeView({
  model,
  onNodeNameChange,
  onNodeDelete,
  onNodeLevelChange,
}: TreeViewProps) {
  const { setSelectedNodeId, setIsDirty } = useEditor()
  const { expandedNodeIds, nodeMap, toggleExpanded, toggleSelected } =
    useEditorState(model)

  const handleNodeSelect = (nodeId: string, multiSelect = false) => {
    toggleSelected(nodeId, multiSelect)
    setSelectedNodeId(nodeId)
  }

  const handleNodeNameChange = (nodeId: string, newName: string) => {
    onNodeNameChange(nodeId, newName)
    setIsDirty(true)
  }

  const handleNodeDelete = (nodeId: string) => {
    onNodeDelete(nodeId)
    setIsDirty(true)
    setSelectedNodeId(null)
  }

  const renderDimension = (dimensionId: string, depth: number) => {
    const dim = nodeMap.get(dimensionId)
    if (!dim) return null

    const isExpanded = expandedNodeIds.has(dimensionId)
    const skillCount = dim.childrenIds.length

    return (
      <div key={dimensionId}>
        <div style={{ marginLeft: `${depth * 24}px` }}>
          <TreeNode
            id={dimensionId}
            type="dimension"
            name={dim.name}
            depth={depth}
            isExpanded={isExpanded}
            childCount={skillCount}
            onToggleExpand={() => toggleExpanded(dimensionId)}
            onSelect={() => handleNodeSelect(dimensionId)}
            onDelete={() => handleNodeDelete(dimensionId)}
            onNameChange={(name) => handleNodeNameChange(dimensionId, name)}
            isDragHandle
          />
        </div>

        {isExpanded &&
          dim.childrenIds.map((skillId) => renderSkill(skillId, depth + 1))}
      </div>
    )
  }

  const renderSkill = (skillId: string, depth: number) => {
    const skill = nodeMap.get(skillId)
    if (!skill) return null

    const isExpanded = expandedNodeIds.has(skillId)
    const kpCount = skill.childrenIds.length

    return (
      <div key={skillId}>
        <div style={{ marginLeft: `${depth * 24}px` }}>
          <TreeNode
            id={skillId}
            type="skill"
            name={skill.name}
            level={skill.level}
            depth={depth}
            isExpanded={isExpanded}
            childCount={kpCount}
            onToggleExpand={() => toggleExpanded(skillId)}
            onSelect={(e) =>
              handleNodeSelect(skillId, (e as any).ctrlKey || (e as any).metaKey)
            }
            onDelete={() => handleNodeDelete(skillId)}
            onNameChange={(name) => handleNodeNameChange(skillId, name)}
            onLevelChange={(level) => onNodeLevelChange?.(skillId, level)}
            isDragHandle
          />
        </div>

        {isExpanded &&
          skill.childrenIds.map((kpId) =>
            renderKnowledgePoint(kpId, depth + 1)
          )}
      </div>
    )
  }

  const renderKnowledgePoint = (kpId: string, depth: number) => {
    const kp = nodeMap.get(kpId)
    if (!kp) return null

    return (
      <div key={kpId} style={{ marginLeft: `${depth * 24}px` }}>
        <TreeNode
          id={kpId}
          type="kp"
          name={kp.name}
          difficulty={kp.difficulty}
          depth={depth}
          isExpanded={false}
          onToggleExpand={() => {}}
          onSelect={() => handleNodeSelect(kpId)}
          onDelete={() => handleNodeDelete(kpId)}
          onNameChange={(name) => handleNodeNameChange(kpId, name)}
          isDragHandle
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <Input placeholder="Search nodes..." className="h-8" />
      </div>
      <div className="flex-1 overflow-auto">
        {model?.dimensions?.map((dim: any) => renderDimension(dim.id, 0))}
      </div>
    </div>
  )
}
