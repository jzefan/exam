import { useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useShow, useUpdate } from "@refinedev/core"
import { Loader2 } from "lucide-react"
import { EditorContext, type EditorContextType } from "./context"
import { Toolbar } from "./toolbar"
import { StatusBar } from "./status-bar"
import { TreeView } from "./tree-view"
import { GraphView } from "./graph-view"
import { PropertiesPanel } from "./properties-panel"

interface ModelDimension {
  skills: Array<{
    knowledge_points: unknown[]
  }>
}

interface ModelData {
  version: number
  dimensions: ModelDimension[]
}

export function EditorPage() {
  const { projectId, modelId } = useParams<{ projectId: string; modelId: string }>()
  const navigate = useNavigate()

  const { data, isLoading, refetch } = useShow<ModelData>({
    resource: `job-models/projects/${projectId}/models`,
    id: modelId,
  })

  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const model = data?.data

  const nodeCount = model
    ? model.dimensions.reduce(
        (acc: number, dim: ModelDimension) =>
          acc +
          1 +
          dim.skills.reduce(
            (skAcc: number, skill) => skAcc + 1 + skill.knowledge_points.length,
            0
          ),
        0
      )
    : 0

  const { mutate: updateModel } = useUpdate()

  const handleSave = useCallback(async () => {
    if (!model || !isDirty) return
    setIsSaving(true)
    try {
      // Placeholder: full save logic wired in Task 6
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      setLastSavedAt(new Date())
      setIsDirty(false)
    } catch (error) {
      // logging handled by caller; re-throw to surface errors
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [model, isDirty])

  const handlePublish = useCallback(async () => {
    if (!modelId) return
    await new Promise<void>((resolve, reject) => {
      updateModel(
        {
          resource: `job-models/models/${modelId}/publish`,
          id: modelId,
          values: { version_note: "" },
        },
        {
          onSuccess: () => {
            refetch()
            navigate(`/job-models/${projectId}`)
            resolve()
          },
          onError: reject,
        }
      )
    })
  }, [modelId, projectId, updateModel, refetch, navigate])

  const contextValue: EditorContextType = {
    modelId: modelId ?? "",
    viewMode,
    setViewMode,
    selectedNodeId,
    setSelectedNodeId,
    isDirty,
    setIsDirty,
    isSaving,
    setIsSaving,
    lastSavedAt,
    setLastSavedAt,
    nodeCount,
    setNodeCount: () => {}, // derived from model data
    modelVersion: model?.version ?? 1,
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <EditorContext.Provider value={contextValue}>
      <div className="flex h-screen flex-col bg-white">
        <Toolbar onSave={handleSave} onPublish={handlePublish} />

        <div className="flex flex-1 overflow-hidden">
          {/* Tree view */}
          <div className="w-2/5 overflow-auto border-r">
            <TreeView
              model={model}
              onNodeNameChange={(_nodeId, _newName) => {
                setIsDirty(true)
              }}
              onNodeDelete={(_nodeId) => {
                setIsDirty(true)
              }}
            />
          </div>

          {/* Right side: graph view or properties panel */}
          <div className="flex flex-1 overflow-hidden">
            {viewMode === "graph" ? (
              <GraphView
                model={model as any}
                onNodeSelect={(nodeId) => {
                  setSelectedNodeId(nodeId)
                }}
              />
            ) : (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex flex-1 items-center justify-center p-4 text-gray-400">
                  Switch to Graph View to visualize the model hierarchy
                </div>
                <PropertiesPanel
                  nodeId={selectedNodeId}
                  model={model}
                  onNodeUpdate={(_nodeId, _updates) => {
                    setIsDirty(true)
                  }}
                  onNodeDelete={(_nodeId) => {
                    setIsDirty(true)
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <StatusBar />
      </div>
    </EditorContext.Provider>
  )
}
