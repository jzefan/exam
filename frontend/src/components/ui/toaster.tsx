import { useEffect } from "react"
import { useToastState } from "@/hooks/use-toast"
import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts, subscribe } = useToastState()
  const topToasts = toasts.filter((toast) => toast.position === "top")
  const bottomToasts = toasts.filter((toast) => toast.position !== "top")

  useEffect(() => {
    return subscribe()
  }, [subscribe])

  return (
    <>
      <ToastProvider>
        {topToasts.map((t) => (
          <Toast
            className="data-[state=open]:sm:slide-in-from-top-full"
            key={t.id}
            variant={t.variant}
          >
            <div className="grid gap-1">
              {t.title && <ToastTitle>{t.title}</ToastTitle>}
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
            {t.action}
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport className="top-0 flex-col items-center sm:left-1/2 sm:right-auto sm:top-0 sm:-translate-x-1/2 sm:bottom-auto" />
      </ToastProvider>
      <ToastProvider>
        {bottomToasts.map((t) => (
        <Toast key={t.id} variant={t.variant}>
          <div className="grid gap-1">
            {t.title && <ToastTitle>{t.title}</ToastTitle>}
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          {t.action}
          <ToastClose />
        </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </>
  )
}
