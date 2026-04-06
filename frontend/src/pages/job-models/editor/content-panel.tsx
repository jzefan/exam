import { useState, useEffect, useCallback, useRef } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import {
  Video,
  FileText,
  FileType,
  Presentation,
  Link2,
  Upload,
  Trash2,
  Plus,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { resolveNodeType } from "@/utils/editor-utils"
import { ResourcePreview } from "./resource-preview"
import { VideoSearchDialog } from "./video-search"

interface Resource {
  id: string
  node_id: string
  node_type: string
  resource_type: string
  title: string
  url: string | null
  file_path: string | null
  description: string | null
  source: string | null
  sort_order: number
  created_at: string
}

interface ContentPanelProps {
  nodeId: string | null
  model: any
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

function getResourceIcon(r: Resource): React.ReactNode {
  if (r.resource_type === "video") return <Video className="h-4 w-4 text-red-500" />
  if (r.resource_type === "link") return <Link2 className="h-4 w-4 text-green-500" />
  // Distinguish PDF vs Word docs
  const path = r.file_path || r.url || r.title || ""
  const ext = path.match(/\.([\w]+)$/)?.[1]?.toLowerCase() || ""
  if (ext === "pdf") return <FileText className="h-4 w-4 text-orange-500" />
  if (["doc", "docx"].includes(ext)) return <FileType className="h-4 w-4 text-blue-600" />
  if (["ppt", "pptx"].includes(ext)) return <Presentation className="h-4 w-4 text-amber-600" />
  return <FileText className="h-4 w-4 text-blue-500" />
}

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  video: "视频",
  document: "文档",
  link: "链接",
}

const NODE_TYPE_LABEL: Record<string, string> = {
  dimension: "能力维度",
  skill: "技能",
  kp: "知识点",
}

function findNodeName(model: any, nodeId: string): string | null {
  for (const dim of model.dimensions) {
    if (dim.id === nodeId) return dim.name
    for (const skill of dim.skills) {
      if (skill.id === nodeId) return skill.name
      for (const kp of skill.knowledge_points) {
        if (kp.id === nodeId) return kp.name
      }
    }
  }
  return null
}

export function ContentPanel({ nodeId, model }: ContentPanelProps) {
  const { toast } = useToast()
  const [resources, setResources] = useState<Resource[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add link form state
  const [newTitle, setNewTitle] = useState("")
  const [newUrl, setNewUrl] = useState("")
  const [newType, setNewType] = useState<string>("link")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  // Preview
  const [previewResource, setPreviewResource] = useState<Resource | null>(null)

  // Video search mode
  const [showVideoSearch, setShowVideoSearch] = useState(false)

  const nodeType = nodeId ? resolveNodeType(model, nodeId) : null
  const nodeName = nodeId ? findNodeName(model, nodeId) : null

  const fetchResources = useCallback(async () => {
    if (!nodeId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/job-models/models/nodes/${nodeId}/resources`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setResources(data)
    } catch {
      setResources([])
    } finally {
      setIsLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    setResources([])
    setShowAddForm(false)
    setShowVideoSearch(false)
    fetchResources()
  }, [fetchResources])

  const handleAddLink = async () => {
    if (!nodeId || !nodeType || !newTitle.trim() || !newUrl.trim()) return
    setIsSubmitting(true)
    try {
      const res = await fetch(
        `/api/job-models/models/nodes/${nodeId}/resources?node_type=${nodeType}`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            resource_type: newType,
            title: newTitle.trim(),
            url: newUrl.trim(),
            source: "manual",
          }),
        }
      )
      if (!res.ok) throw new Error(`${res.status}`)
      toast({ title: "已添加" })
      setNewTitle("")
      setNewUrl("")
      setNewType("link")
      setShowAddForm(false)
      await fetchResources()
    } catch (err) {
      toast({ title: "添加失败", description: (err as Error).message, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !nodeId || !nodeType) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("title", file.name)
      formData.append("node_type", nodeType)
      formData.append("description", "")

      const token = localStorage.getItem("access_token")
      const res = await fetch(`/api/job-models/models/nodes/${nodeId}/resources/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error(`${res.status}`)
      toast({ title: "文件已上传" })
      await fetchResources()
    } catch (err) {
      toast({ title: "上传失败", description: (err as Error).message, variant: "destructive" })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDelete = async (resourceId: string) => {
    try {
      const res = await fetch(`/api/job-models/models/resources/${resourceId}`, {
        method: "DELETE",
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      toast({ title: "已删除" })
      await fetchResources()
    } catch (err) {
      toast({ title: "删除失败", description: (err as Error).message, variant: "destructive" })
    }
  }

  if (!nodeId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50/50">
        <p className="text-sm text-muted-foreground">选择一个节点查看学习资料</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-white">
        <div className="flex items-center gap-2">
          {nodeType && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
              {NODE_TYPE_LABEL[nodeType] || nodeType}
            </span>
          )}
          <h3 className="text-sm font-semibold truncate">{nodeName}</h3>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resources" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="resources">学习资料</TabsTrigger>
          <TabsTrigger value="questions" disabled>
            相关题目
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="flex-1 overflow-auto px-4 pb-4 mt-2">
          {/* Actions */}
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              添加链接
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1" />
              )}
              上传文件
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowVideoSearch(true)}
            >
              <Search className="h-3.5 w-3.5 mr-1" />
              搜索视频
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Add link form */}
          {showAddForm && (
            <Card className="mb-3">
              <CardContent className="pt-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">类型</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link">链接</SelectItem>
                      <SelectItem value="video">视频</SelectItem>
                      <SelectItem value="document">文档</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">标题</Label>
                  <Input
                    className="h-8"
                    placeholder="资源标题"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    className="h-8"
                    placeholder="https://..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddLink}
                    disabled={isSubmitting || !newTitle.trim() || !newUrl.trim()}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : null}
                    确认添加
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                    取消
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resource list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              暂无学习资料，点击上方按钮添加
            </div>
          ) : (
            <div className="space-y-2">
              {resources.map((r) => (
                <Card
                  key={r.id}
                  className="group cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setPreviewResource(r)}
                >
                  <CardContent className="py-2.5 px-3 flex items-center gap-3">
                    <div className="shrink-0">
                      {getResourceIcon(r)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      {r.description && (
                        <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {RESOURCE_TYPE_LABEL[r.resource_type] || r.resource_type}
                        </span>
                        {r.source && (
                          <span className="text-xs text-muted-foreground">
                            · {r.source === "manual" ? "手动" : r.source === "upload" ? "上传" : r.source}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {r.url && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); window.open(r.url!, "_blank") }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="questions" className="flex-1 px-4 pb-4">
          <div className="text-center py-8 text-sm text-muted-foreground">即将推出</div>
        </TabsContent>
      </Tabs>

      <ResourcePreview
        resource={previewResource}
        open={!!previewResource}
        onOpenChange={(open) => { if (!open) setPreviewResource(null) }}
      />

      {nodeId && nodeType && nodeName && (
        <VideoSearchDialog
          open={showVideoSearch}
          onOpenChange={setShowVideoSearch}
          nodeId={nodeId}
          nodeType={nodeType}
          nodeName={nodeName}
          onSaved={() => fetchResources()}
        />
      )}
    </div>
  )
}
