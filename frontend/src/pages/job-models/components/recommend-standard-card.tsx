import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type RecommendStandardCardProps = {
  jobRole: string
  industryName: string
  directionName: string
  jobFamily: string
  rationale: string
  confidence?: number
  matchedKeywords?: string[]
  isCreating?: boolean
  onUseStandard?: () => void
}

function formatConfidence(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return null
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export function RecommendStandardCard({
  jobRole,
  industryName,
  directionName,
  jobFamily,
  rationale,
  confidence,
  matchedKeywords,
  isCreating = false,
  onUseStandard,
}: RecommendStandardCardProps) {
  const confidenceLabel = formatConfidence(confidence)
  const keywords = matchedKeywords ?? []

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">推荐标准岗位</Badge>
            {confidenceLabel ? (
              <Badge variant="outline">置信度 {confidenceLabel}</Badge>
            ) : null}
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">{jobRole}</h3>
            <p className="text-sm text-muted-foreground">
              {[industryName, directionName, jobFamily].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <Button
          disabled={isCreating}
          onClick={onUseStandard}
          size="sm"
          type="button"
        >
          {isCreating ? "对照中…" : "使用该标准岗位继续"}
        </Button>
      </div>

      {rationale ? (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{rationale}</p>
      ) : null}

      {keywords.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {keywords.map((keyword) => (
            <Badge className="font-normal" key={keyword} variant="outline">
              {keyword}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
