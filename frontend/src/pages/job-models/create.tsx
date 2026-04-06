import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ArrowLeft, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"

const SENIORITY_LEVELS = ["L1", "L2", "L3", "L4", "L5"]
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
    projectName: "",
    projectDescription: "",
    industry: "科技",
    jobRole: "",
    versionNote: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Step 1: Create project
      const projRes = await fetch("/api/job-models/projects", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: formData.projectName,
          description: formData.projectDescription || null,
          industry: formData.industry,
        }),
      })
      if (!projRes.ok) {
        const err = await projRes.json().catch(() => ({}))
        throw new Error(err.detail || `创建项目失败 (${projRes.status})`)
      }
      const project = await projRes.json()

      // Step 2: Create model under the project
      const modelRes = await fetch(`/api/job-models/projects/${project.id}/models`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          job_role: formData.jobRole,
          version_note: formData.versionNote || null,
          source_type: "manual",
        }),
      })
      if (!modelRes.ok) {
        const err = await modelRes.json().catch(() => ({}))
        throw new Error(err.detail || `创建模型失败 (${modelRes.status})`)
      }
      const model = await modelRes.json()

      toast({ title: "创建成功", description: "正在跳转到编辑页面..." })
      navigate(`/job-models/${project.id}/models/${model.id}/editor`)
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
    <div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>创建职位能力模型</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/job-models")}
              className="flex-shrink-0"
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Project Section */}
            <div className="space-y-4 pb-6 border-b">
              <h3 className="font-semibold text-gray-900">项目信息</h3>

              <div>
                <Label htmlFor="projectName" className="text-sm font-medium">
                  项目名称 *
                </Label>
                <Input
                  id="projectName"
                  placeholder="例如：2024年技术部门招聘"
                  value={formData.projectName}
                  onChange={(e) =>
                    setFormData({ ...formData, projectName: e.target.value })
                  }
                  required
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="projectDescription" className="text-sm font-medium">
                  项目描述
                </Label>
                <Textarea
                  id="projectDescription"
                  placeholder="项目的背景和目标..."
                  value={formData.projectDescription}
                  onChange={(e) =>
                    setFormData({ ...formData, projectDescription: e.target.value })
                  }
                  className="mt-2 min-h-24"
                />
              </div>

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
                onClick={() => navigate("/job-models")}
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
