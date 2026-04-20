import { useState } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GripVertical,
  MoreVertical,
  Trash2,
  Plus,
  Pencil,
  Layers,
  Wrench,
  Lightbulb,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useEditor } from "@/pages/job-models/editor/context"

interface TreeNodeProps {
  id: string
  type: "dimension" | "skill" | "kp"
  name: string
  level?: string
  difficulty?: string
  itemSource?: string
  childCount?: number
  depth: number
  isExpanded: boolean
  onToggleExpand: () => void
  onSelect: () => void
  onDelete: () => void
  onNameChange: (newName: string) => void
  onLevelChange?: (level: string) => void
  onAddChild?: () => void
  isDragHandle?: boolean
}

const SOURCE_BADGE: Record<string, { dotClass: string; label: string }> = {
  standard: { dotClass: "bg-primary", label: "标准库" },
  enterprise_added: { dotClass: "bg-amber-500", label: "JD 新增" },
}

const LEVEL_COLORS: Record<string, string> = {
  L1: "bg-gray-400 text-white",
  L2: "bg-blue-500 text-white",
  L3: "bg-yellow-500 text-white",
  L4: "bg-orange-500 text-white",
  L5: "bg-red-500 text-white",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  入门: "bg-green-50 text-green-700",
  初级: "bg-blue-50 text-blue-700",
  中级: "bg-yellow-50 text-yellow-700",
  高级: "bg-orange-50 text-orange-700",
  困难: "bg-red-50 text-red-700",
}

export function TreeNode({
  id,
  type,
  name,
  level,
  difficulty,
  itemSource,
  childCount = 0,
  isExpanded,
  onToggleExpand,
  onSelect,
  onDelete,
  onNameChange,
  onAddChild,
  isDragHandle,
}: TreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const { selectedNodeId } = useEditor()

  const isSelected = selectedNodeId === id

  const handleSaveEdit = () => {
    if (editName.trim()) {
      onNameChange(editName)
    } else {
      setEditName(name)
    }
    setIsEditing(false)
  }

  const icon =
    type === "dimension" ? (
      <Layers className="h-4 w-4 text-indigo-500" />
    ) : type === "skill" ? (
      <Wrench className="h-4 w-4 text-emerald-500" />
    ) : (
      <Lightbulb className="h-4 w-4 text-amber-500" />
    )

  const levelColor = level ? (LEVEL_COLORS[level] ?? "") : ""
  const difficultyColor = difficulty ? (DIFFICULTY_COLORS[difficulty] ?? "") : ""
  const sourceBadge =
    type !== "dimension" && itemSource ? SOURCE_BADGE[itemSource] : undefined

  return (
    <div
      data-node-id={id}
      className={`transition-colors ${
        isSelected
          ? "border-l-4 border-blue-500 bg-blue-50"
          : "border-l-4 border-transparent hover:bg-gray-50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 py-2 px-3 rounded mx-1 cursor-pointer group hover:bg-gray-100 transition-colors">
        {/* Expand toggle with better styling */}
        {childCount > 0 ? (
          <button
            className="p-1 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-gray-600" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-gray-600" />
            )}
          </button>
        ) : (
          <div className="w-6 flex-shrink-0" />
        )}

        {/* Drag handle */}
        {isDragHandle && (
          <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0" />
        )}

        {/* Icon */}
        <span className="flex-shrink-0 flex items-center">{icon}</span>

        {/* Source indicator (standard vs JD-added) */}
        {sourceBadge && (
          <span
            className={`flex-shrink-0 h-2 w-2 rounded-full ${sourceBadge.dotClass}`}
            title={sourceBadge.label}
            aria-label={sourceBadge.label}
          />
        )}

        {/* Name (editable) */}
        {isEditing ? (
          <Input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveEdit()
              if (e.key === "Escape") setIsEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-6 text-sm border-2 border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium text-gray-900 truncate"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}
            title={name}
          >
            {name}
          </span>
        )}

        {/* Level badge */}
        {level && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${levelColor}`}
            onClick={(e) => e.stopPropagation()}
          >
            {level}
          </span>
        )}

        {/* Difficulty badge */}
        {difficulty && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${difficultyColor}`}
            onClick={(e) => e.stopPropagation()}
          >
            {difficulty}
          </span>
        )}

        {/* Child count badge */}
        {childCount > 0 && (
          <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-0.5 rounded flex-shrink-0">
            {childCount}
          </span>
        )}

        {/* Context menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <Button variant="ghost" size="sm" className="w-6 h-6 p-0 hover:bg-gray-300" aria-label="Node options">
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {onAddChild && type !== "kp" && (
              <DropdownMenuItem onClick={onAddChild}>
                <Plus className="w-4 h-4 mr-2" />
                {type === "dimension" ? "添加技能" : "添加知识点"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setIsEditing(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-red-600">
              <Trash2 className="w-4 h-4 mr-2" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
