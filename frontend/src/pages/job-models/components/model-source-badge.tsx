import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type ModelSource = "standard" | "enterprise_adjusted" | "enterprise_added"

type ModelSourceBadgeProps = {
  source: ModelSource
  className?: string
}

const SOURCE_COPY: Record<ModelSource, string> = {
  standard: "标准项",
  enterprise_adjusted: "企业调整",
  enterprise_added: "企业新增",
}

const SOURCE_CLASSNAME: Record<ModelSource, string> = {
  standard: "border-transparent bg-slate-100 text-slate-700",
  enterprise_adjusted: "border-transparent bg-amber-50 text-amber-700",
  enterprise_added: "border-transparent bg-emerald-50 text-emerald-700",
}

export function ModelSourceBadge({ source, className }: ModelSourceBadgeProps) {
  return (
    <Badge
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
        SOURCE_CLASSNAME[source],
        className,
      )}
    >
      {SOURCE_COPY[source]}
    </Badge>
  )
}
