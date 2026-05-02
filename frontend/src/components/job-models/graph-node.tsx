import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Layers, Lightbulb, Target, Zap } from "lucide-react"
import type { ComponentType } from "react"
import { NodeCollapseToggle } from "@/components/graph/node-collapse-toggle"

interface GraphNodeData {
  label: string
  type: "root" | "dimension" | "skill" | "kp"
  level?: string
  difficulty?: string
  count?: number
  collapsed?: boolean
  hasChildren?: boolean
  [key: string]: unknown
}

interface TypeStyle {
  bg: string
  border: string
  text: string
  iconBg: string
  iconColor: string
  Icon: ComponentType<{ className?: string }>
}

const TYPE_CONFIG: Record<string, TypeStyle> = {
  root: {
    bg: "bg-primary",
    border: "border-primary",
    text: "text-primary-foreground",
    iconBg: "bg-white/15",
    iconColor: "text-primary-foreground",
    Icon: Target,
  },
  dimension: {
    bg: "bg-sky-50/80 dark:bg-sky-950/30",
    border: "border-sky-200/70 dark:border-sky-800/60",
    text: "text-sky-900 dark:text-sky-200",
    iconBg: "bg-sky-100 dark:bg-sky-900/60",
    iconColor: "text-sky-600 dark:text-sky-300",
    Icon: Layers,
  },
  skill: {
    bg: "bg-amber-50/80 dark:bg-amber-950/30",
    border: "border-amber-200/70 dark:border-amber-800/60",
    text: "text-amber-900 dark:text-amber-200",
    iconBg: "bg-amber-100 dark:bg-amber-900/60",
    iconColor: "text-amber-600 dark:text-amber-300",
    Icon: Zap,
  },
  kp: {
    bg: "bg-violet-50/70 dark:bg-violet-950/30",
    border: "border-violet-200/60 dark:border-violet-800/60",
    text: "text-violet-900 dark:text-violet-200",
    iconBg: "bg-violet-100 dark:bg-violet-900/60",
    iconColor: "text-violet-600 dark:text-violet-300",
    Icon: Lightbulb,
  },
}

const LEVEL_BADGE: Record<string, string> = {
  L1: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  L2: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
  L3: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  L4: "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300",
  L5: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
}

export function GraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData
  const config = TYPE_CONFIG[d.type] ?? TYPE_CONFIG.kp
  const isRoot = d.type === "root"
  const Icon = config.Icon

  const rightBadge =
    d.type === "kp" && d.difficulty ? (
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300">
        {d.difficulty}
      </span>
    ) : d.type === "skill" && d.level ? (
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
          LEVEL_BADGE[d.level] ?? "bg-gray-100 text-gray-600"
        }`}
      >
        {d.level}
      </span>
    ) : d.count !== undefined && d.count > 0 ? (
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
          isRoot ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {d.count}
      </span>
    ) : null

  return (
    <div
      className={`relative rounded-xl border ${config.border} ${config.bg} shadow-sm backdrop-blur-[1px] hover:shadow-md hover:-translate-y-[1px] transition-all`}
      style={{
        minWidth: isRoot ? 180 : 170,
        maxWidth: 240,
      }}
    >
      {d.hasChildren && !isRoot && (
        <NodeCollapseToggle collapsed={Boolean(d.collapsed)} count={d.count} />
      )}

      {!isRoot && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-300 !w-2 !h-2 !border-0"
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${config.iconBg}`}
        >
          <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
        </span>
        <span className={`flex-1 truncate text-xs font-semibold ${config.text}`}>{d.label}</span>
        {rightBadge}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-300 !w-2 !h-2 !border-0"
      />
    </div>
  )
}
