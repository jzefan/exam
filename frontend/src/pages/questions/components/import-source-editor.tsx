import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { QuestionImportDraft } from "../import-types";
import { getQuestionTypeLabel } from "../import-utils";

export function ImportSourceEditor({
  drafts,
  selectedDraftId,
  sourceEdits,
  onChange,
  onPreview,
  onCancel,
}: {
  drafts: QuestionImportDraft[];
  selectedDraftId: string | null;
  sourceEdits: Record<string, string>;
  onChange: (draftId: string, value: string) => void;
  onPreview: () => void;
  onCancel: () => void;
}) {
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const changedCount = useMemo(
    () => drafts.filter((draft) => (sourceEdits[draft.draft_id] ?? draft.raw_text) !== draft.raw_text).length,
    [drafts, sourceEdits],
  );

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, [selectedDraftId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-100 bg-white px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="size-8 rounded-lg border-slate-200 p-0"
              onClick={onCancel}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900">编辑原文</h2>
              <p className="truncate text-xs text-slate-500">可连续修改所有识别片段，点击预览后回到核对导入内容</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-bold text-slate-400 sm:inline">
              已修改 {changedCount} 题
            </span>
            <Button type="button" className="h-9 rounded-lg px-4 text-sm font-bold" onClick={onPreview}>
              <Eye className="mr-2 size-4" />
              预览
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {drafts.map((draft, index) => {
            const isSelected = draft.draft_id === selectedDraftId;
            const value = sourceEdits[draft.draft_id] ?? draft.raw_text;
            const isChanged = value !== draft.raw_text;

            return (
              <section
                key={draft.draft_id}
                ref={isSelected ? selectedRef : undefined}
                className={cn(
                  "rounded-2xl border bg-white p-4 shadow-sm transition-all",
                  isSelected ? "border-primary shadow-primary/10" : "border-slate-100",
                )}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-md text-xs font-black",
                        isSelected ? "bg-primary text-white" : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-500">
                      {getQuestionTypeLabel(draft.type)}
                    </span>
                    {isSelected && <span className="text-xs font-bold text-primary">当前题</span>}
                  </div>
                  {isChanged && <span className="text-xs font-bold text-amber-600">已修改</span>}
                </div>

                <Textarea
                  value={value}
                  onChange={(event) => onChange(draft.draft_id, event.target.value)}
                  className="min-h-[180px] resize-y rounded-xl border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-primary/20"
                />
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
