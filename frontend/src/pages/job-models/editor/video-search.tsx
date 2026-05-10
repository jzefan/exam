import { useState, useCallback, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog as PreviewDialog,
  DialogContent as PreviewDialogContent,
} from "@/components/ui/dialog"
import {
  Search,
  Loader2,
  Save,
  Play,
  Eye,
  Check,
  X,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface VideoResult {
  bvid: string
  title: string
  author: string
  play: number
  duration: string
  pic: string
  description: string
}

interface VideoSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeId: string
  nodeType: string
  nodeName: string
  onSaved: () => void
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

function formatPlay(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return String(n)
}

async function getErrorMessage(res: Response): Promise<string> {
  const payload = await res.json().catch(() => null)
  if (payload && typeof payload.detail === "string") {
    return payload.detail
  }
  return `请求失败（${res.status}）`
}

export function VideoSearchDialog({
  open,
  onOpenChange,
  nodeId,
  nodeType,
  nodeName,
  onSaved,
}: VideoSearchDialogProps) {
  const { toast } = useToast()
  const [keyword, setKeyword] = useState("")
  const [results, setResults] = useState<VideoResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [savedBvids, setSavedBvids] = useState<Set<string>>(new Set())
  const [previewBvid, setPreviewBvid] = useState<string | null>(null)

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) return
    setIsSearching(true)
    try {
      const params = new URLSearchParams({ keyword: kw.trim() })
      const res = await fetch(`/api/job-models/models/search-videos?${params}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res))
      const data: VideoResult[] = await res.json()
      setResults(data)
    } catch (err) {
      toast({ title: "搜索失败", description: (err as Error).message, variant: "destructive" })
    } finally {
      setIsSearching(false)
    }
  }, [toast])

  // Auto-search when dialog opens
  useEffect(() => {
    if (open && nodeName) {
      setKeyword(nodeName)
      doSearch(nodeName)
    }
    if (!open) {
      setResults([])
      setSavedBvids(new Set())
      setPreviewBvid(null)
    }
  }, [doSearch, open, nodeName])

  const handleSearch = useCallback(() => {
    doSearch(keyword)
  }, [keyword, doSearch])

  const handleSave = useCallback(async (video: VideoResult) => {
    try {
      const res = await fetch(
        `/api/job-models/models/nodes/${nodeId}/resources?node_type=${nodeType}`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            resource_type: "video",
            title: video.title,
            url: `https://www.bilibili.com/video/${video.bvid}`,
            description: `${video.author} · ${video.duration} · ${formatPlay(video.play)}播放`,
            source: "bilibili",
          }),
        }
      )
      if (!res.ok) throw new Error(await getErrorMessage(res))
      setSavedBvids((prev) => new Set(prev).add(video.bvid))
      toast({ title: "已保存到学习资料" })
      onSaved()
    } catch (err) {
      toast({ title: "保存失败", description: (err as Error).message, variant: "destructive" })
    }
  }, [nodeId, nodeType, onSaved, toast])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[85vw] h-[80vh] flex flex-col p-0 gap-0 [&>button:last-child]:hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center gap-2 shrink-0">
          <DialogHeader className="flex-1 min-w-0 !space-y-0">
            <DialogTitle className="text-base">
              搜索B站视频 — {nodeName}
            </DialogTitle>
          </DialogHeader>
          <DialogClose className="rounded-sm opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </DialogClose>
        </div>

        {/* Search bar */}
        <div className="px-5 py-3 border-b shrink-0 bg-gray-50/50">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); handleSearch() }}
          >
            <Input
              className="h-9 flex-1"
              placeholder="输入关键词搜索B站视频..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={isSearching || !keyword.trim()}>
              {isSearching ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5 mr-1" />
              )}
              搜索
            </Button>
          </form>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {isSearching ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在搜索B站视频...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
              未找到相关视频
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((v) => {
                const isSaved = savedBvids.has(v.bvid)
                return (
                  <Card key={v.bvid} className="overflow-hidden hover:shadow-md transition-shadow">
                    <CardContent className="p-0">
                      <div className="flex gap-3">
                        {/* Thumbnail */}
                        <div className="relative w-[180px] h-[110px] shrink-0 bg-gray-100 rounded-l overflow-hidden">
                          <img
                            src={v.pic ? `/api/job-models/models/bilibili-cover?url=${encodeURIComponent(v.pic)}` : "https://i0.hdslb.com/bfs/archive/default_cover.png"}
                            alt={v.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='110' fill='%23e5e7eb'%3E%3Crect width='180' height='110'/%3E%3Ctext x='90' y='55' text-anchor='middle' dominant-baseline='middle' fill='%239ca3af' font-size='14'%3EB站视频%3C/text%3E%3C/svg%3E" }}
                          />
                          {v.duration && (
                            <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded">
                              {v.duration}
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 py-2.5 pr-3 flex flex-col">
                          <p className="text-sm font-medium line-clamp-2 leading-snug">{v.title}</p>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span className="truncate max-w-[120px]">{v.author}</span>
                            <span className="flex items-center gap-0.5 shrink-0">
                              <Eye className="h-3 w-3" />
                              {formatPlay(v.play)}
                            </span>
                          </div>
                          <div className="flex gap-2 mt-auto pt-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setPreviewBvid(v.bvid)}
                            >
                              <Play className="h-3 w-3 mr-1" />
                              预览
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              variant={isSaved ? "secondary" : "default"}
                              disabled={isSaved}
                              onClick={() => handleSave(v)}
                            >
                              {isSaved ? (
                                <>
                                  <Check className="h-3 w-3 mr-1" />
                                  已保存
                                </>
                              ) : (
                                <>
                                  <Save className="h-3 w-3 mr-1" />
                                  保存
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>

      {/* Video preview sub-dialog */}
      {previewBvid && (
        <PreviewDialog open={!!previewBvid} onOpenChange={(o) => { if (!o) setPreviewBvid(null) }}>
          <PreviewDialogContent className="max-w-3xl w-[80vw] p-0 gap-0 [&>button:last-child]:hidden overflow-hidden">
            <div className="aspect-video w-full">
              <iframe
                src={`//player.bilibili.com/player.html?bvid=${previewBvid}&autoplay=1`}
                className="w-full h-full"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            </div>
          </PreviewDialogContent>
        </PreviewDialog>
      )}
    </Dialog>
  )
}
