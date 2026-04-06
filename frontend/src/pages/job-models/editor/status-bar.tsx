import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useEditor } from "./context"

export function StatusBar() {
  const { nodeCount, modelVersion, lastSavedAt } = useEditor()

  return (
    <div className="border-t border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-2.5 flex items-center justify-between text-sm text-gray-700" data-testid="status-bar">
      <div className="flex gap-6 items-center" data-testid="status-content">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-900">{nodeCount}</span>
          <span className="text-gray-500">个节点</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">版本</span>
          <span className="font-semibold bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-xs" data-testid="version-badge">
            v{modelVersion}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">上次保存：</span>
          <span className="font-medium text-green-700">
            {lastSavedAt
              ? formatDistanceToNow(lastSavedAt, { addSuffix: true, locale: zhCN })
              : "尚未保存"}
          </span>
        </div>
      </div>
    </div>
  )
}
