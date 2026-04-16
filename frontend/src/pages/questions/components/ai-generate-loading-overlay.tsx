import { Loader2, Sparkles } from "lucide-react";

export function AIGenerateLoadingOverlay({
  generatedCount,
}: {
  generatedCount: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-6 backdrop-blur-[2px]">
      <div className="w-full max-w-sm">
        <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-border/60 bg-card px-8 py-7 text-center shadow-xl">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Loader2 size={28} className="animate-spin" />
          </div>
          <div className="mb-2 flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles size={16} />
            正在生成题目
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            AI 正在根据已选知识点和参数生成题目，请稍候。
          </p>
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            已生成 {generatedCount} 道
          </p>
        </div>
      </div>
    </div>
  );
}
