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
  return token ? { Authorization: `Bearer ${token}` } : {}
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

interface PptxSlidePreview {
  index: number
  textItems: string[]
  images: Array<{ src: string; name: string }>
}

function hasVisibleHtml(html: string) {
  const hasMedia = /<(img|svg|table|canvas|video|iframe)\b/i.test(html)
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim()
  return hasMedia || text.length > 0
}

function getImageMimeType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "png":
      return "image/png"
    case "gif":
      return "image/gif"
    case "bmp":
      return "image/bmp"
    case "webp":
      return "image/webp"
    case "svg":
      return "image/svg+xml"
    default:
      return "image/jpeg"
  }
}

async function bytesToDataURL(bytes: Uint8Array, mimeType: string): Promise<string> {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"))
    reader.readAsDataURL(blob)
  })
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml")
}

function extractSlideTextItems(xml: string) {
  const doc = parseXml(xml)
  const items = Array.from(doc.getElementsByTagName("a:t"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean)
  if (items.length > 0) return items

  return (xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [])
    .map((item) =>
      item
        .replace(/<a:t[^>]*>/, "")
        .replace(/<\/a:t>/, "")
        .trim(),
    )
    .filter(Boolean)
}

function extractSlideRelationshipIds(xml: string) {
  return Array.from(xml.matchAll(/r:(?:embed|link)="([^"]+)"/g))
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id))
}

function resolvePptxRelationshipTarget(slidePath: string, target: string) {
  const parts = target.startsWith("/")
    ? target.split("/").filter(Boolean)
    : [...slidePath.split("/").slice(0, -1), ...target.split("/")]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      normalized.pop()
    } else {
      normalized.push(part)
    }
  }
  return normalized.join("/")
}

function parseSlideRelationships(slidePath: string, relsXml: string | null) {
  if (!relsXml) return new Map<string, string>()
  const doc = parseXml(relsXml)
  const rels = new Map<string, string>()
  Array.from(doc.getElementsByTagName("Relationship")).forEach((node) => {
    const id = node.getAttribute("Id")
    const type = node.getAttribute("Type") ?? ""
    const target = node.getAttribute("Target")
    if (id && target && type.includes("/image")) {
      rels.set(id, resolvePptxRelationshipTarget(slidePath, target))
    }
  })
  return rels
}

async function loadPptxSlides(url: string): Promise<PptxSlidePreview[]> {
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) {
    throw new Error(`文件下载失败（${response.status}）`)
  }

  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(await response.arrayBuffer())
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)/i)?.[1] ?? 0)
      const numB = Number(b.match(/slide(\d+)/i)?.[1] ?? 0)
      return numA - numB
    })

  if (slideFiles.length === 0) {
    throw new Error("未读取到幻灯片内容")
  }

  const slides: PptxSlidePreview[] = []
  for (let index = 0; index < slideFiles.length; index += 1) {
    const slidePath = slideFiles[index]
    const slideFile = slidePath ? zip.file(slidePath) : null
    if (!slidePath || !slideFile) continue
    const xml = await slideFile.async("string")
    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"
    const relsXml = (await zip.file(relsPath)?.async("string")) ?? null
    const imageRels = parseSlideRelationships(slidePath, relsXml)
    const imageIds = Array.from(new Set(extractSlideRelationshipIds(xml)))
    const images: PptxSlidePreview["images"] = []

    for (const imageId of imageIds) {
      const imagePath = imageRels.get(imageId)
      const imageFile = imagePath ? zip.file(imagePath) : null
      if (!imagePath || !imageFile) continue
      const bytes = await imageFile.async("uint8array")
      images.push({
        name: imagePath.split("/").pop() ?? imagePath,
        src: await bytesToDataURL(bytes, getImageMimeType(imagePath)),
      })
    }

    slides.push({
      index: index + 1,
      textItems: extractSlideTextItems(xml),
      images,
    })
  }

  return slides
}

function PptxPreview({ url }: { url: string }) {
  const [slides, setSlides] = useState<PptxSlidePreview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const nextSlides = await loadPptxSlides(url)
        if (!cancelled) setSlides(nextSlides)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">正在解析 PPTX...</span>
      </div>
    )
  }

  if (error || slides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-destructive">PPTX 预览失败{error ? `：${error}` : ""}</p>
        <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")}>
          <Download className="h-4 w-4 mr-1" />
          下载文件
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/30 px-5 py-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {slides.map((slide) => (
          <section
            key={slide.index}
            className="overflow-hidden rounded-xl border border-border bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
              <h3 className="font-sans text-sm font-semibold lining-nums tabular-nums text-foreground">
                第 {slide.index} 页
              </h3>
              <span className="text-xs text-muted-foreground">PPTX 文本预览</span>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-h-[160px] rounded-lg border border-dashed border-border bg-background px-4 py-3">
                {slide.textItems.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {slide.textItems.map((item, index) => (
                      <p key={`${slide.index}-${index}`} className="text-sm leading-relaxed text-foreground">
                        {item}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">此页没有可读取的文本。</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {slide.images.length > 0 ? (
                  slide.images.map((image) => (
                    <img
                      key={image.name}
                      src={image.src}
                      alt={image.name}
                      className="max-h-40 rounded-md border border-border object-contain"
                    />
                  ))
                ) : (
                  <div className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    无嵌入图片
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * Unified document preview for .doc/.docx
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
        if (!hasVisibleHtml(html)) {
          throw new Error("转换结果为空")
        }
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
        <p className="text-sm text-destructive">文档转换失败{error ? `：${error}` : ""}</p>
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
    if (ext === "pptx") return <PptxPreview url={url} />
    if (["doc", "docx"].includes(ext)) {
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
