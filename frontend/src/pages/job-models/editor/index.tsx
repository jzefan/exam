import { useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useShow, useUpdate } from "@refinedev/core"
import { Loader2 } from "lucide-react"
import { EditorContext, type EditorContextType } from "./context"
import { Toolbar } from "./toolbar"
import { StatusBar } from "./status-bar"
import { TreeView } from "./tree-view"
import { GraphView } from "./graph-view"
import { PropertiesPanel } from "./properties-panel"
import { useAutoSave } from "@/hooks/useAutoSave"
import { useToast } from "@/hooks/use-toast"
import { getEndpointForNodeType, resolveNodeType, buildUpdatePayload } from "@/utils/editor-utils"
import { useState } from "react"
import { Toaster } from "@/components/ui/toaster"

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
  const { toast } = useToast()

  const { data, isLoading, refetch } = useShow<ModelData>({
    resource: `job-models/projects/${projectId}/models`,
    id: modelId,
  })

  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

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
  const {
    debouncedSave,
    forceSave,
    isSaving,
    lastSavedAt,
  } = useAutoSave(2000)

  const handleNodeNameChange = useCallback(
    (nodeId: string, newName: string) => {
      if (!modelId) return
      const nodeType = resolveNodeType(model, nodeId)
      if (!nodeType) return
      setIsDirty(true)
      debouncedSave({
        nodeId,
        updates: buildUpdatePayload({ name: newName }),
        resource: getEndpointForNodeType(nodeType, modelId, nodeId),
      })
    },
    [model, modelId, debouncedSave]
  )

  const handleNodeLevelChange = useCallback(
    (nodeId: string, level: string) => {
      if (!modelId) return
      setIsDirty(true)
      debouncedSave({
        nodeId,
        updates: buildUpdatePayload({ level }),
        resource: getEndpointForNodeType("skill", modelId, nodeId),
      })
    },
    [modelId, debouncedSave]
  )

  const handleNodeDelete = useCallback(
    (_nodeId: string) => {
      setIsDirty(true)
      // DELETE call will be wired in a future task
    },
    []
  )

  const handlePropertiesUpdate = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      if (!modelId) return
      const nodeType = resolveNodeType(model, nodeId)
      if (!nodeType) return
      setIsDirty(true)
      debouncedSave({
        nodeId,
        updates: buildUpdatePayload(updates),
        resource: getEndpointForNodeType(nodeType, modelId, nodeId),
      })
    },
    [model, modelId, debouncedSave]
  )

  const handleSave = useCallback(async () => {
    forceSave()
    setIsDirty(false)
  }, [forceSave])

  const handlePublish = useCallback(async () => {
    if (!modelId) return

    if (isDirty) {
      forceSave()
    }

    await new Promise<void>((resolve, reject) => {
      updateModel(
        {
          resource: `job-models/models/${modelId}/publish`,
          id: modelId,
          values: { version_note: "" },
        },
        {
          onSuccess: () => {
            toast({ title: "Published", description: "New version created" })
            refetch()
            navigate(`/job-models/${projectId}`)
            resolve()
          },
          onError: (error) => {
            toast({
              title: "Publish failed",
              description: (error as Error).message || "Unknown error",
              variant: "destructive",
            })
            reject(error)
          },
        }
      )
    })
  }, [modelId, projectId, isDirty, forceSave, updateModel, refetch, navigate, toast])

  const contextValue: EditorContextType = {
    modelId: modelId ?? "",
    viewMode,
    setViewMode,
    selectedNodeId,
    setSelectedNodeId,
    isDirty,
    setIsDirty,
    isSaving,
    setIsSaving: () => {}, // controlled by useAutoSave
    lastSavedAt,
    setLastSavedAt: () => {}, // controlled by useAutoSave
    nodeCount,
    setNodeCount: () => {}, // derived from model data
    modelVersion: (model as any)?.version ?? 1,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-sm text-gray-600 mt-4">Loading model...</p>
        </div>
      </div>
    )
  }

  return (
    <EditorContext.Provider value={contextValue}>
      <div className="flex flex-col h-screen bg-white">
        <Toolbar onSave={handleSave} onPublish={handlePublish} />

        <div className="flex flex-1 overflow-hidden gap-0">
          {/* Tree view (left panel) - hidden on mobile, shown on lg+ */}
          <div className="hidden lg:flex flex-col w-2/5 border-r border-gray-200 bg-white overflow-auto">
            <TreeView
              model={model}
              onNodeNameChange={handleNodeNameChange}
              onNodeDelete={handleNodeDelete}
              onNodeLevelChange={handleNodeLevelChange}
            />
          </div>

          {/* Right panel - full width on mobile, 3/5 on desktop */}
          <div className="w-full lg:w-3/5 flex flex-col bg-gray-50 overflow-hidden">
            {viewMode === "graph" ? (
              <GraphView
                model={model as any}
                onNodeSelect={(nodeId) => {
                  setSelectedNodeId(nodeId)
                }}
              />
            ) : (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex flex-1 items-center justify-center p-4 text-gray-400 text-sm">
                  Select a node from the tree or switch to Graph View
                </div>
                <PropertiesPanel
                  nodeId={selectedNodeId}
                  model={model}
                  onNodeUpdate={handlePropertiesUpdate}
                  onNodeDelete={handleNodeDelete}
                />
              </div>
            )}
          </div>
        </div>

        <StatusBar />
      </div>
      <Toaster />
    </EditorContext.Provider>
  )
}
