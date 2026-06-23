import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { PageIntroHeader } from "@/components/ui/page-intro-header"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"

const INDUSTRIES = [
  "科技",
  "金融",
  "医疗",
  "制造",
  "教育",
  "零售",
  "政府",
  "其他",
]

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export function JobModelCreate() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)

  const [formData, setFormData] = useState({
    industry: "科技",
    jobRole: "",
    versionNote: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const modelRes = await fetch("/api/job-models/models", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          job_role: formData.jobRole,
          version_note: formData.versionNote || null,
          source_type: "manual",
          model_type: "standard",
          status: "draft",
          industry_name: formData.industry,
          dimensions: [],
        }),
      })
      if (!modelRes.ok) {
        const err = await modelRes.json().catch(() => ({}))
        throw new Error(err.detail || `创建模型失败 (${modelRes.status})`)
      }
      const model = await modelRes.json()
      if (!model.current_version_id) {
        throw new Error("模型创建成功，但没有返回当前版本")
      }

      toast({ title: "创建成功", description: "正在跳转到编辑页面..." })
      navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
    } catch (err) {
      toast({
        title: "创建失败",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title="创建标准岗位模型"
        description="标准创建模式 · 直接创建岗位模型与初始版本"
        onBack={() => navigate("/gwmx/job-models")}
        backLabel="返回岗位列表"
      />
      <Card>
        <CardHeader></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4 pb-6 border-b">
              <h3 className="font-semibold text-gray-900">岗位模型信息</h3>
              <div>
                <Label htmlFor="industry" className="text-sm font-medium">
                  行业 *
                </Label>
                <Select
                  value={formData.industry}
                  onValueChange={(value) =>
                    setFormData({ ...formData, industry: value })
                  }
                >
                  <SelectTrigger id="industry" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind} value={ind}>
                        {ind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Job Role Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900">职位信息</h3>

              <div>
                <Label htmlFor="jobRole" className="text-sm font-medium">
                  职位名称 *
                </Label>
                <Input
                  id="jobRole"
                  placeholder="例如：高级后端工程师"
                  value={formData.jobRole}
                  onChange={(e) =>
                    setFormData({ ...formData, jobRole: e.target.value })
                  }
                  required
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="versionNote" className="text-sm font-medium">
                  版本备注
                </Label>
                <Textarea
                  id="versionNote"
                  placeholder="初始版本说明（可选）..."
                  value={formData.versionNote}
                  onChange={(e) =>
                    setFormData({ ...formData, versionNote: e.target.value })
                  }
                  className="mt-2 min-h-20"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/gwmx/job-models")}
                disabled={isLoading}
              >
                取消
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "创建中..." : "创建并编辑"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Toaster />
    </div>
  )
}
