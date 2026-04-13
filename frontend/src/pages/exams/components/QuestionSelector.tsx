import { useEffect, useId, useState } from "react";
import { useList } from "@refinedev/core";
import { Search, Check, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { getQuestionContentHtml, getQuestionTitle } from "@/components/questions/question-preview-utils";
import { LatexText } from "@/components/ui/latex-text";
import { RichContent } from "@/components/ui/rich-content";
import type { IQuestion, IQuestionBank } from "@/types";

const ALL_BANKS = "__all_banks__";

const typeLabels: Record<string, { label: string; className: string }> = {
  choice: { label: "选择", className: "border-primary/20 bg-primary/10 text-primary" },
  true_false: { label: "判断", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  fill_in: { label: "填空", className: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  short_answer: { label: "简答", className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  essay: { label: "论述", className: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  code: { label: "编程", className: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
};

export function QuestionSelector({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const searchId = useId();

  const selectedSet = new Set(selectedIds);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Load question banks for filtering
  const { query: bankQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 200 },
  });
  const banks = bankQuery.data?.data ?? [];

  // Load questions
  const { query: questionQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: page, pageSize, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: [
      ...(search ? [{ field: "title", operator: "contains" as const, value: search }] : []),
      ...(bankFilter ? [{ field: "question_bank_id", operator: "eq" as const, value: bankFilter }] : []),
    ],
  });
  // Backend may return the same question id multiple times when joining
  // tags / knowledge points. Dedupe by id so users don't see "ghost" selected
  // rows on other pages caused by row multiplication.
  const rawQuestions = questionQuery.data?.data ?? [];
  const questions = Array.from(new Map(rawQuestions.map((q) => [q.id, q])).values());
  const total = questionQuery.data?.total ?? 0;
  const isLoading = questionQuery.isLoading;
  const totalPages = Math.ceil(total / pageSize);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          已选 <span className="font-semibold text-foreground">{selectedIds.length}</span> 题
        </p>
        {selectedIds.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            清空选择
          </Button>
        )}
      </div>

      {/* Search + bank filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            aria-label="搜索题目"
            placeholder="搜索题目..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select
          value={bankFilter ?? ALL_BANKS}
          onValueChange={(value) => {
            setBankFilter(value === ALL_BANKS ? null : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-full sm:w-[180px]" aria-label="按题库筛选">
            <SelectValue placeholder="全部题库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BANKS}>全部题库</SelectItem>
            {banks.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Question list */}
      <TooltipProvider delayDuration={120}>
        <div className="max-h-[400px] overflow-y-auto rounded-lg border divide-y">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : questions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText size={24} className="mx-auto mb-2 opacity-25" />
            暂无题目
          </div>
        ) : (
          questions.map((q) => {
            const isSelected = selectedSet.has(q.id);
            const t = typeLabels[q.type] ?? { label: q.type, className: "" };
            const questionText = getQuestionTitle(q);
            const questionHtml = getQuestionContentHtml(q);
            return (
              <Tooltip key={q.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={questionText}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-l-2 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      isSelected ? "border-l-primary" : "border-l-transparent"
                    }`}
                    onClick={() => toggle(q.id)}
                  >
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {isSelected && <Check size={12} />}
                    </div>
                    <Badge variant="outline" className={`text-xs shrink-0 ${t.className}`}>
                      {t.label}
                    </Badge>
                    <div className={`min-w-0 flex-1 text-sm ${isSelected ? "text-primary font-medium" : "text-foreground"}`}>
                      {questionHtml ? (
                        <RichContent
                          html={questionHtml}
                          className="line-clamp-1 break-all [&_.katex-display]:my-0 [&_.katex-display]:inline-block [&_*]:!text-inherit"
                        />
                      ) : (
                        <span className="block truncate">
                          <LatexText>{questionText}</LatexText>
                        </span>
                      )}
                    </div>
                    <span className="text-xs shrink-0 text-muted-foreground">
                      {q.score}分 · 难度{q.difficulty}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" align="start" sideOffset={10} className="max-h-[70vh] w-[min(44rem,calc(100vw-2rem))] overflow-auto rounded-xl border bg-background p-0 text-foreground shadow-xl">
                  <QuestionPreviewCard question={q} mode="compact" defaultExpanded className="border-0 shadow-none" />
                </TooltipContent>
              </Tooltip>
            );
          })
        )}
        </div>
      </TooltipProvider>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
