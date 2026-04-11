import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { TreeNode } from "@/components/job-models/tree-node"
import { useEditor } from "./context"
import { useEditorState } from "@/hooks/useEditorState"
import { Plus } from "lucide-react"

interface TreeViewProps {
  model: any
  onNodeNameChange: (nodeId: string, newName: string) => void
  onNodeDelete: (nodeId: string) => void
  onNodeLevelChange?: (nodeId: string, level: string) => void
  onAddNode?: (type: "dimension" | "skill" | "kp", parentId?: string) => void
}

export function TreeView({
  model,
  onNodeNameChange,
  onNodeDelete,
  onNodeLevelChange,
  onAddNode,
}: TreeViewProps) {
  const { setSelectedNodeId, setIsDirty } = useEditor()
  const { expandedNodeIds, nodeMap, toggleExpanded, toggleSelected, expandNode } =
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
            onAddChild={() => { expandNode(dimensionId); onAddNode?.("skill", dimensionId) }}
            isDragHandle
          />
        </div>

        {isExpanded && (
          <>
            {dim.childrenIds.map((skillId) => renderSkill(skillId, depth + 1))}
            {/* Add skill button */}
            {onAddNode && (
              <div style={{ marginLeft: `${(depth + 1) * 24}px` }} className="py-0.5">
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded hover:bg-primary/5 transition-colors"
                  onClick={() => onAddNode("skill", dimensionId)}
                >
                  <Plus className="h-3 w-3" />
                  添加技能
                </button>
              </div>
            )}
          </>
        )}
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
          onSelect={() => handleNodeSelect(skillId)}
          onDelete={() => handleNodeDelete(skillId)}
          onNameChange={(name) => handleNodeNameChange(skillId, name)}
          onLevelChange={(level) => onNodeLevelChange?.(skillId, level)}
            onAddChild={() => { expandNode(skillId); onAddNode?.("kp", skillId) }}
            isDragHandle
          />
        </div>

        {isExpanded && (
          <>
            {skill.childrenIds.map((kpId) =>
              renderKnowledgePoint(kpId, depth + 1)
            )}
            {/* Add knowledge point button */}
            {onAddNode && (
              <div style={{ marginLeft: `${(depth + 1) * 24}px` }} className="py-0.5">
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded hover:bg-primary/5 transition-colors"
                  onClick={() => onAddNode("kp", skillId)}
                >
                  <Plus className="h-3 w-3" />
                  添加知识点
                </button>
              </div>
            )}
          </>
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

  const hasDimensions = model?.dimensions?.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <Input placeholder="搜索节点..." className="h-8" data-testid="tree-search" />
      </div>
      <div className="flex-1 overflow-auto">
        {hasDimensions ? (
          model.dimensions.map((dim: any) => renderDimension(dim.id, 0))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <p className="text-sm text-muted-foreground mb-3">暂无能力维度</p>
            <p className="text-xs text-muted-foreground mb-4">
              从添加一个能力维度开始构建模型
            </p>
          </div>
        )}
      </div>
      {/* Add dimension button - always visible at bottom */}
      {onAddNode && (
        <div className="p-3 border-t">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => onAddNode("dimension")}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            添加能力维度
          </Button>
        </div>
      )}
    </div>
  )
}
