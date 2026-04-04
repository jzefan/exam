import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEditor } from "./context"

interface PropertiesPanelProps {
  nodeId: string | null
  model: any
  onNodeUpdate: (nodeId: string, updates: any) => void
  onNodeDelete: (nodeId: string) => void
}

const SKILL_LEVELS = ["L1", "L2", "L3", "L4", "L5"]
const DIFFICULTIES = ["入门", "初级", "中级", "高级", "困难"]

function findNodeInModel(
  model: any,
  nodeId: string
): { type: string; data: any; parent?: any } | null {
  for (const dim of model?.dimensions || []) {
    if (dim.id === nodeId) {
      return { type: "dimension", data: dim }
    }

    for (const skill of dim.skills || []) {
      if (skill.id === nodeId) {
        return { type: "skill", data: skill, parent: dim }
      }

      for (const kp of skill.knowledge_points || []) {
        if (kp.id === nodeId) {
          return { type: "kp", data: kp, parent: skill }
        }
      }
    }
  }

  return null
}

function getLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    L1: "了解",
    L2: "熟悉",
    L3: "掌握",
    L4: "精通",
    L5: "专家",
  }
  return labels[level] || level
}

export function PropertiesPanel({
  nodeId,
  model,
  onNodeUpdate,
  onNodeDelete,
}: PropertiesPanelProps) {
  const { modelVersion } = useEditor()
  const [editingName, setEditingName] = useState("")
  const [editingDesc, setEditingDesc] = useState("")
  const [editingLevel, setEditingLevel] = useState("")
  const [editingDifficulty, setEditingDifficulty] = useState("")
  const [teachingSuggestion, setTeachingSuggestion] = useState("")
  const [lastSyncedNodeId, setLastSyncedNodeId] = useState<string | null>(null)

  const nodeInfo = nodeId ? findNodeInModel(model, nodeId) : null

  // Sync editing state when nodeId changes
  if (nodeId && nodeInfo && nodeId !== lastSyncedNodeId) {
    setLastSyncedNodeId(nodeId)
    setEditingName(nodeInfo.data.name || "")
    setEditingDesc(nodeInfo.data.description || "")
    setEditingLevel(nodeInfo.data.level || "")
    setEditingDifficulty(nodeInfo.data.difficulty || "")
    setTeachingSuggestion(nodeInfo.data.teaching_suggestion || "")
  }

  const handleSave = () => {
    if (!nodeId) return
    const updates: Record<string, string> = { name: editingName }
    if (editingDesc !== undefined) updates.description = editingDesc
    if (editingLevel) updates.level = editingLevel
    if (editingDifficulty) updates.difficulty = editingDifficulty
    if (teachingSuggestion) updates.teaching_suggestion = teachingSuggestion
    onNodeUpdate(nodeId, updates)
  }

  const handleDelete = () => {
    if (nodeId && confirm("Delete this node?")) {
      onNodeDelete(nodeId)
    }
  }

  if (!nodeId || !nodeInfo) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 overflow-auto">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-800">Model Overview</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div>
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Job Role</Label>
              <div className="font-medium text-gray-900 mt-0.5">{model?.job_role}</div>
            </div>
            <div>
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Version</Label>
              <div className="mt-0.5">
                <span className="font-semibold bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-xs">
                  v{modelVersion}
                </span>
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Status</Label>
              <div className="font-medium capitalize text-gray-900 mt-0.5">{model?.status || "draft"}</div>
            </div>
            <div>
              <Label className="text-xs text-gray-500 uppercase tracking-wide">Dimensions</Label>
              <div className="font-medium text-gray-900 mt-0.5">{model?.dimensions?.length || 0}</div>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-gray-500 mt-4 text-center">Select a node to edit its properties</p>
      </div>
    )
  }

  const { type, data } = nodeInfo

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 overflow-auto space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-800 capitalize">{type} Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Name field (all types) */}
          <div>
            <Label htmlFor="node-name" className="text-sm font-semibold text-gray-900">
              Name *
            </Label>
            <Input
              id="node-name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="mt-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              placeholder="Enter node name"
            />
          </div>

          {/* Description field (dimension and skill only) */}
          {(type === "dimension" || type === "skill") && (
            <div>
              <Label htmlFor="node-desc" className="text-sm font-semibold text-gray-900">
                Description
              </Label>
              <Textarea
                id="node-desc"
                value={editingDesc}
                onChange={(e) => setEditingDesc(e.target.value)}
                className="mt-2 min-h-24 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm"
                placeholder="Enter detailed description..."
              />
            </div>
          )}

          {/* Level field (skill only) */}
          {type === "skill" && (
            <div>
              <Label htmlFor="skill-level" className="text-sm font-semibold text-gray-900">
                Proficiency Level
              </Label>
              <Select value={editingLevel} onValueChange={setEditingLevel}>
                <SelectTrigger id="skill-level" className="mt-2 border-gray-300 focus:border-blue-500">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level} - {getLevelLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Difficulty field (knowledge point only) */}
          {type === "kp" && (
            <div>
              <Label htmlFor="kp-difficulty" className="text-sm font-semibold text-gray-900">
                Difficulty
              </Label>
              <Select
                value={editingDifficulty}
                onValueChange={setEditingDifficulty}
              >
                <SelectTrigger id="kp-difficulty" className="mt-2 border-gray-300 focus:border-blue-500">
                  <SelectValue placeholder="Select difficulty" />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((diff) => (
                    <SelectItem key={diff} value={diff}>
                      {diff}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Teaching suggestion (knowledge point only) */}
          {type === "kp" && (
            <div>
              <Label htmlFor="teaching-suggestion" className="text-sm font-semibold text-gray-900">
                Teaching Suggestion
              </Label>
              <Textarea
                id="teaching-suggestion"
                value={teachingSuggestion}
                onChange={(e) => setTeachingSuggestion(e.target.value)}
                placeholder="E.g., 'Use interactive labs and coding assignments'"
                className="mt-2 min-h-20 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm"
              />
            </div>
          )}

          {/* Metadata (read-only) */}
          {type === "skill" && data.knowledge_points && (
            <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-xs">
              <div className="font-semibold text-blue-800">
                Knowledge Points: {data.knowledge_points.length}
              </div>
            </div>
          )}

          {type === "dimension" && data.skills && (
            <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-xs">
              <div className="font-semibold text-blue-800">Skills: {data.skills.length}</div>
            </div>
          )}

          {/* Save and Delete buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <Button
              size="sm"
              onClick={handleSave}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
            >
              Save Changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDelete}
              className="flex-1 border-red-200 text-red-700 hover:bg-red-50 font-medium transition-colors"
            >
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
