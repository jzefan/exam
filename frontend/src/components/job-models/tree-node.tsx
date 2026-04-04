import { useState } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GripVertical,
  MoreVertical,
  Trash2,
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
  childCount?: number
  depth: number
  isExpanded: boolean
  onToggleExpand: () => void
  onSelect: () => void
  onDelete: () => void
  onNameChange: (newName: string) => void
  onLevelChange?: (level: string) => void
  isDragHandle?: boolean
}

const LEVEL_COLORS: Record<string, string> = {
  L1: "bg-gray-100",
  L2: "bg-blue-100",
  L3: "bg-yellow-100",
  L4: "bg-orange-100",
  L5: "bg-red-100",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  入门: "bg-green-50",
  初级: "bg-blue-50",
  中级: "bg-yellow-50",
  高级: "bg-orange-50",
  困难: "bg-red-50",
}

export function TreeNode({
  id,
  type,
  name,
  level,
  difficulty,
  childCount = 0,
  depth,
  isExpanded,
  onToggleExpand,
  onSelect,
  onDelete,
  onNameChange,
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
    type === "dimension" ? "📂" : type === "skill" ? "🔧" : "📝"

  const levelColor = level ? (LEVEL_COLORS[level] ?? "") : ""
  const difficultyColor = difficulty ? (DIFFICULTY_COLORS[difficulty] ?? "") : ""

  return (
    <div
      className={`border-l-4 ${isSelected ? "border-blue-500 bg-blue-50" : "border-transparent"} pl-2`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1 py-1 px-2 hover:bg-gray-50 rounded">
        {/* Expand toggle */}
        {childCount > 0 ? (
          <button
            className="p-0 hover:bg-gray-200 rounded"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4" />
            ) : (
              <ChevronRightIcon className="w-4 h-4" />
            )}
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Drag handle */}
        {isDragHandle && (
          <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
        )}

        {/* Icon */}
        <span className="text-lg">{icon}</span>

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
            className="flex-1 h-6 text-sm"
          />
        ) : (
          <span
            className="flex-1 text-sm cursor-text"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}
          >
            {name}
          </span>
        )}

        {/* Level badge */}
        {level && (
          <span
            className={`px-2 py-0 rounded text-xs font-medium ${levelColor}`}
            onClick={(e) => e.stopPropagation()}
          >
            {level}
          </span>
        )}

        {/* Difficulty badge */}
        {difficulty && (
          <span
            className={`px-2 py-0 rounded text-xs font-medium ${difficultyColor}`}
            onClick={(e) => e.stopPropagation()}
          >
            {difficulty}
          </span>
        )}

        {/* Child count badge */}
        {childCount > 0 && (
          <span className="text-xs text-gray-500 bg-gray-100 px-1.5 rounded">
            {childCount}
          </span>
        )}

        {/* Context menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="w-6 h-6 p-0">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
