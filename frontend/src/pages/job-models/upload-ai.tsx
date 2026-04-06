import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error"

export function JobModelUploadAI() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [projectName, setProjectName] = useState("")
  const [status, setStatus] = useState<UploadStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [generatedModelId, setGeneratedModelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      // Check file type
      const validTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/png",
        "image/jpeg",
      ]

      if (!validTypes.includes(selectedFile.type)) {
        setError("仅支持 PDF、Word、PNG、JPEG 格式")
        return
      }

      // Check file size (max 10MB)
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError("文件大小不能超过 10MB")
        return
      }

      setFile(selectedFile)
      setError(null)
    }
  }

  const handleUpload = async () => {
    if (!file || !projectName.trim()) {
      setError("请选择文件并输入项目名称")
      return
    }

    try {
      setStatus("uploading")
      setError(null)

      // Upload file
      const formData = new FormData()
      formData.append("file", file)
      formData.append("project_name", projectName)

      const token = localStorage.getItem("access_token")
      const uploadResponse = await fetch("/api/ai-pipeline/documents/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error("上传失败")
      }

      const uploadData = await uploadResponse.json()
      const documentId = uploadData.document_id || uploadData.id

      // Poll for progress
      setStatus("processing")
      setProgress(0)

      const maxAttempts = 120 // 2 minutes max
      let attempts = 0

      const pollProgress = async () => {
        while (attempts < maxAttempts) {
          attempts++

          const progressResponse = await fetch(
            `/api/ai-pipeline/documents/${documentId}/progress`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          )

          if (!progressResponse.ok) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            continue
          }

          const progressData = await progressResponse.json()
          setProgress(progressData.progress || 0)

          if (progressData.status === "completed") {
            setStatus("success")
            setGeneratedModelId(progressData.model_id)
            toast({
              title: "成功",
              description: "职位模型已生成，跳转到编辑器...",
            })

            // Auto-navigate to editor after 2 seconds
            setTimeout(() => {
              navigate(
                `/job-models/test-project/models/${progressData.model_id}/editor`
              )
            }, 2000)
            return
          }

          if (progressData.status === "failed") {
            setStatus("error")
            setError(progressData.error || "处理失败")
            return
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        setStatus("error")
        setError("处理超时，请稍后重试")
      }

      pollProgress()
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "发生错误")
      toast({
        title: "错误",
        description: error,
        variant: "destructive",
      })
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case "uploading":
        return "上传文件中..."
      case "processing":
        return `处理中... ${progress}%`
      case "success":
        return "✓ 处理完成！"
      case "error":
        return "✗ 处理失败"
      default:
        return null
    }
  }

  const isProcessing = status === "uploading" || status === "processing"
  const hasError = status === "error"
  const isSuccess = status === "success"

  return (
    <div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle>AI 生成职位模型</CardTitle>
              <p className="text-sm text-gray-600 mt-2">
                上传职位描述文档（PDF、Word、图片），AI 将自动分析并生成能力模型
              </p>
            </div>
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
            {isSuccess ? (
              <div className="space-y-4 text-center py-8">
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                <h3 className="text-base font-semibold text-gray-900">
                  职位模型生成成功！
                </h3>
                <p className="text-gray-600">
                  即将跳转到编辑器，您可以进一步调整和完善模型...
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Project Name */}
                <div>
                  <Label htmlFor="projectName" className="text-sm font-medium">
                    项目名称 *
                  </Label>
                  <Input
                    id="projectName"
                    placeholder="e.g., 2024年技术岗位能力模型"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    disabled={isProcessing}
                    className="mt-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    用于组织和管理生成的模型
                  </p>
                </div>

                {/* File Upload */}
                <div>
                  <Label htmlFor="file" className="text-sm font-medium">
                    上传文档 *
                  </Label>
                  <div
                    className={`mt-2 border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      file
                        ? "border-green-300 bg-green-50"
                        : "border-gray-300 hover:border-gray-400"
                    } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      id="file"
                      type="file"
                      onChange={handleFileSelect}
                      disabled={isProcessing}
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                      className="hidden"
                    />

                    {file ? (
                      <div className="space-y-2">
                        <CheckCircle className="h-8 w-8 text-green-500 mx-auto" />
                        <p className="font-medium text-gray-900">{file.name}</p>
                        <p className="text-sm text-gray-500">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {!isProcessing && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setFile(null)
                              setError(null)
                            }}
                            className="mt-2"
                          >
                            更换文件
                          </Button>
                        )}
                      </div>
                    ) : (
                      <label
                        htmlFor="file"
                        className={isProcessing ? "" : "cursor-pointer"}
                      >
                        <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="font-medium text-gray-900">
                          点击或拖拽上传文件
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          支持 PDF、Word、PNG、JPEG (最大 10MB)
                        </p>
                      </label>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {isProcessing && (
                  <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-center text-sm text-gray-600">
                      {getStatusMessage()}
                    </p>
                  </div>
                )}

                {/* Error Message */}
                {hasError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                    <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-900">处理失败</p>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                  </div>
                )}

                {/* Info Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>💡 提示：</strong>
                    上传的文档应包含职位的详细描述、职责、要求和所需技能等信息。AI
                    将分析文档内容，自动生成职位能力模型，包括能力维度、技能和知识点。
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate("/job-models")}
                    disabled={isProcessing}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleUpload}
                    disabled={!file || !projectName.trim() || isProcessing}
                  >
                    {isProcessing && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isProcessing ? "处理中..." : "上传并生成模型"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  )
}
