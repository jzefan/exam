import { useCallback, useId, useState, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, LoaderCircle, Sparkles, UploadCloud, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { PageIntroHeader } from "@/components/ui/page-intro-header"
import { Textarea } from "@/components/ui/textarea"

import { RecommendStandardCard } from "./components/recommend-standard-card"
import {
  SkillMatchPanel,
  type AddedSkillPayload,
  type MatchDimension,
  type MissingKp,
  type MissingSkill,
} from "./components/skill-match-panel"

type RecommendedStandard = {
  id: string
  currentVersionId?: string | null
  jobRole: string
  industryName: string
  directionName: string
  jobFamily: string
  rationale: string
  confidence: number
  matchedKeywords: string[]
}

type RecommendResponse = {
  model: {
    id: string
    current_version_id?: string | null
    job_role: string
    industry_name?: string | null
    direction_name?: string | null
    job_family?: string | null
  }
  rationale?: string
  confidence?: number
  matched_keywords?: string[]
}

async function parseErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) {
      const msg = detail
        .map((item: { loc?: unknown[]; msg?: string }) => {
          const loc = Array.isArray(item?.loc) ? item.loc.slice(1).join(".") : ""
          const text = typeof item?.msg === "string" ? item.msg : ""
          return loc ? `${loc}: ${text}` : text
        })
        .filter(Boolean)
        .join("；")
      if (msg) return msg
    }
  } catch {
    // ignore
  }
  return fallback
}

function readErrorMessage(error: unknown, fallback = "请求失败") {
  return error instanceof Error && error.message ? error.message : fallback
}

function jsonHeaders() {
  const token = localStorage.getItem("access_token")
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function extractTextFromFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""

  if (["txt", "md"].includes(extension) || file.type.startsWith("text/")) {
    return (await file.text()).trim()
  }

  if (extension === "pdf" || file.type === "application/pdf") {
    const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ])
    GlobalWorkerOptions.workerSrc = pdfWorker
    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
    const pages: string[] = []
    for (let page = 1; page <= pdf.numPages; page += 1) {
      const content = await (await pdf.getPage(page)).getTextContent()
      const text = content.items
        .map((item) => (typeof item === "object" && item && "str" in item ? String((item as { str: string }).str) : ""))
        .filter(Boolean)
        .join(" ")
      pages.push(text)
    }
    return pages.join("\n").trim()
  }

  throw new Error("暂不支持该文件类型，请上传 PDF / TXT 或直接粘贴文本。")
}

