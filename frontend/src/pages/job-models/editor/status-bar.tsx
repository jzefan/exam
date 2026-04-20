import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useEditor } from "./context"

interface SourceBreakdown {
  standard: number
  enterprise_added: number
  manual: number
}

interface StatusBarProps {
  sourceBreakdown?: SourceBreakdown | null
}

export function StatusBar({ sourceBreakdown }: StatusBarProps = {}) {
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
      {sourceBreakdown && (
        <div className="flex gap-4 items-center text-xs" data-testid="source-breakdown">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-gray-500">标准库</span>
            <span className="font-semibold text-gray-900">{sourceBreakdown.standard}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-gray-500">JD 新增</span>
            <span className="font-semibold text-gray-900">{sourceBreakdown.enterprise_added}</span>
          </span>
          {sourceBreakdown.manual > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              <span className="text-gray-500">手工新增</span>
              <span className="font-semibold text-gray-900">{sourceBreakdown.manual}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
