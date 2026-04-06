import { Handle, Position, type NodeProps } from "@xyflow/react"

interface GraphNodeData {
  label: string
  type: "root" | "dimension" | "skill" | "kp"
  level?: string
  difficulty?: string
  count?: number
  [key: string]: unknown
}

const TYPE_CONFIG: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  root: {
    bg: "bg-primary",
    border: "border-primary",
    text: "text-primary-foreground",
    icon: "🎯",
  },
  dimension: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    icon: "📐",
  },
  skill: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    icon: "⚡",
  },
  kp: {
    bg: "bg-violet-50",
    border: "border-violet-200",
    text: "text-violet-800",
    icon: "💡",
  },
}

const LEVEL_BADGE: Record<string, string> = {
  L1: "bg-gray-100 text-gray-600",
  L2: "bg-blue-100 text-blue-700",
  L3: "bg-amber-100 text-amber-700",
  L4: "bg-orange-100 text-orange-700",
  L5: "bg-red-100 text-red-700",
}

export function GraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData
  const config = TYPE_CONFIG[d.type] ?? TYPE_CONFIG.kp
  const isRoot = d.type === "root"

  return (
    <div
      className={`rounded-[var(--radius)] border ${config.border} ${config.bg} shadow-sm hover:shadow-md transition-shadow`}
      style={{ minWidth: isRoot ? 160 : d.type === "kp" ? 130 : 150, maxWidth: 200 }}
    >
      {!isRoot && (
        <Handle type="target" position={Position.Left} className="!bg-gray-300 !w-2 !h-2 !border-0" />
      )}

      <div className="px-3 py-2">
        {/* KP nodes: icon + name + difficulty all in one line */}
        {d.type === "kp" ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs shrink-0">{config.icon}</span>
            <span className={`text-xs font-semibold ${config.text} truncate`}>
              {d.label}
            </span>
            {d.difficulty && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-violet-100 text-violet-600 font-medium shrink-0 ml-auto">
                {d.difficulty}
              </span>
            )}
          </div>
        ) : (
          <>
            {/* Header: icon + label */}
            <div className="flex items-center gap-1.5">
              {!isRoot && <span className="text-sm shrink-0">{config.icon}</span>}
              <span className={`text-xs font-bold leading-tight ${config.text} line-clamp-2`}>
                {d.label}
              </span>
            </div>

            {/* Badges row for non-KP */}
            {(d.level || (d.count !== undefined && d.count > 0)) && (
              <div className="flex items-center gap-1.5 mt-1.5">
                {d.level && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${LEVEL_BADGE[d.level] ?? "bg-gray-100 text-gray-600"}`}>
                    {d.level}
                  </span>
                )}
                {d.count !== undefined && d.count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${isRoot ? "bg-white/20 text-primary-foreground" : "bg-gray-100 text-gray-500"}`}>
                    {d.count} 项
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-gray-300 !w-2 !h-2 !border-0" />
    </div>
  )
}
