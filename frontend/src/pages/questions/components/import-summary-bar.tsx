import { AlertTriangle, CheckCircle2, FileText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ImportRecognitionMode, QuestionImportDocumentSummary } from "../import-types";
import { getImportModeLabel } from "../import-utils";

export function ImportSummaryBar({
  summary,
  fileName,
  mode,
}: {
  summary: QuestionImportDocumentSummary;
  fileName: string;
  mode: ImportRecognitionMode | null;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <p className="text-xs text-muted-foreground">当前文件</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground">
            {fileName || "未选择文件"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">识别模式</p>
          <Badge variant="outline" className="mt-1 gap-1">
            <Sparkles size={12} />
            {getImportModeLabel(mode)}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">识别题目</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-foreground">
            <FileText size={14} />
            {summary.total}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">待审核</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-amber-600">
            <AlertTriangle size={14} />
            {summary.pending_review}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">已确认</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-emerald-600">
            <CheckCircle2 size={14} />
            {summary.approved}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
