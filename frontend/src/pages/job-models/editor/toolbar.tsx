import { useState } from "react"
import { LayoutList, Network, Save, Upload } from "lucide-react"
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
          aria-label="Switch to tree view"
          className={viewMode === "tree" ? "shadow-md" : ""}
        >
          <LayoutList className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Tree View</span>
        </Button>
        <Button
          variant={viewMode === "graph" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("graph")}
          aria-label="Switch to graph view"
          className={viewMode === "graph" ? "shadow-md" : ""}
        >
          <Network className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Graph View</span>
        </Button>
      </div>

      {/* Right side: save/publish buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          variant={isDirty && !isSaving ? "default" : "outline"}
          aria-label={isSaving ? "Saving changes" : "Save changes"}
          className={isDirty && !isSaving ? "bg-green-600 hover:bg-green-700 text-white shadow-md" : ""}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {isSaving ? "Saving..." : "Save"}
        </Button>

        <AlertDialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={isDirty}
              aria-label="Publish new version"
              className={!isDirty ? "shadow-md" : ""}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              Publish
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Publish New Version</AlertDialogTitle>
              <AlertDialogDescription>
                This will publish the current model as a new version. Make sure all changes are saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-2">
              <p className="text-sm text-gray-600 mb-1">Version note (optional):</p>
              <Input
                placeholder="E.g., 'Added AI pipeline cleanup'"
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
              />
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handlePublish}>Publish</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
