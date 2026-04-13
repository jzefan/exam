import { useNavigate } from "react-router-dom"
import { ArrowLeft, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"

export function JobModelUploadAI() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f7f8fc] px-6 py-8">
      <div className="w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
              统一入口
            </p>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">
              AI 生成职位模型已并入企业快速生成
            </h1>
            <p className="text-sm leading-6 text-slate-500">
              旧的上传流程已收敛为统一入口，点击下方按钮进入标准推荐与企业校准流程。
            </p>
          </div>
          <Sparkles className="h-5 w-5 shrink-0 text-indigo-500" />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/gwmx/job-models")}
            className="rounded-full px-4 text-xs font-semibold"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回列表
          </Button>
          <Button
            type="button"
            onClick={() => navigate("/gwmx/job-models/fast-create")}
            className="rounded-full px-4 text-xs font-semibold"
          >
            进入企业快速生成
          </Button>
        </div>
      </div>
    </div>
  )
}
