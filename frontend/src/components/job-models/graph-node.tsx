import { Handle, Position, type NodeProps } from "@xyflow/react"

interface GraphNodeData {
  label: string
  type: "dimension" | "skill" | "kp"
  level?: string
  difficulty?: string
  count?: number
  [key: string]: unknown
}

const LEVEL_COLORS: Record<string, string> = {
  L1: "#e5e7eb",
  L2: "#dbeafe",
  L3: "#fef3c7",
  L4: "#fed7aa",
  L5: "#fecaca",
}

const TYPE_COLORS: Record<string, string> = {
  dimension: "#f0f9ff",
  skill: "#fffbeb",
  kp: "#f5f3ff",
}

const ICON_MAP: Record<string, string> = {
  dimension: "📂",
  skill: "🔧",
  kp: "📝",
}

export function GraphNode({ data }: NodeProps) {
  const nodeData = data as GraphNodeData
  const bgColor = nodeData.level
    ? (LEVEL_COLORS[nodeData.level] ?? TYPE_COLORS[nodeData.type])
    : TYPE_COLORS[nodeData.type]

  const width =
    nodeData.type === "dimension" ? 140 : nodeData.type === "skill" ? 120 : 100

  return (
    <div
      className="rounded-lg border-2 border-gray-300 bg-white p-3 shadow-md"
      style={{
        backgroundColor: bgColor,
        width: `${width}px`,
        minHeight: "60px",
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="flex flex-col items-center text-center">
        <div className="mb-1 text-xl">{ICON_MAP[nodeData.type]}</div>
        <div className="w-full truncate text-xs font-medium">{nodeData.label}</div>

        {nodeData.level && (
          <div className="mt-1 text-xs font-bold text-gray-700">{nodeData.level}</div>
        )}

        {nodeData.difficulty && (
          <div className="mt-0.5 text-xs text-gray-600">{nodeData.difficulty}</div>
        )}

        {nodeData.count !== undefined && nodeData.count > 0 && (
          <div className="mt-1 rounded bg-gray-200 px-1.5 text-xs">{nodeData.count}</div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
