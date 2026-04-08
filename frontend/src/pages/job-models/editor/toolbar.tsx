import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, LayoutList, Network, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

interface ToolbarProps {
  onSave: () => Promise<void>
  onPublish: () => Promise<void>
}

export function Toolbar({ onSave, onPublish }: ToolbarProps) {
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
          disabled={!isDirty || isSaving}
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
              disabled={isDirty}
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