export function JobModelFastCreate() {
  const navigate = useNavigate()
  const jdTextareaId = useId()
  const fileInputId = useId()
  const [step, setStep] = useState<"upload" | "calibrate" | "match">("upload")
  const [jdText, setJdText] = useState("")
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [isParsingFile, setIsParsingFile] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isMatching, setIsMatching] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [recommended, setRecommended] = useState<RecommendedStandard | null>(null)
  const [matchDimensions, setMatchDimensions] = useState<MatchDimension[]>([])
  const [missingSkills, setMissingSkills] = useState<MissingSkill[]>([])
  const [missingKnowledgePoints, setMissingKnowledgePoints] = useState<MissingKp[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    setError(null)
    setIsParsingFile(true)
    try {
      const text = await extractTextFromFile(file)
      if (!text) {
        throw new Error("文件中未解析出文字，请换一个更清晰的文件或直接粘贴文本。")
      }
      setJdText(text)
      setUploadedFileName(file.name)
    } catch (fileError) {
      setError(readErrorMessage(fileError, "文件解析失败"))
    } finally {
      setIsParsingFile(false)
    }
  }, [])

  const clearUploadedFile = () => {
    setUploadedFileName(null)
  }

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
        throw new Error(await parseErrorMessage(response, "标准岗位推荐失败"))
      }

      const data = (await response.json()) as RecommendResponse
      setRecommended({
        id: data.model.id,
        currentVersionId: data.model.current_version_id ?? null,
        jobRole: data.model.job_role,
        industryName: data.model.industry_name ?? "",
        directionName: data.model.direction_name ?? "",
        jobFamily: data.model.job_family ?? "",
        rationale: data.rationale ?? "",
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
        matchedKeywords: Array.isArray(data.matched_keywords) ? data.matched_keywords : [],
      })
      setStep("calibrate")
    } catch (requestError) {
      setError(readErrorMessage(requestError, "标准岗位推荐失败"))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleUseStandard = async () => {
    if (!recommended?.id || isMatching) return

    setError(null)
    setIsMatching(true)
    setStep("match")
    setMatchDimensions([])
    setMissingSkills([])
    setMissingKnowledgePoints([])
    try {
      const response = await fetch(
        `/api/job-models/models/${recommended.id}/match-skills`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ job_text: jdText.trim() }),
        },
      )

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "技能对照失败"))
      }

      const data = (await response.json()) as {
        dimensions: MatchDimension[]
        missing_skills: MissingSkill[]
        missing_knowledge_points?: MissingKp[]
        missing_kps?: MissingKp[]
      }
      setMatchDimensions(data.dimensions ?? [])
      setMissingSkills(data.missing_skills ?? [])
      setMissingKnowledgePoints(data.missing_knowledge_points ?? data.missing_kps ?? [])
    } catch (requestError) {
      setError(readErrorMessage(requestError, "技能对照失败"))
      setStep("calibrate")
    } finally {
      setIsMatching(false)
    }
  }

  const handleConfirmCreate = async (payload: {
    selectedStandardSkillIds: string[]
    selectedStandardKpIds: string[]
    addedSkills: AddedSkillPayload[]
    addedKnowledgePoints: Array<{
      name: string
      parent_skill_id: string | null
      parent_skill_name: string | null
    }>
  }) => {
    if (!recommended?.id || isCreating) return

    setError(null)
    setIsCreating(true)
    try {
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
      const enterpriseName = `${recommended.jobRole} 企业版 ${stamp}`

      const response = await fetch(
        `/api/job-models/models/${recommended.id}/create-enterprise-copy`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            enterprise_name: enterpriseName,
            version_note: "基于 AI 推荐的标准岗位 + 技能对照生成",
            selected_standard_skill_ids: payload.selectedStandardSkillIds,
            selected_standard_kp_ids: payload.selectedStandardKpIds,
            added_skills: payload.addedSkills,
            added_knowledge_points: payload.addedKnowledgePoints,
          }),
        },
      )

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "企业版岗位模型创建失败"))
      }

      const created = (await response.json()) as { job_model_id: string; version_id: string }
      navigate(`/gwmx/job-models/${created.job_model_id}/versions/${created.version_id}/editor`)
    } catch (requestError) {
      setError(readErrorMessage(requestError, "企业版岗位模型创建失败"))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title={
          step === "upload"
            ? "企业快速生成"
            : step === "calibrate"
              ? "校准标准岗位"
              : "对照技能清单"
        }
        description={
          step === "upload"
            ? "粘贴或上传 JD，AI 推荐最接近的标准岗位，再生成企业版岗位模型"
            : step === "calibrate"
              ? "确认后 AI 将逐一对照标准岗位的技能与 JD 要求，方便你裁剪与补充"
              : "勾选保留的标准技能、补充 JD 中缺失的技能，一键生成企业版"
        }
        onBack={() => {
          if (step === "match") setStep("calibrate")
          else if (step === "calibrate") setStep("upload")
          else navigate("/gwmx/job-models")
        }}
        backLabel={step === "upload" ? "返回岗位列表" : "返回上一步"}
        actions={
          step !== "upload" ? (
            <Button onClick={() => navigate("/gwmx/job-models")} variant="outline">
              取消
            </Button>
          ) : undefined
        }
      />

      {step === "match" ? (
        <div className="mx-auto w-full max-w-3xl">
          {isMatching ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-border bg-card p-10">
              <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">AI 正在对照技能…</p>
              <p className="max-w-md text-center text-xs text-muted-foreground">
                正在把标准岗位「{recommended?.jobRole}」的每一项技能与你上传的 JD 做语义对照，通常需要 10–30 秒，请稍候。
              </p>
            </div>
          ) : recommended ? (
            <SkillMatchPanel
              dimensions={matchDimensions}
              isSubmitting={isCreating}
              jobRole={recommended.jobRole}
              missingKnowledgePoints={missingKnowledgePoints}
              missingSkills={missingSkills}
              onBack={() => setStep("calibrate")}
              onSubmit={handleConfirmCreate}
            />
          ) : null}
          {error ? (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : step === "upload" ? (
        <section aria-labelledby="jd-input-heading" className="mx-auto w-full max-w-3xl space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground" id="jd-input-heading">
              输入岗位信息
            </h2>
            <p className="text-sm text-muted-foreground">
              AI 会从标准岗位库中匹配最接近的一个，并给出推荐理由。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild disabled={isParsingFile} size="sm" type="button" variant="outline">
                <label className="cursor-pointer" htmlFor={fileInputId}>
                  {isParsingFile ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-2 h-4 w-4" />
                  )}
                  上传 JD 文件
                </label>
              </Button>
              <input
                accept=".pdf,.txt,.md,text/plain"
                className="hidden"
                id={fileInputId}
                onChange={handleFileChange}
                type="file"
              />
              <span className="text-xs text-muted-foreground">
                支持 PDF / TXT（图片与 Word 暂不支持）
              </span>
            </div>
            {uploadedFileName ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span className="truncate">{uploadedFileName}</span>
                <Button
                  aria-label="清除已上传文件"
                  className="ml-auto h-6 w-6 shrink-0"
                  onClick={clearUploadedFile}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={jdTextareaId}>岗位描述</Label>
            <Textarea
              className="min-h-[200px]"
              id={jdTextareaId}
              onChange={(event) => setJdText(event.target.value)}
              placeholder="例如：负责 Java 后端开发，熟悉 Spring Boot、MySQL 和接口设计"
              value={jdText}
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <Button
            className="w-full sm:w-auto"
            disabled={!jdText.trim() || isAnalyzing || isParsingFile}
            onClick={handleParse}
            type="button"
          >
            {isAnalyzing ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {isAnalyzing ? "AI 正在匹配…" : "立即解析文本"}
          </Button>
        </section>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {recommended ? (
            <RecommendStandardCard
              confidence={recommended.confidence}
              directionName={recommended.directionName}
              industryName={recommended.industryName}
              isCreating={isMatching}
              jobFamily={recommended.jobFamily}
              jobRole={recommended.jobRole}
              matchedKeywords={recommended.matchedKeywords}
              onUseStandard={handleUseStandard}
              rationale={recommended.rationale}
            />
          ) : null}
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
