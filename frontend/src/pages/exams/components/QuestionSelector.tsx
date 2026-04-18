import { useEffect, useRef, useState } from "react";
import { useList } from "@refinedev/core";
import { Search, Check, FileText, Maximize2, Minimize2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import type { IQuestion, IQuestionBank } from "@/types";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";

const ALL_BANKS = "__all_banks__";
const HOVER_PREVIEW_OPEN_DELAY = 1000;

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
  knowledgePointOptions,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  knowledgePointOptions?: SelectedKnowledgePoint[];
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [knowledgePointFilter, setKnowledgePointFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewTooltip, setPreviewTooltip] = useState<{ questionId: string; x: number; y: number } | null>(null);
  const previewOpenTimerRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<{ questionId: string; x: number; y: number } | null>(null);
  const pageSize = isFullscreen ? 500 : 20;

  const selectedSet = new Set(selectedIds);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(
    () => () => {
      if (previewOpenTimerRef.current) {
        window.clearTimeout(previewOpenTimerRef.current);
      }
    },
    [],
  );

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
      ...(knowledgePointFilter
        ? [{ field: "knowledge_point_id", operator: "eq" as const, value: knowledgePointFilter }]
        : []),
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
  const previewQuestion = previewTooltip
    ? questions.find((question) => question.id === previewTooltip.questionId) ?? null
    : null;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const clearPreviewOpenTimer = () => {
    if (previewOpenTimerRef.current) {
      window.clearTimeout(previewOpenTimerRef.current);
      previewOpenTimerRef.current = null;
    }
  };

  const openPreviewAtPoint = (questionId: string, x: number, y: number) => {
    pendingPreviewRef.current = null;
    setPreviewTooltip({ questionId, x, y });
  };

  const schedulePreviewAtPoint = (questionId: string, x: number, y: number) => {
    clearPreviewOpenTimer();
    pendingPreviewRef.current = { questionId, x, y };
    setPreviewTooltip(null);
    previewOpenTimerRef.current = window.setTimeout(() => {
      const pendingPreview = pendingPreviewRef.current;
      if (pendingPreview?.questionId === questionId) {
        openPreviewAtPoint(questionId, pendingPreview.x, pendingPreview.y);
      }
      previewOpenTimerRef.current = null;
    }, HOVER_PREVIEW_OPEN_DELAY);
  };

  const closePreview = (questionId?: string) => {
    if (!questionId || pendingPreviewRef.current?.questionId === questionId) {
      pendingPreviewRef.current = null;
      clearPreviewOpenTimer();
    }
    setPreviewTooltip((current) => {
      if (!questionId || current?.questionId === questionId) {
        return null;
      }
      return current;
    });
  };

  const openPreviewAtElement = (questionId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    openPreviewAtPoint(questionId, rect.left + 24, rect.bottom + 6);
  };

  const shouldIgnoreCardToggle = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest("button,a,input,textarea,select,[role='button'],[data-no-card-toggle='true']"));

  const renderFilters = () => (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
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
      {knowledgePointOptions && knowledgePointOptions.length > 0 && (
        <Select
          value={knowledgePointFilter ?? ALL_BANKS}
          onValueChange={(value) => {
            setKnowledgePointFilter(value === ALL_BANKS ? null : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-full sm:w-[220px]" aria-label="按知识点筛选">
            <SelectValue placeholder="全部知识点" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BANKS}>全部知识点</SelectItem>
            {knowledgePointOptions.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );

  const renderQuestionList = () => (
    <div className="max-h-[400px] divide-y overflow-y-auto rounded-lg border">
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
            <div
              key={q.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={questionText}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-l-2 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isSelected ? "border-l-primary" : "border-l-transparent"
              }`}
              onPointerEnter={(event) => schedulePreviewAtPoint(q.id, event.clientX, event.clientY)}
              onPointerMove={(event) => {
                if (previewTooltip?.questionId === q.id) {
                  openPreviewAtPoint(q.id, event.clientX, event.clientY);
                } else if (pendingPreviewRef.current?.questionId === q.id) {
                  pendingPreviewRef.current = { questionId: q.id, x: event.clientX, y: event.clientY };
                }
              }}
              onPointerLeave={() => closePreview(q.id)}
              onFocus={(event) => openPreviewAtElement(q.id, event.currentTarget)}
              onBlur={() => closePreview(q.id)}
              onClick={() => toggle(q.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggle(q.id);
              }}
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
            </div>
          );
        })
      )}
    </div>
  );

  const renderFullscreenList = () => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">全屏选题</p>
          <p className="text-sm text-muted-foreground">
            已选 {selectedIds.length} 题，共 {total} 题
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              清空选择
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
            <Minimize2 size={14} />
            退出全屏
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
        {renderFilters()}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : questions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground">
              <FileText size={28} className="mb-2 opacity-25" />
              暂无题目
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => {
                const isSelected = selectedSet.has(q.id);
                return (
                  <div
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    className="cursor-pointer rounded-lg outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={(event) => {
                      if (shouldIgnoreCardToggle(event.target)) return;
                      toggle(q.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (shouldIgnoreCardToggle(event.target)) return;
                      event.preventDefault();
                      toggle(q.id);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        aria-label={isSelected ? "取消选择题目" : "选择题目"}
                        className="mt-3 h-5 w-5 rounded-md"
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => toggle(q.id)}
                      />
                      <QuestionPreviewCard
                        question={q}
                        mode="detailed"
                        defaultExpanded
                        className={cn(
                          "flex-1 transition-all",
                          isSelected ? "border-primary/50 ring-1 ring-primary/20" : "",
                        )}
                        trailing={
                          <Badge
                            variant={isSelected ? "default" : "outline"}
                            className="pointer-events-none min-w-[64px] justify-center"
                          >
                            {isSelected ? "已选择" : "未选择"}
                          </Badge>
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          已选 <span className="font-semibold text-foreground">{selectedIds.length}</span> 题
        </p>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              清空选择
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setIsFullscreen(true)}>
            <Maximize2 size={14} />
            全屏展示
          </Button>
        </div>
      </div>

      {renderFilters()}

      {renderQuestionList()}

      {previewTooltip && previewQuestion && !isFullscreen && (
        <div
          className="pointer-events-none fixed z-50 max-h-[70vh] w-[min(44rem,calc(100vw-2rem))] overflow-auto rounded-xl border bg-background p-0 text-foreground shadow-xl opacity-0 translate-y-2 transition-all duration-500 ease-out animate-in fade-in-0 slide-in-from-bottom-2 data-[state=open]:opacity-100"
          style={{
            left: Math.min(previewTooltip.x, window.innerWidth - 720),
            top: Math.min(previewTooltip.y + 10, window.innerHeight - 120),
            opacity: 1,
            transform: "translateY(0)",
          }}
        >
          <QuestionPreviewCard
            question={previewQuestion}
            mode="detailed"
            defaultExpanded
            className="border-0 shadow-none"
          />
        </div>
      )}

      {/* Pagination */}
      {!isFullscreen && totalPages > 1 && (
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

      {isFullscreen && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background">
          {renderFullscreenList()}
        </div>
      )}
    </div>
  );
}
