import { useState, useEffect, useRef, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Download, ExternalLink, Maximize, Minimize, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Resource {
  id: string
  resource_type: string
  title: string
  url: string | null
  file_path: string | null
  source: string | null
}

interface ResourcePreviewProps {
  resource: Resource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getFileExt(resource: Resource): string {
  const path = resource.file_path || resource.url || ""
  const match = path.match(/\.(\w+)(?:\?.*)?$/)
  return match ? match[1].toLowerCase() : ""
}

function getBilibiliEmbedUrl(url: string): string | null {
  const bvMatch = url.match(/bilibili\.com\/video\/(BV[\w]+)/)
  if (bvMatch) {
    return `//player.bilibili.com/player.html?bvid=${bvMatch[1]}&autoplay=0`
  }
  return null
}

function getYoutubeEmbedUrl(url: string): string | null {
  const match =
    url.match(/youtube\.com\/watch\?v=([\w-]+)/) ||
    url.match(/youtu\.be\/([\w-]+)/)
  if (match) {
    return `https://www.youtube.com/embed/${match[1]}`
  }
  return null
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return {
    Authorization: `Bearer ${token}`,
  }
}

/** Fullscreen toggle button */
function FullscreenToggle({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const toggle = useCallback(() => {
    if (!containerRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current.requestFullscreen()
    }
  }, [containerRef])

  return (
    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggle} title={isFullscreen ? "退出全屏" : "全屏"}>
      {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
    </Button>
  )
}

function VideoPreview({ resource }: { resource: Resource }) {
  const url = resource.url || ""

  const bilibiliEmbed = getBilibiliEmbedUrl(url)
  if (bilibiliEmbed) {
    return (
      <iframe
        src={bilibiliEmbed}
        className="w-full h-full rounded"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    )
  }

  const youtubeEmbed = getYoutubeEmbedUrl(url)
  if (youtubeEmbed) {
    return (
      <iframe
        src={youtubeEmbed}
        className="w-full h-full rounded"
        allowFullScreen
      />
    )
  }

  const videoExts = ["mp4", "webm", "mov", "avi", "mkv"]
  const ext = getFileExt(resource)
  if (videoExts.includes(ext) || resource.resource_type === "video") {
    return (
      <video controls className="w-full h-full rounded bg-black" src={url}>
        <source src={url} />
        <p>
          您的浏览器不支持该视频格式。
          <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">下载视频</a>
        </p>
      </video>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-muted-foreground text-sm">无法内嵌预览此视频链接</p>
      <Button variant="outline" onClick={() => window.open(url, "_blank")}>
        <ExternalLink className="h-4 w-4 mr-2" />
        在新标签页打开
      </Button>
    </div>
  )
}

function PdfPreview({ url }: { url: string }) {
  return <iframe src={url} className="w-full h-full rounded" title="PDF Preview" />
}

/**
 * Unified document preview for .doc/.docx/.ppt/.pptx
 * Server-side converts to HTML via textutil, rendered in iframe to preserve all styles/tables.
 */
function DocumentPreview({ resourceId, downloadUrl }: { resourceId: string; downloadUrl: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/job-models/models/resources/${resourceId}/preview-html`,
          { headers: authHeaders() }
        )
        if (!res.ok) throw new Error(`${res.status}`)
        const html = await res.text()
        // Wrap in a full HTML document with better default styling
        const fullHtml = html.includes("<html") ? html : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;padding:24px;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style></head><body>${html}</body></html>`
        const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" })
        if (!cancelled) setBlobUrl(URL.createObjectURL(blob))
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    }
  }, [resourceId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">转换文档中...</span>
      </div>
    )
  }

  if (error || !blobUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-destructive">文档转换失败</p>
        <Button variant="outline" size="sm" onClick={() => window.open(downloadUrl, "_blank")}>
          <Download className="h-4 w-4 mr-1" />
          下载文件
        </Button>
      </div>
    )
  }

  return <iframe src={blobUrl} className="w-full h-full rounded bg-white" title="Document Preview" />
}

function FallbackPreview({ resource }: { resource: Resource }) {
  const url = resource.url || ""
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-muted-foreground text-sm">该文件格式暂不支持在线预览</p>
      {url && (
        <Button variant="outline" onClick={() => window.open(url, "_blank")}>
          <Download className="h-4 w-4 mr-2" />
          下载文件
        </Button>
      )}
    </div>
  )
}

export function ResourcePreview({ resource, open, onOpenChange }: ResourcePreviewProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  if (!resource) return null

  const url = resource.url || ""
  const ext = getFileExt(resource)

  // All previewable content supports fullscreen
  const supportsFullscreen = true

  function renderContent() {
    if (ext === "pdf") return <PdfPreview url={url} />
    if (["doc", "docx", "ppt", "pptx"].includes(ext)) {
      return <DocumentPreview resourceId={resource!.id} downloadUrl={url} />
    }

    if (
      resource!.resource_type === "video" ||
      ["mp4", "webm", "mov", "avi", "mkv"].includes(ext)
    ) {
      return <VideoPreview resource={resource!} />
    }

    if (url && (getBilibiliEmbedUrl(url) || getYoutubeEmbedUrl(url))) {
      return <VideoPreview resource={resource!} />
    }

    if (resource!.resource_type === "link" && url) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <Button onClick={() => window.open(url, "_blank")}>
            <ExternalLink className="h-4 w-4 mr-2" />
            在新标签页打开链接
          </Button>
        </div>
      )
    }

    return <FallbackPreview resource={resource!} />
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] h-[80vh] flex flex-col p-0 gap-0 [&>button:last-child]:hidden">
        <div className="px-4 py-3 border-b shrink-0 flex items-center">
          <DialogHeader className="flex-1 min-w-0 !space-y-0">
            <DialogTitle className="text-base truncate">{resource.title}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-[8px] shrink-0">
            {supportsFullscreen && <FullscreenToggle containerRef={contentRef} />}
            <DialogClose className="rounded-sm opacity-70 hover:opacity-100 focus:outline-none">
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        </div>
        <div ref={contentRef} className="flex-1 overflow-hidden p-1 bg-white">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
