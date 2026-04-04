import { useEffect, useRef, useCallback, useState } from "react"
import { useUpdate } from "@refinedev/core"
import { useToast } from "@/hooks/use-toast"

interface SaveParams {
  updates: Record<string, unknown>
  nodeId: string
  resource: string
}

export function useAutoSave(debounceMs: number = 2000) {
  const { mutate: updateNode } = useUpdate()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const pendingChangesRef = useRef<SaveParams | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSave = useCallback(
    (params: SaveParams) => {
      setIsSaving(true)
      updateNode(
        {
          resource: params.resource,
          id: params.nodeId,
          values: params.updates,
        },
        {
          onSuccess: () => {
            setIsSaving(false)
            setLastSavedAt(new Date())
            toast({
              title: "Saved",
              description: "Changes saved successfully",
              duration: 2000,
            })
          },
          onError: (error) => {
            setIsSaving(false)
            toast({
              title: "Save failed",
              description: (error as Error).message || "Unknown error",
              variant: "destructive",
            })
          },
        }
      )
    },
    [updateNode, toast]
  )

  const debouncedSave = useCallback(
    (params: SaveParams) => {
      pendingChangesRef.current = params

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        if (pendingChangesRef.current) {
          doSave(pendingChangesRef.current)
          pendingChangesRef.current = null
        }
      }, debounceMs)
    },
    [debounceMs, doSave]
  )

  const cancelPending = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    pendingChangesRef.current = null
  }, [])

  const forceSave = useCallback(() => {
    if (pendingChangesRef.current) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      const params = pendingChangesRef.current
      pendingChangesRef.current = null
      doSave(params)
    }
  }, [doSave])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return {
    debouncedSave,
    forceSave,
    cancelPending,
    isSaving,
    lastSavedAt,
  }
}
