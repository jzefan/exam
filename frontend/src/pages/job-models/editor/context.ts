import { createContext, useContext } from "react"

export interface EditorContextType {
  modelId: string
  viewMode: "tree" | "graph"
  setViewMode: (mode: "tree" | "graph") => void
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  isDirty: boolean
  setIsDirty: (dirty: boolean) => void
  isSaving: boolean
  setIsSaving: (saving: boolean) => void
  lastSavedAt: Date | null
  setLastSavedAt: (date: Date | null) => void
  nodeCount: number
  setNodeCount: (count: number) => void
  modelVersion: number
}

export const EditorContext = createContext<EditorContextType | null>(null)

export function useEditor(): EditorContextType {
  const context = useContext(EditorContext)
  if (!context) {
    throw new Error("useEditor must be used within EditorProvider")
  }
  return context
}
