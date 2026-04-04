import { useMemo, useCallback } from "react"
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GraphNode } from "@/components/job-models/graph-node"
import { useEditor } from "./context"

interface KnowledgePoint {
  id: string
  name: string
  difficulty?: string
}

interface Skill {
  id: string
  name: string
  level?: string
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

export function GraphView({ model, onNodeSelect }: GraphViewProps) {
  const { setSelectedNodeId } = useEditor()

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    const jobRoleId = `job-${model?.id ?? "root"}`
    nodes.push({
      id: jobRoleId,
      data: { label: model?.job_role ?? "Unknown", type: "dimension" },
      position: { x: 400, y: 0 },
      type: "graphNode",
    })

    const dimensions = model?.dimensions ?? []
    const dimensionSpacing = 220
    const dimensionStartX = Math.max(0, 400 - ((dimensions.length - 1) * dimensionSpacing) / 2)

    dimensions.forEach((dim, dimensionIndex) => {
      const dimX = dimensionStartX + dimensionIndex * dimensionSpacing
      const dimY = 150

      nodes.push({
        id: dim.id,
        data: { label: dim.name, type: "dimension", count: dim.skills?.length ?? 0 },
        position: { x: dimX, y: dimY },
        type: "graphNode",
      })

      edges.push({
        id: `${jobRoleId}->${dim.id}`,
        source: jobRoleId,
        target: dim.id,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#999" },
      })

      const skills = dim.skills ?? []
      const skillSpacing = 130
      const skillStartX = dimX - ((skills.length - 1) * skillSpacing) / 2

      skills.forEach((skill, skillIndex) => {
        const skillX = skillStartX + skillIndex * skillSpacing
        const skillY = dimY + 180

        nodes.push({
          id: skill.id,
          data: {
            label: skill.name,
            type: "skill",
            level: skill.level,
            count: skill.knowledge_points?.length ?? 0,
          },
          position: { x: skillX, y: skillY },
          type: "graphNode",
        })

        edges.push({
          id: `${dim.id}->${skill.id}`,
          source: dim.id,
          target: skill.id,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#ccc", strokeDasharray: "5 5" },
        })

        const kps = skill.knowledge_points ?? []
        const kpSpacing = 110
        const kpStartX = skillX - ((kps.length - 1) * kpSpacing) / 2

        kps.forEach((kp, kpIndex) => {
          const kpX = kpStartX + kpIndex * kpSpacing
          const kpY = skillY + 150

          nodes.push({
            id: kp.id,
            data: {
              label: kp.name,
              type: "kp",
              difficulty: kp.difficulty,
            },
            position: { x: kpX, y: kpY },
            type: "graphNode",
          })

          edges.push({
            id: `${skill.id}->${kp.id}`,
            source: skill.id,
            target: kp.id,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#ddd", strokeWidth: 1 },
          })
        })
      })
    })

    return { nodes, edges }
  }, [model])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
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
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  )
}
