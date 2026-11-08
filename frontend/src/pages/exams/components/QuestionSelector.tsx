import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Search, FileText, Maximize2, Minimize2, ChevronDown, Pencil, X, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  getQuestionTitle,
} from "@/components/questions/question-preview-utils";
import { formatQuestionBankLabel } from "@/lib/question-banks";
import { cn } from "@/lib/utils";
import type { IQuestion, IQuestionBank, QuestionDisplayType, QuestionType } from "@/types";
import { getUserRole } from "@/types/rbac";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import {
  KnowledgeFilterTreeMenu,
  type KnowledgeTreeMenuOption,
} from "@/pages/courses/knowledge-filter-tree-menu";
import type { CourseKnowledgeNode } from "@/pages/courses/api";

const ALL_BANKS = "__all_banks__";
const ALL_TYPES = "__all_types__";

const typeLabels: Record<string, { label: string; className: string }> = {
  single_choice: { label: "单选", className: "border-primary/20 bg-primary/10 text-primary" },
  multi_choice: { label: "多选", className: "border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  true_false: { label: "判断", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  fill_in: { label: "填空", className: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  short_answer: { label: "简答", className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  essay: { label: "论述", className: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  code: { label: "编程", className: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
};

type QuestionSelectorKnowledgePoint = SelectedKnowledgePoint & {
  parent_id?: string | null;
};

function buildTreeFromFlatPoints(
  points: QuestionSelectorKnowledgePoint[],
): CourseKnowledgeNode | null {
  if (!points || points.length === 0) return null;
  const map = new Map<string, CourseKnowledgeNode>();
  for (const p of points) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      question_count: 0,
      material_count: 0,
      children: [],
    });
  }
  const roots: CourseKnowledgeNode[] = [];
  for (const p of points) {
    const node = map.get(p.id)!;
    if (p.parent_id && map.has(p.parent_id)) {
      map.get(p.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  if (roots.length === 0) return null;
  if (roots.length === 1) return roots[0];
  return {
    id: "__virtual_root__",
    name: "全部知识点",
    question_count: 0,
    material_count: 0,
    children: roots,
  };
}

function flattenTreeOptions(
  node: CourseKnowledgeNode | null,
  depth = 0,
  prefix = "",
): KnowledgeTreeMenuOption[] {
  if (!node) return [];
  if (node.id === "__virtual_root__") {
    return (node.children ?? []).flatMap((child) => flattenTreeOptions(child, 0, ""));
  }
  const currentPath = prefix ? `${prefix} / ${node.name}` : node.name;
  const current: KnowledgeTreeMenuOption = {
    id: node.id,
    name: node.name,
    path: currentPath,
    depth,
  };
  const children = (node.children ?? []).flatMap((child) =>
    flattenTreeOptions(child, depth + 1, currentPath),
  );
  return [current, ...children];
}

export function QuestionSelector({
  selectedIds,
  onChange,
  knowledgePointOptions,
  knowledgeTree,
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
  onEditQuestion,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  knowledgePointOptions?: SelectedKnowledgePoint[];
  knowledgeTree?: CourseKnowledgeNode | null;
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
  initialType?: QuestionDisplayType | QuestionType;
  /** 知识点下拉只展示传入的 knowledgePointOptions（用于限定课程相关知识点）。 */
  restrictKnowledgePointsToOptions?: boolean;
  /** 嵌入大弹窗/分栏布局时，让题目列表吃满父容器剩余高度。 */
  fillAvailableHeight?: boolean;
  /** 外部新增题目后递增该值，触发题库与题目列表刷新。 */
  refreshKey?: number;
  /** 展开题目详情后允许父组件接管编辑流程。 */
  onEditQuestion?: (question: IQuestion) => void;
}) {
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name?: string } | null }>();
  const showBankOwner = identity ? getUserRole(identity) === "platform_admin" : false;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const [bankNameInitialised, setBankNameInitialised] = useState(false);
  const [typeFilter, setTypeFilter] = useState<QuestionDisplayType | null>(
    initialType === "choice" ? null : (initialType ?? null),
  );
  const [knowledgePointFilter, setKnowledgePointFilter] = useState<string | null>(null);
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false);
  const [allQuestionsExpanded, setAllQuestionsExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [accumulatedQuestions, setAccumulatedQuestions] = useState<IQuestion[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [internalIsFullscreen, setInternalIsFullscreen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isFullscreen = controlledIsFullscreen ?? internalIsFullscreen;
  const pageSize = 20;
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
  const { query: knowledgePointQuery } = useList<QuestionSelectorKnowledgePoint>({
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

  const effectiveKnowledgeTree = useMemo(() => {
    if (knowledgeTree) return knowledgeTree;
    if (knowledgePoints.length > 0) {
      return buildTreeFromFlatPoints(knowledgePoints as QuestionSelectorKnowledgePoint[]);
    }
    return null;
  }, [knowledgeTree, knowledgePoints]);

  const treeOptions = useMemo(() => {
    if (effectiveKnowledgeTree) {
      return flattenTreeOptions(effectiveKnowledgeTree);
    }
    return knowledgePoints.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.name,
    }));
  }, [effectiveKnowledgeTree, knowledgePoints]);

  const selectedKnowledgePointName = useMemo(() => {
    if (!knowledgePointFilter) return null;
    return treeOptions.find((opt) => opt.id === knowledgePointFilter)?.name ?? null;
  }, [knowledgePointFilter, treeOptions]);

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

  const lastLoadedKeyRef = useRef<string>("");

  useEffect(() => {
    setPage(1);
    setAccumulatedQuestions([]);
    lastLoadedKeyRef.current = "";
  }, [search, bankFilter, typeFilter, knowledgePointFilter]);

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

  useEffect(() => {
    const raw = questionQuery.data?.data;
    if (!raw) return;

    const batchKey = `${page}:${raw.map((q) => q.id).join(",")}`;
    if (lastLoadedKeyRef.current === batchKey) return;
    lastLoadedKeyRef.current = batchKey;

    setAccumulatedQuestions((prev) => {
      if (page === 1) {
        const map = new Map<string, IQuestion>();
        for (const q of raw) {
          map.set(q.id, q);
        }
        return Array.from(map.values());
      }
      const map = new Map<string, IQuestion>();
      for (const q of prev) {
        map.set(q.id, q);
      }
      for (const q of raw) {
        map.set(q.id, q);
      }
      return Array.from(map.values());
    });
  }, [questionQuery.data?.data, page]);

  const questions = useMemo(() => {
    if (page === 1 && accumulatedQuestions.length === 0 && questionQuery.data?.data) {
      const map = new Map<string, IQuestion>();
      for (const q of questionQuery.data.data) {
        map.set(q.id, q);
      }
      return Array.from(map.values());
    }
    return accumulatedQuestions;
  }, [page, accumulatedQuestions, questionQuery.data?.data]);

  const total = questionQuery.data?.total ?? 0;
  const isLoading = questionQuery.isLoading;
  const hasMore = questions.length < total;

  const loadNextPage = () => {
    if (!questionQuery.isFetching && !questionQuery.isLoading && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          loadNextPage();
        }
      },
      {
        rootMargin: "200px",
      },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [questionQuery.isFetching, questionQuery.isLoading, hasMore]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadNextPage();
    }
  };

  const currentBank = bankFilter ? banks.find((bank) => bank.id === bankFilter) : null;
  const currentBankTotal = currentBank?.question_count ?? initialBankQuestionCount;
  const hasInitialBankFallback =
    Boolean(initialBankId && initialBankName) &&
    !banks.some((bank) => bank.id === initialBankId);

  useEffect(() => {
    if (!refreshKey) return;
    setPage(1);
    setAccumulatedQuestions([]);
    lastLoadedKeyRef.current = "";
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

  const handleEditQuestion = (question: IQuestion) => {
    setIsFullscreen(false);
    onEditQuestion?.(question);
  };

  const shouldIgnoreCardToggle = (target: EventTarget | null, currentTarget?: HTMLElement | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const interactive = target.closest("button,a,input,textarea,select,[data-no-card-toggle='true']");
    if (interactive) return true;
    const roleButton = target.closest("[role='button']");
    return Boolean(roleButton && currentTarget && roleButton !== currentTarget);
  };

  const renderFilters = () => (
    <div className="grid gap-2 lg:grid-cols-[minmax(180px,2.8fr)_minmax(120px,1.5fr)_minmax(100px,1.1fr)_minmax(120px,1.7fr)]">
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
        <SelectTrigger className="h-9 w-full min-w-0" aria-label="按题库筛选">
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
          setTypeFilter(value === ALL_TYPES ? null : (value as QuestionDisplayType));
          setPage(1);
        }}
      >
        <SelectTrigger className="h-9 w-full min-w-0" aria-label="按题型筛选">
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
      {treeOptions.length > 0 && (
        <DropdownMenu open={knowledgeMenuOpen} onOpenChange={setKnowledgeMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label="按知识点筛选"
              className="h-9 w-full min-w-0 justify-between px-3 text-sm font-normal"
            >
              <span className="truncate">
                {selectedKnowledgePointName ?? "全部知识点"}
              </span>
              <ChevronDown size={14} className="ml-1 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[320px] p-1">
            <KnowledgeFilterTreeMenu
              tree={effectiveKnowledgeTree}
              options={treeOptions}
              selectedId={knowledgePointFilter}
              showRootNode={Boolean(effectiveKnowledgeTree && effectiveKnowledgeTree.id !== "__virtual_root__")}
              onSelect={(nodeId) => {
                setKnowledgePointFilter(nodeId);
                setPage(1);
              }}
              onClose={() => setKnowledgeMenuOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  const renderQuestionList = () => (
    <div className="space-y-3">
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
      ) : questions.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <FileText size={24} className="mx-auto mb-2 opacity-25" />
          暂无题目
        </div>
      ) : (
        <>
          {questions.map((q, idx) => {
          const isSelected = selectedSet.has(q.id);
          const isSingleExpanded = expandedId === q.id;
          const isExpanded = allQuestionsExpanded || isSingleExpanded;
          const questionText = getQuestionTitle(q);
          const displayedQuestion: IQuestion = isExpanded ? q : { ...q, analysis: null };
          return (
            <div
              key={q.id}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={questionText}
              className="outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl"
              onClick={(event) => {
                if (shouldIgnoreCardToggle(event.target, event.currentTarget)) return;
                toggleExpanded(q.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                if (shouldIgnoreCardToggle(event.target, event.currentTarget)) return;
                event.preventDefault();
                toggleExpanded(q.id);
              }}
            >
              <QuestionPreviewCard
                question={displayedQuestion}
                index={idx + 1}
                mode="detailed"
                expanded={isExpanded}
                hideAnswer={false}
                markChoiceAnswer
                className={cn(
                  "cursor-pointer transition-all hover:border-primary hover:shadow-md",
                  isSelected ? "border-primary/50 ring-1 ring-primary/20 bg-primary/5" : "",
                )}
                trailing={
                  <div className="flex items-center gap-2">
                    {isExpanded && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="关闭题目详情"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allQuestionsExpanded) {
                            setAllQuestionsExpanded(false);
                            setExpandedId(null);
                          } else {
                            setExpandedId(null);
                          }
                        }}
                      >
                        <X size={13} />
                      </Button>
                    )}
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(q.id)}
                      aria-label={isSelected ? "取消选择题目" : "选择题目"}
                      className="h-4 w-4 rounded"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                }
                actions={
                  onEditQuestion ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-xs text-muted-foreground hover:text-blue-600 sm:px-2 dark:hover:text-blue-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditQuestion(q);
                      }}
                    >
                      <Pencil size={13} className="sm:mr-1" />
                      <span className="hidden sm:inline">编辑题目</span>
                    </Button>
                  ) : undefined
                }
              />
            </div>
          );
        })}

        {hasMore ? (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"
          >
            <LoaderCircle size={15} className="animate-spin text-muted-foreground" />
            正在加载更多题目...
          </div>
        ) : questions.length > 20 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            已加载全部 {total} 道题目
          </div>
        ) : null}
        </>
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
        <div className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={handleScroll}>
          {isLoading && questions.length === 0 ? (
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
              {questions.map((q, idx) => {
                const isSelected = selectedSet.has(q.id);
                return (
                  <div
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    className="cursor-pointer rounded-lg outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={(event) => {
                      if (shouldIgnoreCardToggle(event.target, event.currentTarget)) return;
                      toggle(q.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (shouldIgnoreCardToggle(event.target, event.currentTarget)) return;
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
                        index={idx + 1}
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
                        actions={
                          onEditQuestion ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditQuestion(q)}
                            >
                              <Pencil size={14} />
                              编辑题目
                            </Button>
                          ) : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })}

              {hasMore ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <LoaderCircle size={15} className="animate-spin text-muted-foreground" />
                  正在加载更多题目...
                </div>
              ) : questions.length > 20 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  已加载全部 {total} 道题目
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        fillAvailableHeight
          ? "flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden"
          : "space-y-4",
      )}
    >
      {/* Summary */}
      <div className="shrink-0">
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
      </div>

      {/* Filters */}
      <div className="shrink-0">{renderFilters()}</div>

      {/* Toolbar: 全局展开/收起与统计 */}
      {questions.length > 0 && (
        <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
          <span>共 {total} 道题目</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAllQuestionsExpanded((prev) => !prev)}
          >
            {allQuestionsExpanded ? "全部收起" : "全部展开"}
          </Button>
        </div>
      )}

      {/* Question List */}
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto pr-1")}
        onScroll={handleScroll}
      >
        {renderQuestionList()}
      </div>

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
