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
    <div className="flex items-center justify-between border-b bg-white px-4 py-3">
      <div className="flex gap-2">
        <Button
          variant={viewMode === "tree" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("tree")}
        >
          <LayoutList className="mr-1 h-4 w-4" />
          Tree View
        </Button>
        <Button
          variant={viewMode === "graph" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("graph")}
        >
          <Network className="mr-1 h-4 w-4" />
          Graph View
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          variant="outline"
        >
          <Save className="mr-1 h-4 w-4" />
          {isSaving ? "Saving..." : "Save"}
        </Button>

        <AlertDialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={isDirty}>
              <Upload className="mr-1 h-4 w-4" />
              Publish
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Publish New Version</AlertDialogTitle>
              <AlertDialogDescription>
                This will publish the current model as a new version. Make sure all changes are saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              placeholder="Version note (optional)"
              value={versionNote}
              onChange={(e) => setVersionNote(e.target.value)}
              className="mt-2"
            />
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
