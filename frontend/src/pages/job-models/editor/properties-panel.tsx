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
      <div className="w-80 border-l bg-gray-50 p-4 overflow-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Model Overview</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div>
              <Label className="text-xs text-gray-600">Job Role</Label>
              <div className="font-medium">{model?.job_role}</div>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Version</Label>
              <div className="font-medium">v{modelVersion}</div>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Status</Label>
              <div className="font-medium capitalize">{model?.status || "draft"}</div>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Dimensions</Label>
              <div className="font-medium">{model?.dimensions?.length || 0}</div>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-gray-500 mt-4">Select a node to edit</p>
      </div>
    )
  }

  const { type, data } = nodeInfo

  return (
    <div className="w-80 border-l bg-gray-50 p-4 overflow-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm capitalize">{type} Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name field (all types) */}
          <div>
            <Label htmlFor="node-name" className="text-xs">
              Name
            </Label>
            <Input
              id="node-name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* Description field (dimension and skill only) */}
          {(type === "dimension" || type === "skill") && (
            <div>
              <Label htmlFor="node-desc" className="text-xs">
                Description
              </Label>
              <Textarea
                id="node-desc"
                value={editingDesc}
                onChange={(e) => setEditingDesc(e.target.value)}
                className="mt-1 min-h-20 text-xs"
              />
            </div>
          )}

          {/* Level field (skill only) */}
          {type === "skill" && (
            <div>
              <Label htmlFor="skill-level" className="text-xs">
                Proficiency Level
              </Label>
              <Select value={editingLevel} onValueChange={setEditingLevel}>
                <SelectTrigger id="skill-level" className="mt-1">
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
              <Label htmlFor="kp-difficulty" className="text-xs">
                Difficulty
              </Label>
              <Select
                value={editingDifficulty}
                onValueChange={setEditingDifficulty}
              >
                <SelectTrigger id="kp-difficulty" className="mt-1">
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
              <Label htmlFor="teaching-suggestion" className="text-xs">
                Teaching Suggestion
              </Label>
              <Textarea
                id="teaching-suggestion"
                value={teachingSuggestion}
                onChange={(e) => setTeachingSuggestion(e.target.value)}
                placeholder="E.g., 'Use interactive labs and coding assignments'"
                className="mt-1 min-h-16 text-xs"
              />
            </div>
          )}

          {/* Metadata (read-only) */}
          {type === "skill" && data.knowledge_points && (
            <div className="bg-blue-50 p-2 rounded text-xs">
              <div className="font-medium">
                Knowledge Points: {data.knowledge_points.length}
              </div>
            </div>
          )}

          {type === "dimension" && data.skills && (
            <div className="bg-blue-50 p-2 rounded text-xs">
              <div className="font-medium">Skills: {data.skills.length}</div>
            </div>
          )}

          {/* Save and Delete buttons */}
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSave} className="flex-1">
              Save
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDelete}
              className="flex-1"
            >
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
