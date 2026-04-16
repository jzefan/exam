import { AlertTriangle, CheckCircle2, Copy, FileText, Sparkles, Files } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ImportRecognitionMode, QuestionImportDocumentSummary } from "../import-types";
import { getImportModeLabel } from "../import-utils";

export function ImportSummaryBar({
  summary,
  fileName,
  mode,
  duplicatesRemoved = 0,
}: {
  summary: QuestionImportDocumentSummary;
  fileName: string;
  mode: ImportRecognitionMode | null;
  duplicatesRemoved?: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
          <Files size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">当前解析文件</p>
          <p className="truncate text-sm font-black text-slate-900 leading-tight">
            {fileName || "未选择文件"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
         <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Sparkles size={10} className="text-primary" />
              识别模式
            </p>
            <Badge variant="secondary" className="bg-white text-[10px] font-bold text-slate-600 px-2 py-0 border-slate-100">
              {getImportModeLabel(mode)}
            </Badge>
         </div>
         <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <FileText size={10} className="text-slate-400" />
              题目总数
            </p>
            <p className="text-sm font-black text-slate-900">{summary.total} <span className="text-[10px] text-slate-400">题</span></p>
         </div>
         {duplicatesRemoved > 0 && (
           <div className="p-3 rounded-2xl bg-orange-50 border border-orange-100 col-span-2">
              <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Copy size={10} className="text-orange-400" />
                已去重
              </p>
              <p className="text-sm font-black text-orange-600">{duplicatesRemoved} <span className="text-[10px] text-orange-400">题</span></p>
           </div>
         )}
      </div>

      <div className="flex items-center gap-2 p-1.5 bg-slate-50 rounded-[20px] border border-slate-100">
         <div className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[14px] bg-white shadow-sm border border-slate-100">
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="text-[11px] font-black text-amber-600">{summary.pending_review} 待审核</span>
         </div>
         <div className="flex-1 flex items-center justify-center gap-2 py-2">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-[11px] font-black text-emerald-600">{summary.approved} 已确认</span>
         </div>
      </div>
    </div>
  );
}
