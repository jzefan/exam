import { useMemo, useCallback, useState, useEffect, useRef } from "react"
import {
  ReactFlow,
  type Node,
  type Edge,
  type ReactFlowInstance,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionLineType,
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toPng } from "html-to-image"
import { Plus, Pencil, Trash2, Download } from "lucide-react"
import { GraphNode } from "@/components/job-models/graph-node"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useEditor } from "./context"

interface KnowledgePoint {
  id: string
  name: string
  difficulty?: string | null
}

interface Skill {
  id: string
  name: string
  level?: string | null
  knowledge_points?: KnowledgePoint[]
}

interface Dimension {
  id: string
  name: string
  skills?: Skill[]
}

interface ModelData {
  id?: string
  job_role?: string
  dimensions?: Dimension[]
}

interface GraphViewProps {
  model: ModelData | undefined
  onNodeSelect: (nodeId: string) => void
  onAddNode?: (type: "dimension" | "skill" | "kp", parentId?: string) => void
  onDeleteNode?: (nodeId: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
}

type NodeType = "root" | "dimension" | "skill" | "kp"

interface NodeMeta {
  id: string
  type: NodeType
  parentId?: string
  name: string
  hasChildren: boolean
}

const nodeTypes = {
  graphNode: GraphNode,
}

function buildHorizontalLayout(
  model: ModelData | undefined,
  collapsed: Set<string>,
): { nodes: Node[]; edges: Edge[]; meta: Map<string, NodeMeta> } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const meta = new Map<string, NodeMeta>()

  if (!model) return { nodes, edges, meta }

  const COL = [0, 320, 640, 960]
  const ROW_H = 52

  const rootId = `root-${model.id ?? "0"}`
  const dimensions = model.dimensions ?? []
  let leafY = 0

  for (const dim of dimensions) {
    const skills = dim.skills ?? []
    const dimCollapsed = collapsed.has(dim.id)
    const dimLeafStart = leafY

    meta.set(dim.id, {
      id: dim.id,
      type: "dimension",
      parentId: rootId,
      name: dim.name,
      hasChildren: skills.length > 0,
    })

    if (dimCollapsed || skills.length === 0) {
      leafY += ROW_H
    } else {
      for (const skill of skills) {
        const kps = skill.knowledge_points ?? []
        const skillCollapsed = collapsed.has(skill.id)
        const skillLeafStart = leafY

        meta.set(skill.id, {
          id: skill.id,
          type: "skill",
          parentId: dim.id,
          name: skill.name,
          hasChildren: kps.length > 0,
        })

        if (skillCollapsed || kps.length === 0) {
          leafY += ROW_H
        } else {
          for (const kp of kps) {
            meta.set(kp.id, {
              id: kp.id,
              type: "kp",
              parentId: skill.id,
              name: kp.name,
              hasChildren: false,
            })
            nodes.push({
              id: kp.id,
              data: { label: kp.name, type: "kp", difficulty: kp.difficulty },
              position: { x: COL[3], y: leafY },
              type: "graphNode",
            })
            edges.push({
              id: `${skill.id}->${kp.id}`,
              source: skill.id,
              target: kp.id,
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed, color: "#d4d4d8" },
              style: { stroke: "#d4d4d8", strokeWidth: 1.5 },
            })
            leafY += ROW_H
          }
        }

        const skillLeafEnd = leafY - ROW_H
        const skillCenterY = (skillLeafStart + skillLeafEnd) / 2

        nodes.push({
          id: skill.id,
          data: {
            label: skill.name,
            type: "skill",
            level: skill.level,
            count: kps.length,
            collapsed: skillCollapsed,
            hasChildren: kps.length > 0,
          },
          position: { x: COL[2], y: skillCenterY },
          type: "graphNode",
        })
        edges.push({
          id: `${dim.id}->${skill.id}`,
          source: dim.id,
          target: skill.id,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#a8a29e" },
          style: { stroke: "#a8a29e", strokeWidth: 1.5 },
        })
      }
    }

    const dimLeafEnd = leafY - ROW_H
    const dimCenterY = (dimLeafStart + dimLeafEnd) / 2

    nodes.push({
      id: dim.id,
      data: {
        label: dim.name,
        type: "dimension",
        count: skills.length,
        collapsed: dimCollapsed,
        hasChildren: skills.length > 0,
      },
      position: { x: COL[1], y: dimCenterY },
      type: "graphNode",
    })

    edges.push({
      id: `${rootId}->${dim.id}`,
      source: rootId,
      target: dim.id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
      style: { stroke: "#78716c", strokeWidth: 2 },
    })

    leafY += ROW_H * 0.5
  }

  const totalH = Math.max(0, leafY - ROW_H * 0.5 - ROW_H)
  nodes.unshift({
    id: rootId,
    data: { label: model.job_role ?? "岗位", type: "root" },
    position: { x: COL[0], y: totalH / 2 },
    type: "graphNode",
  })
  meta.set(rootId, {
    id: rootId,
    type: "root",
    name: model.job_role ?? "岗位",
    hasChildren: dimensions.length > 0,
  })

  return { nodes, edges, meta }
}

