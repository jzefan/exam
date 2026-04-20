import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, History, LayoutList, Network, Save, Upload } from "lucide-react"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useEditor } from "./context"

interface VersionItem {
  id: string
  version: number
  version_note: string | null
  is_current: boolean
  created_by_name: string | null
  published_at: string | null
  updated_at: string
}

interface ToolbarProps {
  onSave: () => Promise<void>
  onPublish: () => Promise<void>
  versions?: VersionItem[]
  activeVersionId?: string | null
  isHistoricalView?: boolean
  onSwitchVersion?: (versionId: string) => void
}

export function Toolbar({
  onSave,
  onPublish,
  versions = [],
  activeVersionId = null,
  isHistoricalView = false,
  onSwitchVersion,
}: ToolbarProps) {
  const navigate = useNavigate()
  const { viewMode, setViewMode, isDirty, isSaving } = useEditor()
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [versionNote, setVersionNote] = useState("")

  const handlePublish = async () => {
    if (isDirty) {
      await onSave()
    }
    await onPublish()
    setShowPublishDialog(false)
    setVersionNote("")
  }

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white shadow-sm px-6 py-3 sticky top-0 z-10">
      {/* Left side: view toggles */}
      <div className="flex gap-2">
        <Button
          variant={viewMode === "tree" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("tree")}
          aria-label="切换到树形视图"
          className={viewMode === "tree" ? "shadow-md" : ""}
        >
          <LayoutList className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">树形视图</span>
        </Button>
        <Button
          variant={viewMode === "graph" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("graph")}
          aria-label="切换到图形视图"
          className={viewMode === "graph" ? "shadow-md" : ""}
        >
          <Network className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">图形视图</span>
        </Button>
      </div>

      {/* Center: version switcher */}
      {versions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="version-switcher">
              <History className="h-4 w-4" />
              <span>
                v{versions.find((v) => v.id === activeVersionId)?.version ?? "?"}
              </span>
              {isHistoricalView && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  历史 · 只读
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-80 p-0">
            <div className="border-b px-3 py-2 text-xs font-semibold text-foreground">版本历史</div>
            <ul className="max-h-80 overflow-auto py-1">
              {versions.map((v) => {
                const active = v.id === activeVersionId
                const published = v.published_at || v.updated_at
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onSwitchVersion?.(v.id)}
                      className={`w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${
                        active ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">v{v.version}</span>
                        <div className="flex items-center gap-1">
                          {v.is_current && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              当前
                            </span>
                          )}
                          {active && !v.is_current && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              查看中
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {v.created_by_name || "未知"} ·{" "}
                        {published
                          ? format(new Date(published), "yyyy-MM-dd HH:mm", { locale: zhCN })
                          : "—"}
                      </div>
                      {v.version_note && (
                        <div className="mt-0.5 truncate text-foreground/70">{v.version_note}</div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}

      {/* Right side: back + save/publish buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate("/gwmx/job-models")}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回列表
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={!isDirty || isSaving || isHistoricalView}
          variant={isDirty && !isSaving ? "default" : "outline"}
          aria-label={isSaving ? "保存中" : "保存更改"}
          className={isDirty && !isSaving ? "bg-green-600 hover:bg-green-700 text-white shadow-md" : ""}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {isSaving ? "保存中..." : "保存"}
        </Button>

        <AlertDialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={isDirty || isHistoricalView}
              aria-label="发布新版本"
              className={!isDirty ? "shadow-md" : ""}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              发布
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>发布新版本</AlertDialogTitle>
              <AlertDialogDescription>
                将当前模型发布为新版本。请确保所有更改已保存。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-2">
              <p className="text-sm text-gray-600 mb-1">版本备注（可选）：</p>
              <Input
                placeholder="例如：新增 AI 生成的知识点"
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
                data-testid="version-note-input"
              />
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handlePublish}>确认发布</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
