import { useMemo, useCallback } from "react"
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionLineType,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GraphNode } from "@/components/job-models/graph-node"
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
}

const nodeTypes = {
  graphNode: GraphNode,
}

/**
 * Horizontal tree layout: Root → Dimensions → Skills → Knowledge Points
 * Uses a bottom-up approach: measure leaf counts to position parents at center.
 */
function buildHorizontalLayout(model: ModelData | undefined) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  if (!model) return { nodes, edges }

  const COL = [0, 300, 580, 860] // x positions for each depth level
  const ROW_H = 52 // vertical spacing between leaf nodes

  const dimensions = model.dimensions ?? []

  // First pass: count total leaves to calculate full height
  let totalLeaves = 0
  for (const dim of dimensions) {
    for (const skill of dim.skills ?? []) {
      totalLeaves += Math.max(1, (skill.knowledge_points ?? []).length)
    }
    // If dimension has no skills, it's still one row
    if ((dim.skills ?? []).length === 0) totalLeaves += 1
  }

  // Second pass: place nodes bottom-up
  let leafY = 0

  for (const dim of dimensions) {
    const skills = dim.skills ?? []
    const dimLeafStart = leafY

    if (skills.length === 0) {
      leafY += ROW_H
    }

    for (const skill of skills) {
      const kps = skill.knowledge_points ?? []
      const skillLeafStart = leafY

      if (kps.length === 0) {
        leafY += ROW_H
      }

      for (let ki = 0; ki < kps.length; ki++) {
        const kp = kps[ki]
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

      // Place skill at vertical center of its KPs
      const skillLeafEnd = leafY - ROW_H
      const skillCenterY = (skillLeafStart + skillLeafEnd) / 2

      nodes.push({
        id: skill.id,
        data: {
          label: skill.name,
          type: "skill",
          level: skill.level,
          count: kps.length,
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

    // Place dimension at vertical center of its skills
    const dimLeafEnd = leafY - ROW_H
    const dimCenterY = (dimLeafStart + dimLeafEnd) / 2

    nodes.push({
      id: dim.id,
      data: { label: dim.name, type: "dimension", count: skills.length },
      position: { x: COL[1], y: dimCenterY },
      type: "graphNode",
    })

    const rootId = `root-${model.id ?? "0"}`
    edges.push({
      id: `${rootId}->${dim.id}`,
      source: rootId,
      target: dim.id,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
      style: { stroke: "#78716c", strokeWidth: 2 },
    })

    // Add gap between dimension groups
    leafY += ROW_H * 0.6
  }

  // Place root at vertical center of everything
  const totalH = leafY - ROW_H * 0.6 - ROW_H
  const rootId = `root-${model.id ?? "0"}`
  nodes.unshift({
    id: rootId,
    data: { label: model.job_role ?? "岗位", type: "root" },
    position: { x: COL[0], y: totalH / 2 },
    type: "graphNode",
  })

  return { nodes, edges }
}

export function GraphView({ model, onNodeSelect }: GraphViewProps) {
  const { setSelectedNodeId } = useEditor()

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildHorizontalLayout(model),
    [model]
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Don't select the root node
      if (node.id.startsWith("root-")) return
      onNodeSelect(node.id)
      setSelectedNodeId(node.id)
    },
    [onNodeSelect, setSelectedNodeId]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1, minZoom: 0.6 }}
      defaultViewport={{ x: 40, y: 40, zoom: 0.85 }}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e5e5" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
