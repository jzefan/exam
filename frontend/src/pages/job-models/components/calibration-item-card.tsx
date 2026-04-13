import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { ModelSourceBadge } from "./model-source-badge"

type CalibrationItemCardProps = {
  title: string
  source: "standard" | "enterprise_adjusted" | "enterprise_added"
  description: string
  evidence: string
  knowledgePoints: string[]
  editable?: boolean
}

export function CalibrationItemCard({
  title,
  source,
  description,
  evidence,
  knowledgePoints,
  editable = true,
}: CalibrationItemCardProps) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
            <ModelSourceBadge source={source} />
          </div>
          <p className="text-xs text-slate-500">{evidence}</p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-slate-500">能力描述</Label>
          <Textarea
            defaultValue={description}
            disabled={!editable}
            className="min-h-[84px] rounded-2xl border-slate-200 bg-slate-50 text-sm text-slate-700"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium text-slate-500">关联知识点</Label>
          <Input
            defaultValue={knowledgePoints.join(" / ")}
            disabled={!editable}
            className="rounded-2xl border-slate-200 bg-slate-50 text-sm text-slate-700"
          />
        </div>
      </div>
    </article>
  )
}
