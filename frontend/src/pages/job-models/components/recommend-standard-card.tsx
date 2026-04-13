import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type RecommendStandardCardProps = {
  jobRole: string
  industryName: string
  directionName: string
  jobFamily: string
  rationale: string
  onUseStandard?: () => void
}

export function RecommendStandardCard({
  jobRole,
  industryName,
  directionName,
  jobFamily,
  rationale,
  onUseStandard,
}: RecommendStandardCardProps) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Badge className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50">
            推荐标准岗位
          </Badge>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">{jobRole}</h3>
            <p className="text-sm text-slate-500">
              {industryName} · {directionName} · {jobFamily}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="rounded-full px-4 text-xs font-semibold"
          onClick={onUseStandard}
        >
          使用该标准岗位继续
        </Button>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{rationale}</p>
    </div>
  )
}
