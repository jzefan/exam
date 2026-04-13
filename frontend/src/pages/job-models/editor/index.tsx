import { useCallback, useState, useEffect, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { EditorContext, type EditorContextType } from "./context"
import { Toolbar } from "./toolbar"
import { StatusBar } from "./status-bar"
import { TreeView } from "./tree-view"
import { GraphView } from "./graph-view"
import { PropertiesPanel } from "./properties-panel"
import { useToast } from "@/hooks/use-toast"
import { resolveNodeType, buildUpdatePayload } from "@/utils/editor-utils"
import { ContentPanel } from "./content-panel"
import { Toaster } from "@/components/ui/toaster"

interface ModelData {
  id: string
  version_id: string
  job_role: string
  version: number
  version_note: string | null
  is_current: boolean
  source_type: string
  dimensions: Array<{
    id: string
    name: string
    description: string | null
    sort_order: number
    skills: Array<{
      id: string
      name: string
      level: string | null
      description: string | null
      sort_order: number
      knowledge_points: Array<{
        id: string
        name: string
        difficulty: string | null
        teaching_suggestion: string | null
        sort_order: number
      }>
    }>
  }>
}

function getApiEndpoint(nodeType: string, nodeId: string): string {
  const endpoints: Record<string, string> = {
    dimension: `/api/job-models/models/dimensions/${nodeId}`,
    skill: `/api/job-models/models/skills/${nodeId}`,
    kp: `/api/job-models/models/knowledge-points/${nodeId}`,
  }
  return endpoints[nodeType] || ""
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export function EditorPage() {
  const { jobModelId, versionId } = useParams<{ jobModelId: string; versionId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [model, setModel] = useState<ModelData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // Resizable left panel
  const MIN_PANEL_WIDTH = 260
  const MAX_PANEL_WIDTH = 700
  const [leftPanelWidth, setLeftPanelWidth] = useState(420)
  const isResizing = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, ev.clientX))
      setLeftPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [])

  // Fetch model data
  const fetchModel = useCallback(async () => {
    try {
      const res = await fetch(`/api/job-models/models/${jobModelId}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json() as {
        id: string
        job_role: string
        current_version_id?: string | null
        current_version?: {
          id: string
          version: number
          version_note: string | null
          is_current: boolean
          source_type: string
          dimensions: ModelData["dimensions"]
        } | null
      }
      setModel({
        id: data.id,
        version_id: data.current_version?.id ?? data.current_version_id ?? versionId ?? "",
        job_role: data.job_role,
        version: data.current_version?.version ?? 1,
        version_note: data.current_version?.version_note ?? null,
        is_current: data.current_version?.is_current ?? true,
        source_type: data.current_version?.source_type ?? "manual",
        dimensions: data.current_version?.dimensions ?? [],
      })
    } catch (err) {
      console.error("Failed to load model:", err)
      toast({
        title: "加载失败",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [jobModelId, toast, versionId])

  useEffect(() => {
    fetchModel()
  }, [fetchModel])

  const nodeCount = model
    ? model.dimensions.reduce(
        (acc, dim) =>
          acc + 1 + dim.skills.reduce((skAcc, skill) => skAcc + 1 + skill.knowledge_points.length, 0),
        0
      )
    : 0

  // Save a single node update
  const saveNodeUpdate = useCallback(
    async (nodeType: string, nodeId: string, updates: Record<string, unknown>) => {
      const endpoint = getApiEndpoint(nodeType, nodeId)
      if (!endpoint) return

      setIsSaving(true)
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify(updates),
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        setLastSavedAt(new Date())
        setIsDirty(false)
        // Refresh model data to keep tree in sync
        await fetchModel()
      } catch (err) {
        toast({
          title: "保存失败",
          description: (err as Error).message,
          variant: "destructive",
        })
      } finally {
        setIsSaving(false)
      }
    },
    [fetchModel, toast]
  )

  const handleNodeNameChange = useCallback(
    (nodeId: string, newName: string) => {
      if (!model) return
      const nodeType = resolveNodeType(model, nodeId)
      if (!nodeType) return
      setIsDirty(true)
      saveNodeUpdate(nodeType, nodeId, buildUpdatePayload({ name: newName }))
    },
    [model, saveNodeUpdate]
  )

  const handleNodeLevelChange = useCallback(
    (nodeId: string, level: string) => {
      setIsDirty(true)
      saveNodeUpdate("skill", nodeId, buildUpdatePayload({ level }))
    },
    [saveNodeUpdate]
  )

  const handleNodeDelete = useCallback(
    async (nodeId: string) => {
      if (!model) return
      const nodeType = resolveNodeType(model, nodeId)
      if (!nodeType) return

      const endpoint = getApiEndpoint(nodeType, nodeId)
      if (!endpoint) return

      try {
        const res = await fetch(endpoint, {
          method: "DELETE",
          headers: authHeaders(),
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        setSelectedNodeId(null)
        toast({ title: "已删除" })
        await fetchModel()
      } catch (err) {
        toast({
          title: "删除失败",
          description: (err as Error).message,
          variant: "destructive",
        })
      }
    },
    [model, fetchModel, toast]
  )

  const handlePropertiesUpdate = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      if (!model) return
      const nodeType = resolveNodeType(model, nodeId)
      if (!nodeType) return
      setIsDirty(true)
      saveNodeUpdate(nodeType, nodeId, buildUpdatePayload(updates))
    },
    [model, saveNodeUpdate]
  )

  const handleAddNode = useCallback(
    async (type: "dimension" | "skill" | "kp", parentId?: string) => {
      let endpoint = ""
      let body: Record<string, unknown> = {}

      if (type === "dimension") {
        endpoint = `/api/job-models/models/${jobModelId}/dimensions`
        body = { name: "新维度", sort_order: model?.dimensions.length ?? 0 }
      } else if (type === "skill" && parentId) {
        endpoint = `/api/job-models/models/dimensions/${parentId}/skills`
        const dim = model?.dimensions.find((d) => d.id === parentId)
        body = { name: "新技能", sort_order: dim?.skills.length ?? 0 }
      } else if (type === "kp" && parentId) {
        endpoint = `/api/job-models/models/skills/${parentId}/knowledge-points`
        const skill = model?.dimensions.flatMap((d) => d.skills).find((s) => s.id === parentId)
        body = { name: "新知识点", sort_order: skill?.knowledge_points.length ?? 0 }
      }
      if (!endpoint) return

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const created = await res.json()
        await fetchModel()
        setSelectedNodeId(created.id)
        // Scroll the new node into view after render
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-node-id="${created.id}"]`)
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        })
      } catch (err) {
        toast({ title: "创建失败", description: (err as Error).message, variant: "destructive" })
      }
    },
    [jobModelId, model, fetchModel, toast]
  )

  const handleSave = useCallback(async () => {
    // Force save is now handled per-node, just clear dirty flag
    setIsDirty(false)
  }, [])

  const handlePublish = useCallback(async () => {
    if (!jobModelId) return
    try {
      const res = await fetch(`/api/job-models/models/${jobModelId}/publish`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ version_note: "" }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      toast({ title: "已发布", description: "新版本已创建" })
      navigate(`/gwmx/job-models`)
    } catch (err) {
      toast({
        title: "发布失败",
        description: (err as Error).message,
        variant: "destructive",
      })
    }
  }, [jobModelId, navigate, toast])

  const contextValue: EditorContextType = {
    modelId: jobModelId ?? "",
    viewMode,
    setViewMode,
    selectedNodeId,
    setSelectedNodeId,
    isDirty,
    setIsDirty,
    isSaving,
    setIsSaving: () => {},
    lastSavedAt,
    setLastSavedAt: () => {},
    nodeCount,
    setNodeCount: () => {},
    modelVersion: model?.version ?? 1,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-4">加载模型中...</p>
        </div>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-base font-semibold text-foreground">模型未找到</p>
          <p className="text-sm text-muted-foreground mt-2">请返回列表重新选择</p>
          <button
            onClick={() => navigate("/gwmx/job-models")}
            className="mt-4 text-primary hover:underline text-sm"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <EditorContext.Provider value={contextValue}>
      <div className="flex flex-col h-screen bg-white">
        <Toolbar onSave={handleSave} onPublish={handlePublish} />

        <div className="flex flex-1 overflow-hidden">
          {/* Tree view (left panel) - resizable */}
          <div
            className="hidden lg:flex flex-col border-r border-gray-200 bg-white overflow-auto shrink-0"
            style={{ width: leftPanelWidth }}
            data-testid="tree-panel"
          >
            <TreeView
              model={model}
              onNodeNameChange={handleNodeNameChange}
              onNodeDelete={handleNodeDelete}
              onNodeLevelChange={handleNodeLevelChange}
              onAddNode={handleAddNode}
            />
          </div>

          {/* Drag handle */}
          <div
            className="hidden lg:flex w-1 cursor-col-resize items-center justify-center hover:bg-primary/20 active:bg-primary/30 transition-colors group shrink-0"
            onMouseDown={handleMouseDown}
          >
            <div className="w-0.5 h-8 rounded-full bg-gray-300 group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
          </div>

          {/* Middle panel - Content or Graph */}
          {viewMode === "graph" ? (
            <div className="flex-1 min-w-0 flex flex-col bg-gray-50 overflow-hidden" data-testid="graph-panel">
              <GraphView
                model={model}
                onNodeSelect={(nodeId) => {
                  setSelectedNodeId(nodeId)
                }}
              />
            </div>
          ) : (
            <>
              <ContentPanel nodeId={selectedNodeId} model={model} />

              {/* Properties panel (right) */}
              <div className="hidden xl:block shrink-0 overflow-auto">
                <PropertiesPanel
                  nodeId={selectedNodeId}
                  model={model}
                  onNodeUpdate={handlePropertiesUpdate}
                  onNodeDelete={handleNodeDelete}
                />
              </div>
            </>
          )}
        </div>

        <StatusBar />
      </div>
      <Toaster />
    </EditorContext.Provider>
  )
}
