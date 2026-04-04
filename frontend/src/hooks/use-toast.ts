import { useState, useCallback } from "react"

type ToastVariant = "default" | "destructive"

interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastState extends ToastOptions {
  id: string
  open: boolean
}

// Simple in-memory toast state (singleton pattern for app-wide toasts)
let toastListeners: Array<(toast: ToastState) => void> = []

function emitToast(toast: ToastState) {
  toastListeners.forEach((listener) => listener(toast))
}

export function useToast() {
  const toast = useCallback((options: ToastOptions) => {
    const id = Math.random().toString(36).slice(2)
    emitToast({ ...options, id, open: true })
  }, [])

  return { toast }
}

export function useToastState() {
  const [toasts, setToasts] = useState<ToastState[]>([])

  const subscribe = useCallback(() => {
    const listener = (t: ToastState) => {
      setToasts((prev) => [...prev, t])
      const duration = t.duration ?? 3000
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== t.id))
      }, duration)
    }
    toastListeners.push(listener)
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener)
    }
  }, [])

  return { toasts, subscribe }
}
