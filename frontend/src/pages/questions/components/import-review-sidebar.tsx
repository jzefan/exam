import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Filter, Search, SkipForward, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ImportFilter, QuestionImportDraft } from "../import-types";
import { getBlockingImportIssues, getDraftPreviewText, getQuestionTypeLabel, isMissingAnswerIssue } from "../import-utils";

const filterOptions: Array<{ value: ImportFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "issues", label: "异常" },
  { value: "missing_answer", label: "缺答案" },
];

function getStatusColor(status: QuestionImportDraft["review_status"]) {
  if (status === "approved") return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  if (status === "skipped") return "text-slate-400 bg-slate-400/10 border-slate-400/20";
  return "text-amber-500 bg-amber-500/10 border-amber-500/20";
}

function getStatusIcon(status: QuestionImportDraft["review_status"]) {
  if (status === "approved") return <CheckCircle2 size={12} />;
  if (status === "skipped") return <SkipForward size={12} />;
  return <Circle size={12} />;
}

function filterImportDrafts(drafts: QuestionImportDraft[], filter: ImportFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return drafts.filter((draft) => {
    if (filter === "pending") return draft.review_status === "pending";
    if (filter === "issues") return getBlockingImportIssues(draft).length > 0;
    if (filter === "low") return draft.type_confidence === "low" || draft.boundary_confidence === "low";
    if (filter === "missing_answer") return !draft.answer_text?.trim() || draft.issues.some(isMissingAnswerIssue);
    return true;
  }).filter((draft) => {
    if (!normalizedQuery) return true;
    const searchableText = [
      draft.title,
      draft.content_text,
      draft.answer_text,
      draft.analysis,
      getQuestionTypeLabel(draft.type),
      draft.segment_source,
    ].join(" ").toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

export function ImportReviewSidebar({
  drafts,
  selectedDraftId,
  filter,
  onFilterChange,
  onSelect,
  onDelete,
}: {
  drafts: QuestionImportDraft[];
  selectedDraftId: string | null;
  filter: ImportFilter;
  onFilterChange: (filter: ImportFilter) => void;
  onSelect: (draftId: string) => void;
  onDelete: (draftId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visibleDrafts = useMemo(() => filterImportDrafts(drafts, filter, query), [drafts, filter, query]);
  const issueCount = useMemo(
    () => drafts.filter((draft) => getBlockingImportIssues(draft).length > 0).length,
    [drafts],
  );
  const missingAnswerCount = useMemo(
    () => drafts.filter((draft) => !draft.answer_text?.trim() || draft.issues.some(isMissingAnswerIssue)).length,
    [drafts],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="space-y-3 border-b border-border/50 px-4 py-3">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-primary" />
          <Input 
            placeholder="搜索题目内容..." 
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 rounded-lg border-none bg-slate-50 pl-9 text-sm transition-all focus-visible:ring-1 focus-visible:ring-primary/20"
          />
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            <Filter size={12} />
            状态筛选
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filterOptions.map((item) => (
              <Button
                key={item.value}
                type="button"
                size="sm"
                variant={filter === item.value ? "default" : "secondary"}
                className={cn(
                  "relative h-7 rounded-md px-2.5 text-xs font-bold transition-all",
                  filter === item.value 
                    ? "bg-primary text-white shadow-sm shadow-primary/20" 
                    : "bg-slate-100 hover:bg-slate-200 text-slate-500 border-none"
                )}
                onClick={() => onFilterChange(item.value)}
              >
                {item.label}
                {item.value === "issues" && issueCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -right-1.5 -top-1.5 h-4 min-w-4 justify-center rounded-full border border-white px-1 text-[10px] font-bold leading-none shadow-sm dark:border-slate-950"
                  >
                    {issueCount}
                  </Badge>
                )}
                {item.value === "missing_answer" && missingAnswerCount > 0 && (
                  <Badge
                    variant="warning"
                    className="absolute -right-1.5 -top-1.5 h-4 min-w-4 justify-center rounded-full border border-white px-1 text-[10px] font-bold leading-none shadow-sm dark:border-slate-950"
                  >
                    {missingAnswerCount}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2 py-3 pl-4 pr-4">
          {visibleDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="size-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 mb-4">
                <Search size={24} />
              </div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">没有匹配的题目</p>
            </div>
          ) : (
            visibleDrafts.map((draft, index) => {
              const isSelected = selectedDraftId === draft.draft_id;
              const statusClasses = getStatusColor(draft.review_status);
              const blockingIssues = getBlockingImportIssues(draft);
              const hasMissingAnswer = !draft.answer_text?.trim() || draft.issues.some(isMissingAnswerIssue);
              
              return (
                <div
                  key={draft.draft_id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group relative w-full cursor-pointer overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    isSelected 
                      ? "border-primary bg-white shadow-sm" 
                      : "border-slate-100 hover:border-primary/30 hover:bg-slate-50/50"
                  )}
                  onClick={() => onSelect(draft.draft_id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelect(draft.draft_id);
                  }}
                >
                  {/* Active Indicator */}
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                  )}

                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <div className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black transition-all",
                        isSelected ? "bg-primary text-white" : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
                      )}>
                        {index + 1}
                      </div>
                      <Badge 
                        variant="outline" 
                        className="h-5 shrink-0 border-slate-200 bg-white px-1.5 py-0 text-[10px] font-bold tracking-wide text-slate-500"
                      >
                        {getQuestionTypeLabel(draft.type)}
                      </Badge>
                      <div className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold transition-all",
                        statusClasses,
                      )}>
                        {getStatusIcon(draft.review_status)}
                        <span className="tracking-tight">
                          {draft.review_status === "approved" ? "已确认" : draft.review_status === "skipped" ? "已跳过" : "待审核"}
                        </span>
                      </div>
                      {hasMissingAnswer && (
                        <div className="flex shrink-0 items-center rounded-full border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
                          缺答案
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`删除第 ${index + 1} 题`}
                      className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-bold text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(draft.draft_id);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>

                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words text-sm font-medium leading-relaxed transition-colors [overflow-wrap:anywhere]",
                      isSelected ? "text-slate-600" : "text-slate-500 group-hover:text-slate-600",
                    )}
                  >
                    {getDraftPreviewText(draft)}
                  </p>

                  {blockingIssues.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <div className="flex w-fit items-center gap-1.5 rounded-md border border-red-100 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500"></span>
                        </span>
                        {blockingIssues.length} 个异常
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
