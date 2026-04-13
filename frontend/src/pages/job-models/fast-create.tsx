import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, FileText, LoaderCircle, Sparkles, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { RecommendStandardCard } from "./components/recommend-standard-card"

type RecommendedStandard = {
  id: string
  current_version_id?: string | null
  jobRole: string
  industryName: string
  directionName: string
  jobFamily: string
  rationale: string
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败"
}

function jsonHeaders() {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function JobModelFastCreate() {
  const navigate = useNavigate()
  const [step, setStep] = useState<"upload" | "calibrate">("upload")
  const [jdText, setJdText] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [recommendedStandard, setRecommendedStandard] = useState<RecommendedStandard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleParse = async () => {
    const text = jdText.trim()
    if (!text) {
      setError("请输入岗位描述后再解析")
      return
    }

    setError(null)
    setIsAnalyzing(true)
    try {
      const response = await fetch("/api/job-models/models/recommend-standard", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ job_text: text }),
      })

      if (!response.ok) {
        throw new Error("标准岗位推荐失败")
      }

      const data = (await response.json()) as {
        id: string
        current_version_id?: string | null
        job_role: string
        industry_name?: string
        direction_name?: string
        job_family?: string
        rationale?: string
      }
      setRecommendedStandard({
        id: data.id,
        current_version_id: data.current_version_id,
        jobRole: data.job_role,
        industryName: data.industry_name ?? "待补充",
        directionName: data.direction_name ?? "待补充",
        jobFamily: data.job_family ?? "待补充",
        rationale: data.rationale ?? "系统已根据岗位描述匹配到最接近的标准岗位，请确认后继续。",
      })
      setStep("calibrate")
    } catch (requestError) {
      setError(readErrorMessage(requestError))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleUseStandard = async () => {
    if (!recommendedStandard?.id || isCreating) return

    setError(null)
    setIsCreating(true)
    try {
      const response = await fetch(
        `/api/job-models/models/${recommendedStandard.id}/create-enterprise-copy`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            enterprise_name: `${recommendedStandard.jobRole} 企业版`,
            version_note: "AI 初始生成",
          }),
        },
      )

      if (!response.ok) {
        throw new Error("企业版岗位模型创建失败")
      }

      const created = (await response.json()) as { job_model_id: string; version_id: string }
      navigate(`/gwmx/job-models/${created.job_model_id}/versions/${created.version_id}/editor`)
    } catch (requestError) {
      setError(readErrorMessage(requestError))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f8fc]">
      <header className="shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between px-6 py-2">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => (step === "calibrate" ? setStep("upload") : navigate("/gwmx/job-models"))}
              className="rounded-xl border-slate-200"
            >
              <ArrowLeft className="h-5 w-5 text-slate-600" />
            </Button>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900">
                {step === "upload" ? "企业快速生成" : "单列校准工作台"}
              </h1>
              <p className="text-xs text-slate-500">
              {step === "upload"
                  ? "解析 JD，推荐最接近的标准岗位，再生成企业版岗位模型"
                  : "确认标准岗位后，系统会创建企业版岗位模型并进入详情编辑"}
              </p>
            </div>
          </div>
          {step === "calibrate" ? (
            <Button
              onClick={() => navigate("/gwmx/job-models")}
              className="rounded-full px-4 text-xs font-semibold"
            >
              保存并退出
            </Button>
          ) : null}
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        {step === "upload" ? (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-2">
              <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
                    输入岗位信息
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">上传 JD 或直接粘贴文本</h2>
                  <p className="text-sm leading-6 text-slate-500">
                    系统会先推荐一个最接近的标准岗位，再进入企业版校准。
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  <Label className="text-xs font-medium text-slate-500">岗位描述</Label>
                  <Textarea
                    placeholder="例如：负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计"
                    value={jdText}
                    onChange={(event) => setJdText(event.target.value)}
                    className="min-h-[220px] rounded-[24px] border-slate-200 bg-slate-50 text-sm leading-6"
                  />
                  {error ? <p className="text-xs text-rose-600">{error}</p> : null}
                  <Button
                    type="button"
                    onClick={handleParse}
                    disabled={!jdText.trim() || isAnalyzing}
                    className="h-11 rounded-full px-5 text-sm font-semibold"
                  >
                    {isAnalyzing ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    立即解析文本
                  </Button>
                </div>
              </section>

              <section className="rounded-[32px] border border-dashed border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <Upload className="h-8 w-8" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">上传岗位说明书文件</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    支持 PDF、Word、图片。解析完成后自动推荐标准岗位并进入校准。
                  </p>
                  <div className="mt-8 flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-xs text-slate-500">
                    <FileText className="h-4 w-4" />
                    也可以从 1650 标准库中直接选择
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-6 py-8">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-16">
              {recommendedStandard ? (
                <>
                  <RecommendStandardCard
                    jobRole={recommendedStandard.jobRole}
                    industryName={recommendedStandard.industryName}
                    directionName={recommendedStandard.directionName}
                    jobFamily={recommendedStandard.jobFamily}
                    rationale={recommendedStandard.rationale}
                    onUseStandard={handleUseStandard}
                  />

                  <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-900">下一步将进入真实企业版编辑</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      确认标准岗位后，系统会基于该标准模型创建企业版岗位模型，并跳转到已有详情编辑器继续完善。
                    </p>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
