import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Search, Check, FileText, Maximize2, Minimize2, ChevronDown, X } from "lucide-react";
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
import { formatQuestionBankLabel } from "@/lib/question-banks";
import { cn } from "@/lib/utils";
import type { IQuestion, IQuestionBank, QuestionType } from "@/types";
import { getUserRole } from "@/types/rbac";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";

const ALL_BANKS = "__all_banks__";
const ALL_TYPES = "__all_types__";

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
  showSummary = true,
  renderSummary,
  isFullscreen: controlledIsFullscreen,
  onFullscreenChange,
  initialBankName,
  initialBankId,
  initialBankQuestionCount,
  lockInitialBank = false,
  initialKnowledgePointId,
  autoSelectAll = false,
  initialType,
  restrictKnowledgePointsToOptions = false,
  fillAvailableHeight = false,
  refreshKey,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  knowledgePointOptions?: SelectedKnowledgePoint[];
  showSummary?: boolean;
  /** 自定义摘要行：由父组件渲染（题数统计 + 清空/全屏等操作），用于将摘要并入外层标题行。 */
  renderSummary?: (info: {
    selectedCount: number;
    currentBankTotal: number | null | undefined;
    total: number;
    onClear: () => void;
    onOpenFullscreen: () => void;
  }) => ReactNode;
  isFullscreen?: boolean;
  onFullscreenChange?: (next: boolean) => void;
  initialBankName?: string;
  initialBankId?: string;
  initialBankQuestionCount?: number;
  /** 与 initialBankName 配合使用：锁定题库筛选，不允许切到其它题库。 */
  lockInitialBank?: boolean;
  initialKnowledgePointId?: string;
  /** 进入时默认全选当前题库 + 知识点过滤下的全部题目（一次性）。 */
  autoSelectAll?: boolean;
  /** 初始题型：进入时默认按该题型过滤，但保留题型下拉，用户可改。 */
  initialType?: QuestionType;
  /** 知识点下拉只展示传入的 knowledgePointOptions（用于限定课程相关知识点）。 */
  restrictKnowledgePointsToOptions?: boolean;
  /** 嵌入大弹窗/分栏布局时，让题目列表吃满父容器剩余高度。 */
  fillAvailableHeight?: boolean;
  /** 外部新增题目后递增该值，触发题库与题目列表刷新。 */
  refreshKey?: number;
}) {
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name?: string } | null }>();
  const showBankOwner = identity ? getUserRole(identity) === "platform_admin" : false;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [bankNameInitialised, setBankNameInitialised] = useState(false);
  const [typeFilter, setTypeFilter] = useState<QuestionType | null>(initialType ?? null);
  const [knowledgePointFilter, setKnowledgePointFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [internalIsFullscreen, setInternalIsFullscreen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isFullscreen = controlledIsFullscreen ?? internalIsFullscreen;
  const pageSize = isFullscreen ? 500 : 20;
  const setIsFullscreen = (next: boolean) => {
    onFullscreenChange?.(next);
    if (controlledIsFullscreen === undefined) {
      setInternalIsFullscreen(next);
    }
  };

  const selectedSet = new Set(selectedIds);
  const bankFilterLocked = lockInitialBank && Boolean(initialBankName);

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

  // Load question banks for filtering
  const { query: bankQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 200 },
  });
  const banks = bankQuery.data?.data ?? [];
  const { query: knowledgePointQuery } = useList<SelectedKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 500 },
    queryOptions: { enabled: !restrictKnowledgePointsToOptions },
  });
  const knowledgePoints = restrictKnowledgePointsToOptions
    ? (knowledgePointOptions ?? [])
    : Array.from(
        new Map(
          [...(knowledgePointOptions ?? []), ...(knowledgePointQuery.data?.data ?? [])].map(
            (item) => [item.id, item],
          ),
        ).values(),
      );

  useEffect(() => {
    if (bankNameInitialised) return;
    if (initialBankId) {
      setBankFilter(initialBankId);
      setBankNameInitialised(true);
      return;
    }
    if (!initialBankName || banks.length === 0) return;
    const match = banks.find((b) => b.name === initialBankName);
    if (match) {
      setBankFilter(match.id);
      setBankNameInitialised(true);
      return;
    }
    if (!lockInitialBank) {
      setBankNameInitialised(true);
    }
  }, [initialBankId, initialBankName, bankNameInitialised, banks, lockInitialBank]);

  const kpFilterSetRef = useRef(false);
  useEffect(() => {
    if (!initialKnowledgePointId || kpFilterSetRef.current) return;
    kpFilterSetRef.current = true;
    setKnowledgePointFilter(initialKnowledgePointId);
  }, [initialKnowledgePointId]);

  // Load questions
  const { query: questionQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: page, pageSize, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: [
      ...(search ? [{ field: "search_text", operator: "contains" as const, value: search }] : []),
      ...(bankFilter ? [{ field: "question_bank_id", operator: "eq" as const, value: bankFilter }] : []),
      ...(typeFilter ? [{ field: "type", operator: "eq" as const, value: typeFilter }] : []),
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
  const currentBank = bankFilter ? banks.find((bank) => bank.id === bankFilter) : null;
  const currentBankTotal = currentBank?.question_count ?? initialBankQuestionCount;
  const hasInitialBankFallback =
    Boolean(initialBankId && initialBankName) &&
    !banks.some((bank) => bank.id === initialBankId);

  useEffect(() => {
    if (!refreshKey) return;
    void bankQuery.refetch();
    void questionQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 从课程详情跳转过来时，默认全选「课程题库 + 知识点」过滤下的全部题目。
  // 等过滤条件（题库名解析、知识点）就绪后再拉全量，避免误选到未过滤的题目。
  const [autoSelectDone, setAutoSelectDone] = useState(false);
  const autoSelectFiltersReady =
    (!initialBankName || bankFilter !== null) &&
    (!initialKnowledgePointId || knowledgePointFilter !== null);
  const { query: autoSelectQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters: [
      ...(bankFilter ? [{ field: "question_bank_id", operator: "eq" as const, value: bankFilter }] : []),
      ...(knowledgePointFilter
        ? [{ field: "knowledge_point_id", operator: "eq" as const, value: knowledgePointFilter }]
        : []),
    ],
    queryOptions: { enabled: autoSelectAll && !autoSelectDone && autoSelectFiltersReady },
  });

  useEffect(() => {
    if (!autoSelectAll || autoSelectDone || !autoSelectFiltersReady) return;
    const data = autoSelectQuery.data?.data;
    if (!data) return;
    setAutoSelectDone(true);
    // 仅作为默认选择：用户尚未选过题时才整体带入，避免覆盖手动调整。
    if (selectedIds.length > 0) return;
    const ids = Array.from(new Set(data.map((question) => question.id)));
    if (ids.length > 0) onChange(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectAll, autoSelectDone, autoSelectFiltersReady, autoSelectQuery.data?.data]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleExpanded = (questionId: string) => {
    setExpandedId((prev) => (prev === questionId ? null : questionId));
  };

  const shouldIgnoreCardToggle = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest("button,a,input,textarea,select,[role='button'],[data-no-card-toggle='true']"));

  const renderFilters = () => (
    <div className="grid gap-2 lg:grid-cols-[minmax(280px,1fr)_minmax(160px,220px)_minmax(140px,180px)_minmax(180px,240px)]">
      <div className="relative min-w-0">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索题目"
          placeholder="按关键字搜索题干、标题或选项..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 pl-8 text-sm"
        />
      </div>
      <Select
        value={bankFilter ?? ALL_BANKS}
        disabled={bankFilterLocked}
        onValueChange={(value) => {
          setBankFilter(value === ALL_BANKS ? null : value);
          setPage(1);
        }}
      >
        <SelectTrigger className="h-9 w-full" aria-label="按题库筛选">
          <SelectValue placeholder="全部题库" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_BANKS}>全部题库</SelectItem>
          {hasInitialBankFallback && initialBankId && initialBankName ? (
            <SelectItem value={initialBankId}>{initialBankName}</SelectItem>
          ) : null}
          {banks.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {formatQuestionBankLabel(b, { showOwner: showBankOwner })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={typeFilter ?? ALL_TYPES}
        onValueChange={(value) => {
          setTypeFilter(value === ALL_TYPES ? null : (value as QuestionType));
          setPage(1);
        }}
      >
        <SelectTrigger className="h-9 w-full" aria-label="按题型筛选">
          <SelectValue placeholder="全部题型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TYPES}>全部题型</SelectItem>
          {Object.entries(typeLabels).map(([type, config]) => (
            <SelectItem key={type} value={type}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {knowledgePoints.length > 0 && (
        <Select
          value={knowledgePointFilter ?? ALL_BANKS}
          onValueChange={(value) => {
            setKnowledgePointFilter(value === ALL_BANKS ? null : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-full" aria-label="按知识点筛选">
            <SelectValue placeholder="全部知识点" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BANKS}>全部知识点</SelectItem>
            {knowledgePoints.map((item) => (
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
    <div
      className={cn(
        "divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/60",
        fillAvailableHeight ? "min-h-0 flex-1" : "max-h-[min(56vh,520px)]",
      )}
    >
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
          const isExpanded = expandedId === q.id;
          const t = typeLabels[q.type] ?? { label: q.type, className: "" };
          const questionText = getQuestionTitle(q);
          const questionHtml = getQuestionContentHtml(q);
          return (
            <div
              key={q.id}
              className={
                isSelected
                  ? "border-l-2 border-l-primary bg-primary/5"
                  : "border-l-2 border-l-transparent"
              }
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label={questionText}
                className={`grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isSelected ? "hover:bg-primary/10" : "hover:bg-muted/50"
                }`}
                onClick={() => toggleExpanded(q.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  toggleExpanded(q.id);
                }}
              >
                <button
                  type="button"
                  data-no-card-toggle="true"
                  aria-label={isSelected ? "取消选择题目" : "选择题目"}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(q.id);
                  }}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-input"
                  }`}
                >
                  {isSelected && <Check size={12} />}
                </button>
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ${
                    isSelected
                      ? "border-primary/25 bg-primary/10 text-primary"
                      : t.className
                  }`}
                >
                  {t.label}
                </Badge>
                <div className={`min-w-0 overflow-hidden text-sm ${isSelected ? "font-medium text-foreground" : "text-foreground"}`}>
                  {questionHtml ? (
                    <RichContent
                      html={questionHtml}
                      className="line-clamp-1 max-w-full break-words [&_.katex-display]:my-0 [&_.katex-display]:inline-block [&_*]:!text-inherit"
                    />
                  ) : (
                    <span className="block truncate">
                      <LatexText>{questionText}</LatexText>
                    </span>
                  )}
                </div>
                <span className={`shrink-0 whitespace-nowrap text-xs ${isSelected ? "text-foreground/75" : "text-muted-foreground"}`}>
                  {q.score}分 · 难度{q.difficulty}
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </div>
              {isExpanded && (
                <div className="border-t border-dashed border-primary/30 bg-muted/30 px-3 pb-4 pt-3">
                  <div className="relative rounded-xl border border-primary/20 bg-background p-4 shadow-sm ring-1 ring-primary/5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="关闭题目详情"
                      className="absolute right-2 top-2 z-10 h-7 w-7 rounded-full bg-background/90 shadow-sm"
                      onClick={() => setExpandedId(null)}
                    >
                      <X size={13} />
                    </Button>
                    <QuestionPreviewCard
                      question={q}
                      mode="detailed"
                      defaultExpanded
                      markChoiceAnswer
                      className="border-0 bg-transparent pr-8 shadow-none"
                    />
                  </div>
                </div>
              )}
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
            已选 {selectedIds.length} 题
            {currentBankTotal != null ? `，当前题库共 ${currentBankTotal} 题` : `，共 ${total} 题`}
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
                        markChoiceAnswer
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
    <div className={cn(fillAvailableHeight ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4")}>
      {/* Summary */}
      {showSummary && renderSummary
        ? renderSummary({
            selectedCount: selectedIds.length,
            currentBankTotal,
            total,
            onClear: () => onChange([]),
            onOpenFullscreen: () => setIsFullscreen(true),
          })
        : null}
      {showSummary && !renderSummary && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            已选 <span className="font-semibold text-foreground">{selectedIds.length}</span> 题
            {currentBankTotal != null ? (
              <>
                <span className="mx-1">·</span>
                当前题库共 <span className="font-semibold text-foreground">{currentBankTotal}</span> 题
              </>
            ) : null}
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
      )}

      {renderFilters()}

      {renderQuestionList()}

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

      {isFullscreen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[1000] flex flex-col bg-background">
              {renderFullscreenList()}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
