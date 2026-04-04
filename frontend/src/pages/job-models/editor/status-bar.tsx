import { formatDistanceToNow } from "date-fns"
import { useEditor } from "./context"

export function StatusBar() {
  const { nodeCount, modelVersion, lastSavedAt } = useEditor()

  return (
    <div className="border-t border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-2.5 flex items-center justify-between text-sm text-gray-700">
      <div className="flex gap-6 items-center">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-900">{nodeCount}</span>
          <span className="text-gray-500">nodes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Version</span>
          <span className="font-semibold bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-xs">
            v{modelVersion}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Last saved:</span>
          <span className="font-medium text-green-700">
            {lastSavedAt ? formatDistanceToNow(lastSavedAt, { addSuffix: true }) : "Never"}
          </span>
        </div>
      </div>
    </div>
  )
}