export function GraphView({
  model,
  onNodeSelect,
  onAddNode,
  onDeleteNode,
  onRenameNode,
}: GraphViewProps) {
  const { setSelectedNodeId } = useEditor()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [renameState, setRenameState] = useState<{ id: string; value: string } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [menu])

  const { nodes: initialNodes, edges: initialEdges, meta } = useMemo(
    () => buildHorizontalLayout(model, collapsed),
    [model, collapsed],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const rfRef = useRef<ReactFlowInstance | null>(null)

  const toggleCollapse = useCallback(
    (id: string) => {
      const oldY = nodes.find((n) => n.id === id)?.position.y ?? 0
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        const rebuilt = buildHorizontalLayout(model, next)
        const newY = rebuilt.nodes.find((n) => n.id === id)?.position.y ?? oldY
        const dy = newY - oldY
        if (dy !== 0 && rfRef.current) {
          const vp = rfRef.current.getViewport()
          rfRef.current.setViewport({ x: vp.x, y: vp.y - dy * vp.zoom, zoom: vp.zoom })
        }
        return next
      })
    },
    [model, nodes],
  )

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("root-")) return
      const target = event.target as HTMLElement
      if (target.closest("[data-graph-toggle]")) {
        toggleCollapse(node.id)
        return
      }
      onNodeSelect(node.id)
      setSelectedNodeId(node.id)
    },
    [onNodeSelect, setSelectedNodeId, toggleCollapse],
  )

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id.startsWith("root-")) return
      if (!onRenameNode) return
      const info = meta.get(node.id)
      if (!info) return
      setRenameState({ id: node.id, value: info.name })
    },
    [meta, onRenameNode],
  )

  const deleteInfo = deleteId ? meta.get(deleteId) : undefined

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
    },
    [],
  )

  const [isExporting, setIsExporting] = useState(false)

  const handleExport = useCallback(async () => {
    const viewportEl = document.querySelector(".react-flow__viewport") as HTMLElement | null
    if (!viewportEl || nodes.length === 0) return
    setIsExporting(true)
    try {
      const bounds = getNodesBounds(nodes)
      const padding = 40
      const width = bounds.width + padding * 2
      const height = bounds.height + padding * 2
      const transform = getViewportForBounds(bounds, width, height, 0.5, 2, padding)
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background")
      const dataUrl = await toPng(viewportEl, {
        backgroundColor: bg.trim() ? `hsl(${bg})` : "#ffffff",
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        },
        pixelRatio: 2,
        filter: (node) => {
          const cls = (node as HTMLElement)?.classList
          if (!cls) return true
          return !cls.contains("react-flow__minimap") && !cls.contains("react-flow__controls")
        },
      })
      const link = document.createElement("a")
      const role = model?.job_role ?? "job-model"
      link.download = `${role}-graph-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error("Export failed:", err)
    } finally {
      setIsExporting(false)
    }
  }, [nodes, model])

  const menuInfo = menu ? meta.get(menu.nodeId) : undefined
  const childTypeOf: Record<NodeType, "dimension" | "skill" | "kp" | null> = {
    root: "dimension",
    dimension: "skill",
    skill: "kp",
    kp: null,
  }
  const childLabel: Record<string, string> = {
    dimension: "添加能力维度",
    skill: "添加技能",
    kp: "添加知识点",
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-3 top-3 z-10">
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || nodes.length === 0}
          className="h-8 gap-1.5 bg-background/95 shadow-sm backdrop-blur"
        >
          <Download className="h-3.5 w-3.5" />
          {isExporting ? "导出中..." : "导出图片"}
        </Button>
      </div>
      <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={handleContextMenu}
            onInit={(inst) => {
              rfRef.current = inst
            }}
            nodeTypes={nodeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1, minZoom: 0.6 }}
            defaultViewport={{ x: 40, y: 40, zoom: 0.85 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e4e4e7" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {menu && menuInfo && (
        <div
          role="menu"
          className="fixed z-50 min-w-[10rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuInfo.type !== "kp" && childTypeOf[menuInfo.type] && onAddNode && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const childType = childTypeOf[menuInfo.type]
                if (!childType) return
                const parentId = menuInfo.type === "root" ? undefined : menuInfo.id
                onAddNode(childType, parentId)
                setMenu(null)
              }}
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              {childLabel[childTypeOf[menuInfo.type] as string]}
            </button>
          )}
          {onRenameNode && menuInfo.type !== "root" && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setRenameState({ id: menuInfo.id, value: menuInfo.name })
                setMenu(null)
              }}
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              重命名
            </button>
          )}
          {onDeleteNode && menuInfo.type !== "root" && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDeleteId(menuInfo.id)
                  setMenu(null)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </>
          )}
        </div>
      )}

      <Dialog
        open={renameState !== null}
        onOpenChange={(open) => !open && setRenameState(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名节点</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameState?.value ?? ""}
            onChange={(e) =>
              setRenameState((s) => (s ? { ...s, value: e.target.value } : s))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const s = renameState
                if (s && s.value.trim() && onRenameNode) {
                  onRenameNode(s.id, s.value.trim())
                }
                setRenameState(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameState(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                const s = renameState
                if (s && s.value.trim() && onRenameNode) {
                  onRenameNode(s.id, s.value.trim())
                }
                setRenameState(null)
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除节点</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除"{deleteInfo?.name}"及其所有子节点？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId && onDeleteNode) onDeleteNode(deleteId)
                setDeleteId(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
