import { FileSpreadsheet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ImportTemplateHelp() {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileSpreadsheet size={16} />
          标准模板字段
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <p>推荐字段：题型、题目内容、答案、解析、难度。</p>
        <p>选择题可额外提供：选项A、选项B、选项C、选项D。</p>
        <p>Word 和 Markdown 可使用“题型：”“题目内容：”“答案：”这类字段前缀。</p>
        <p>Markdown 每道题都带齐题型、题目内容、答案时，直接按模板规则解析，不调用大模型。</p>
      </CardContent>
    </Card>
  );
}
