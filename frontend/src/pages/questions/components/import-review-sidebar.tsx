import { CheckCircle2, Circle, SkipForward } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImportFilter, QuestionImportDraft } from "../import-types";
import { getQuestionTypeLabel, getReviewStatusLabel } from "../import-utils";

const filterOptions: Array<{ value: ImportFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待人工审核" },
  { value: "issues", label: "异常" },
  { value: "low", label: "低置信度" },
  { value: "missing_answer", label: "缺答案" },
];

function getStatusIcon(status: QuestionImportDraft["review_status"]) {
  if (status === "approved") return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (status === "skipped") return <SkipForward size={14} className="text-muted-foreground" />;
  return <Circle size={14} className="text-amber-600" />;
}

function filterImportDrafts(drafts: QuestionImportDraft[], filter: ImportFilter) {
  return drafts.filter((draft) => {
    if (filter === "pending") return draft.review_status === "pending";
    if (filter === "issues") return draft.issues.length > 0;
    if (filter === "low") return draft.type_confidence === "low" || draft.boundary_confidence === "low";
    if (filter === "missing_answer") return !draft.answer_text?.trim();
    return true;
  });
}

export function ImportReviewSidebar({
  drafts,
  selectedDraftId,
  filter,
  onFilterChange,
  onSelect,
}: {
  drafts: QuestionImportDraft[];
  selectedDraftId: string | null;
  filter: ImportFilter;
  onFilterChange: (filter: ImportFilter) => void;
  onSelect: (draftId: string) => void;
}) {
  const visibleDrafts = filterImportDrafts(drafts, filter);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="space-y-2 border-b border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">筛选</p>
        <div className="flex flex-wrap gap-1.5">
          {filterOptions.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={filter === item.value ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => onFilterChange(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {visibleDrafts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            没有匹配的题目
          </div>
        ) : (
          visibleDrafts.map((draft, index) => (
            <button
              key={draft.draft_id}
              type="button"
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                selectedDraftId === draft.draft_id ? "border-primary bg-primary/5" : "border-border",
              )}
              onClick={() => onSelect(draft.draft_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">#{index + 1}</span>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {getQuestionTypeLabel(draft.type)}
                  </Badge>
                </div>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {getStatusIcon(draft.review_status)}
                  {getReviewStatusLabel(draft.review_status)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
                {draft.title || draft.content_text || "未命名题目"}
              </p>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
