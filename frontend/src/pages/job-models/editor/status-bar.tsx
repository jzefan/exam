import { formatDistanceToNow } from "date-fns"
import { useEditor } from "./context"

export function StatusBar() {
  const { nodeCount, modelVersion, lastSavedAt } = useEditor()

  return (
    <div className="border-t bg-gray-50 px-4 py-2 flex items-center justify-between text-sm text-gray-600">
      <div className="flex gap-6">
        <span>{nodeCount} nodes</span>
        <span>v{modelVersion}</span>
        {lastSavedAt && (
          <span>Last saved: {formatDistanceToNow(lastSavedAt, { addSuffix: true })}</span>
        )}
      </div>
    </div>
  )
}
