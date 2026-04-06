import { useList, useCreate, useDelete, useInvalidate, useNavigation, useUpdate } from "@refinedev/core";
import type { CrudFilter } from "@refinedev/core";
import type { IQuestion, IQuestionBank, ITag, QuestionType } from "../../types";
import { Search, BookOpen, Pencil, Trash2, Plus, ChevronDown, ChevronUp, Library, Check, PackageOpen, EllipsisVertical, Tag, GraduationCap, SlidersHorizontal, ChevronsDownUp, ChevronsUpDown, Link2, Save, ChevronRight } from "lucide-react";
import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { CodeBlock } from "@/components/ui/code-block";
import { RichContent } from "@/components/ui/rich-content";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";

const questionTypeChar: Record<QuestionType, string> = {
  choice: "选",
  true_false: "判",
  fill_in: "填",
  short_answer: "简",
  essay: "论",
  code: "编",
};

const questionTypeColorClass: Record<QuestionType, string> = {
  choice: "bg-blue-500 text-white",
  true_false: "bg-teal-500 text-white",
  fill_in: "bg-purple-500 text-white",
  short_answer: "bg-orange-500 text-white",
  essay: "bg-pink-500 text-white",
  code: "bg-emerald-500 text-white",
};

const difficultyConfig: Record<
  number,
  { label: string; variant: BadgeProps["variant"] }
> = {
  1: { label: "容易", variant: "success" },
  2: { label: "较易", variant: "secondary" },
  3: { label: "一般", variant: "outline" },
  4: { label: "难", variant: "warning" },
  5: { label: "很难", variant: "destructive" },
};

// Sidebar filter type items: split "choice" into single/multi, add others
type FilterTypeKey = "single_choice" | "multi_choice" | "true_false" | "fill_in" | "short_answer" | "essay" | "code";

const FILTER_TYPE_ITEMS: { key: FilterTypeKey; label: string; backendType: QuestionType }[] = [
  { key: "single_choice", label: "单选题", backendType: "choice" },
  { key: "multi_choice", label: "多选题", backendType: "choice" },
  { key: "true_false", label: "判断题", backendType: "true_false" },
  { key: "fill_in", label: "填空题", backendType: "fill_in" },
  { key: "short_answer", label: "简答题", backendType: "short_answer" },
  { key: "essay", label: "论述题", backendType: "essay" },
  { key: "code", label: "编程题", backendType: "code" },
];

const ALL_FILTER_TYPE_KEYS = new Set<FilterTypeKey>(FILTER_TYPE_ITEMS.map((i) => i.key));
const ALL_DIFFICULTIES = [1, 2, 3, 4, 5];
const ALL_DIFFICULTY_SET = new Set(ALL_DIFFICULTIES);

function renderTitle(question: IQuestion) {
  if (question.content?.text) {
    return String(question.content.text);
  }
  return question.title;
}

function getContentHtml(question: IQuestion): string | null {
  if (question.content?.html) {
    return String(question.content.html);
  }
  return null;
}


function isMultiChoice(question: IQuestion): boolean {
  return question.type === "choice" && Array.isArray(question.answer?.correct);
}

function renderAnswer(question: IQuestion): string {
  const answer = question.answer;
  if (question.type === "choice") {
    const correct = answer.correct;
    if (Array.isArray(correct)) return [...correct].sort().join("、") || "-";
    return String(correct ?? "-");
  }
  if (question.type === "true_false")
    return answer.correct === true ? "正确" : "错误";
  if (question.type === "fill_in") {
    const correct = answer.correct;
    if (Array.isArray(correct)) return correct.map((v, i) => `空${i + 1}: ${v}`).join("；") || "-";
    return String(correct ?? "-");
  }
  if (question.type === "short_answer" || question.type === "essay") {
    const pts = (answer.points ?? answer.key_points) as string[] | undefined;
    if (Array.isArray(pts) && pts.length > 0) return pts.join("；");
    return String(answer.correct ?? "-");
  }
  // code type handled separately via CodeBlock
  return "";
}

/** Render text that may contain ```code``` fences with syntax highlighting */
function RenderTextWithCode({ text, language }: { text: string; language?: string }) {
  // Split on markdown code fences: ```lang\n...\n```
  const parts = text.split(/(```[\s\S]*?```)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const fenceMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
        if (fenceMatch) {
          const lang = fenceMatch[1] || language || "python";
          const code = fenceMatch[2].trim();
          return <CodeBlock key={i} code={code} language={lang} />;
        }
        return part ? <span key={i}>{part}</span> : null;
      })}
    </>
  );
}

/** Render code answer block for code-type questions */
function renderCodeAnswer(question: IQuestion) {
  if (question.type !== "code") return null;
  const code = question.answer?.code as string | undefined;
  const language = (question.content?.language as string) || "python";
  return (
    <div className="mt-1.5">
      <p className="text-sm text-muted-foreground mb-1">参考代码：</p>
      {code ? (
        <CodeBlock code={code} language={language} />
      ) : (
        <p className="text-sm text-muted-foreground">无</p>
      )}
    </div>
  );
}

function renderOptions(question: IQuestion) {
  if (question.type !== "choice" || !question.options) return null;
  const opts = question.options as Record<string, string>;
  const entries = Object.entries(opts);
  // Determine layout based on max option text length
  const maxLen = Math.max(...entries.map(([, v]) => v.length));
  // long text (>30): 1 per row; medium (>10): 2 per row; short: 4 per row (flex wrap)
  const layoutClass =
    maxLen > 30
      ? "grid grid-cols-1 gap-y-0.5"
      : maxLen > 10
        ? "grid grid-cols-2 gap-x-6 gap-y-0.5"
        : "flex flex-wrap gap-x-8 gap-y-0.5";
  return (
    <div className={`mt-1.5 ${layoutClass}`}>
      {entries.map(([key, value]) => (
        <span key={key} className="text-sm text-muted-foreground">
          {key}. {value}
        </span>
      ))}
    </div>
  );
}

function generatePaginationPages(
  current: number,
  total: number
): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

/** Toggle item component with a check indicator */
function ToggleItem({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
        checked
          ? "text-muted-foreground"
          : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/40"
        }`}
      >
        {checked && <Check size={12} />}
      </span>
      {label}
    </button>
  );
}

const PAGE_SIZE = 10;

type KnowledgeMajor = {
  id: string;
  name: string;
  description: string | null;
};

type KnowledgeDirection = {
  id: string;
  major_id: string;
  name: string;
  description: string | null;
};

type KnowledgeTreeNode = {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  direction_id: string | null;
};

async function knowledgeApiFetch<T>(url: string): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export function QuestionList() {
  const [current, setCurrent] = useState(1);
  const [filters, setFilters] = useState<CrudFilter[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagSearch, setTagSearch] = useState("");

  // Active sidebar filter values (multi-select)
  const [activeQuestionBankId, setActiveQuestionBankId] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<FilterTypeKey>>(new Set(ALL_FILTER_TYPE_KEYS));
  const [activeDifficulties, setActiveDifficulties] = useState<Set<number>>(new Set(ALL_DIFFICULTY_SET));
  const [activeTagIds, setActiveTagIds] = useState<Set<string>>(new Set());

  // Whether "all tags" is selected (true = no tag filter)
  const [allTagsSelected, setAllTagsSelected] = useState(true);
  // Tag type filter: "all" | "standard" | "custom"
  const [tagTypeFilter, setTagTypeFilter] = useState<"all" | "standard" | "custom">("all");
  // Collapsible sections
  const [typesExpanded, setTypesExpanded] = useState(false);
  const [difficultyExpanded, setDifficultyExpanded] = useState(false);

  // 卡片展开/收缩（hover 延时 500ms）
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  // 移动端筛选面板
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // 新建题库对话框
  const [createBankOpen, setCreateBankOpen] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [newBankDesc, setNewBankDesc] = useState("");

  // 删除题库确认对话框
  const [deleteBankTarget, setDeleteBankTarget] = useState<IQuestionBank | null>(null);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<IQuestion | null>(null);
  const [knowledgeDialogQuestion, setKnowledgeDialogQuestion] = useState<IQuestion | null>(null);
  const [selectedKnowledgePointIds, setSelectedKnowledgePointIds] = useState<Set<string>>(new Set());
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeMajors, setKnowledgeMajors] = useState<KnowledgeMajor[]>([]);
  const [knowledgeDirections, setKnowledgeDirections] = useState<KnowledgeDirection[]>([]);
  const [knowledgeTreeNodes, setKnowledgeTreeNodes] = useState<KnowledgeTreeNode[]>([]);
  const [knowledgeTreeLoading, setKnowledgeTreeLoading] = useState(false);
  const [knowledgeTreeError, setKnowledgeTreeError] = useState<string | null>(null);
  const [expandedMajors, setExpandedMajors] = useState<Set<string>>(new Set());
  const [expandedDirections, setExpandedDirections] = useState<Set<string>>(new Set());
  const [expandedKnowledgeNodes, setExpandedKnowledgeNodes] = useState<Set<string>>(new Set());

  const updateFilters = useCallback((newFilters: CrudFilter[]) => {
    setFilters(newFilters);
    setCurrent(1);
  }, []);

  // Rebuild all filters from current state
  const rebuildFilters = useCallback(
    (
      searchVal: string,
      bankId: string | null,
      types: Set<FilterTypeKey>,
      difficulties: Set<number>,
      tagIds: Set<string>,
      allTags: boolean,
    ) => {
      const next: CrudFilter[] = [];

      // Search
      if (searchVal) {
        next.push({ field: "title", operator: "contains", value: searchVal } as CrudFilter);
      }

      // Question bank
      if (bankId) {
        next.push({ field: "question_bank_id", operator: "eq", value: bankId } as CrudFilter);
      }

      // Types — dedupe FilterTypeKey -> backend QuestionType
      if (types.size > 0 && types.size < ALL_FILTER_TYPE_KEYS.size) {
        const backendTypes = new Set<string>();
        for (const key of types) {
          const item = FILTER_TYPE_ITEMS.find((i) => i.key === key);
          if (item) backendTypes.add(item.backendType);
        }
        if (backendTypes.size > 0) {
          next.push({ field: "type", operator: "in", value: [...backendTypes].join(",") } as CrudFilter);
        }
      }

      // Difficulties
      if (difficulties.size > 0 && difficulties.size < ALL_DIFFICULTY_SET.size) {
        next.push({ field: "difficulty", operator: "in", value: [...difficulties].join(",") } as CrudFilter);
      }

      // Tags
      if (!allTags && tagIds.size > 0) {
        next.push({ field: "tag_id", operator: "eq", value: [...tagIds].join(",") } as CrudFilter);
      }

      updateFilters(next);
    },
    [updateFilters],
  );

  // Disable query when no types or no difficulties selected — result must be empty
  const hasEmptyFilter = activeTypes.size === 0 || activeDifficulties.size === 0;

  const { query: listQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: current, pageSize: PAGE_SIZE, mode: "server" },
    sorters: [{ field: "updated_at", order: "desc" }],
    filters,
    queryOptions: { enabled: !hasEmptyFilter },
  });

  // Sidebar data
  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const { query: tagsQuery } = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: 1, pageSize: 1000 },
    filters: activeQuestionBankId
      ? [{ field: "question_bank_id", operator: "eq", value: activeQuestionBankId }]
      : [],
  });
  const data = hasEmptyFilter ? undefined : listQuery.data;
  const isLoading = !hasEmptyFilter && listQuery.isLoading;
  const pageCount = Math.ceil((data?.total ?? 0) / PAGE_SIZE) || 1;

  const { mutate: deleteQuestion } = useDelete();
  const { mutate: createBank } = useCreate();
  const { mutate: deleteBank } = useDelete();
  const { mutate: updateQuestion, mutation: updateQuestionMutation } = useUpdate();
  const invalidate = useInvalidate();
  const { create, edit } = useNavigation();

  const refreshBanks = () => invalidate({ resource: "question-banks", invalidates: ["list"] });
  const refreshQuestions = () => invalidate({ resource: "questions", invalidates: ["list"] });
  // Client-side filtering for single/multi choice distinction
  // (backend only has "choice" type, can't distinguish single vs multi)
  const rawQuestions = data?.data ?? [];
  const needChoiceFilter =
    activeTypes.size < ALL_FILTER_TYPE_KEYS.size &&
    (activeTypes.has("single_choice") !== activeTypes.has("multi_choice"));
  const questions = needChoiceFilter
    ? rawQuestions.filter((q) => {
        if (q.type !== "choice") return true;
        const isMulti = isMultiChoice(q);
        if (isMulti) return activeTypes.has("multi_choice");
        return activeTypes.has("single_choice");
      })
    : rawQuestions;
  const total = hasEmptyFilter ? 0 : (data?.total ?? 0);
  const banks = banksQuery.data?.data ?? [];
  const noBankCount: number = (banksQuery.data as Record<string, unknown>)?.meta
    ? ((banksQuery.data as Record<string, unknown>).meta as Record<string, number>).noBankCount ?? 0
    : 0;
  const tags = tagsQuery.data?.data ?? [];
  const knowledgeChildrenMap = knowledgeTreeNodes.reduce<Record<string, KnowledgeTreeNode[]>>((acc, node) => {
    const parentKey = node.parent_id ?? "__root__";
    acc[parentKey] ??= [];
    acc[parentKey].push(node);
    return acc;
  }, {});
  const knowledgeSearchKeyword = knowledgeSearch.trim().toLowerCase();

  const matchKnowledgeText = useCallback(
    (value: string | null | undefined): boolean => {
      if (!knowledgeSearchKeyword) {
        return true;
      }
      return (value ?? "").toLowerCase().includes(knowledgeSearchKeyword);
    },
    [knowledgeSearchKeyword],
  );

  const matchKnowledgeNode = useCallback(
    (node: KnowledgeTreeNode): boolean => matchKnowledgeText(node.name) || matchKnowledgeText(node.description),
    [matchKnowledgeText],
  );

  const hasMatchedDescendant = useCallback(
    (nodeId: string): boolean => {
      const children = knowledgeChildrenMap[nodeId] ?? [];
      return children.some((child) => matchKnowledgeNode(child) || hasMatchedDescendant(child.id));
    },
    [knowledgeChildrenMap, matchKnowledgeNode],
  );

  const hasDirectionMatch = useCallback(
    (directionId: string): boolean => {
      const direction = knowledgeDirections.find((item) => item.id === directionId);
      if (direction && (matchKnowledgeText(direction.name) || matchKnowledgeText(direction.description))) {
        return true;
      }
      const roots = (knowledgeChildrenMap["__root__"] ?? []).filter((node) => node.direction_id === directionId);
      return roots.some((node) => matchKnowledgeNode(node) || hasMatchedDescendant(node.id));
    },
    [hasMatchedDescendant, knowledgeChildrenMap, knowledgeDirections, matchKnowledgeNode, matchKnowledgeText],
  );

  const hasMajorMatch = useCallback(
    (majorId: string): boolean => {
      const major = knowledgeMajors.find((item) => item.id === majorId);
      if (major && (matchKnowledgeText(major.name) || matchKnowledgeText(major.description))) {
        return true;
      }
      return knowledgeDirections
        .filter((direction) => direction.major_id === majorId)
        .some((direction) => hasDirectionMatch(direction.id));
    },
    [hasDirectionMatch, knowledgeDirections, knowledgeMajors, matchKnowledgeText],
  );

  const isCardExpanded = (id: string) => allExpanded || hoveredCard === id;

  const handleSearch = (value: string) => {
    setSearch(value);
    rebuildFilters(value, activeQuestionBankId, activeTypes, activeDifficulties, activeTagIds, allTagsSelected);
  };

  const handleBankFilter = (bankId: string | null) => {
    if (bankId === activeQuestionBankId) return; // already selected
    setActiveQuestionBankId(bankId);
    // Reset dependent filters when bank changes
    setActiveTypes(new Set(ALL_FILTER_TYPE_KEYS));
    setActiveDifficulties(new Set(ALL_DIFFICULTY_SET));
    setActiveTagIds(new Set());
    setAllTagsSelected(true);
    rebuildFilters(search, bankId, new Set(ALL_FILTER_TYPE_KEYS), new Set(ALL_DIFFICULTY_SET), new Set(), true);
  };

  // --- Type multi-select ---
  const handleToggleType = (key: FilterTypeKey) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      rebuildFilters(search, activeQuestionBankId, next, activeDifficulties, activeTagIds, allTagsSelected);
      return next;
    });
  };

  const handleToggleAllTypes = () => {
    const allSelected = activeTypes.size === ALL_FILTER_TYPE_KEYS.size;
    const next = allSelected ? new Set<FilterTypeKey>() : new Set(ALL_FILTER_TYPE_KEYS);
    setActiveTypes(next);
    rebuildFilters(search, activeQuestionBankId, next, activeDifficulties, activeTagIds, allTagsSelected);
  };

  // --- Difficulty multi-select ---
  const handleToggleDifficulty = (level: number) => {
    setActiveDifficulties((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      rebuildFilters(search, activeQuestionBankId, activeTypes, next, activeTagIds, allTagsSelected);
      return next;
    });
  };

  const handleToggleAllDifficulties = () => {
    const allSelected = activeDifficulties.size === ALL_DIFFICULTY_SET.size;
    const next = allSelected ? new Set<number>() : new Set(ALL_DIFFICULTY_SET);
    setActiveDifficulties(next);
    rebuildFilters(search, activeQuestionBankId, activeTypes, next, activeTagIds, allTagsSelected);
  };

  // --- Tag multi-select ---
  const handleToggleTag = (tagId: string) => {
    setAllTagsSelected(false);
    setActiveTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      // If all tags manually selected, treat as "all"
      const isAll = tags.length > 0 && next.size === tags.length;
      if (isAll) {
        setAllTagsSelected(true);
      }
      rebuildFilters(search, activeQuestionBankId, activeTypes, activeDifficulties, next, isAll);
      return next;
    });
  };

  const handleToggleAllTags = () => {
    const newAll = !allTagsSelected;
    setAllTagsSelected(newAll);
    const next = newAll ? new Set<string>() : new Set<string>();
    setActiveTagIds(next);
    rebuildFilters(search, activeQuestionBankId, activeTypes, activeDifficulties, next, newAll);
  };

  const handleDelete = (question: IQuestion) => {
    setDeleteQuestionTarget(question);
  };

  const handleOpenKnowledgeDialog = (question: IQuestion) => {
    setKnowledgeDialogQuestion(question);
    setSelectedKnowledgePointIds(new Set(question.knowledge_points.map((kp) => kp.id)));
    setKnowledgeSearch("");
  };

  const handleToggleKnowledgePoint = (knowledgePointId: string) => {
    setSelectedKnowledgePointIds((prev) => {
      const next = new Set(prev);
      if (next.has(knowledgePointId)) {
        next.delete(knowledgePointId);
      } else {
        next.add(knowledgePointId);
      }
      return next;
    });
  };

  const handleSaveKnowledgePoints = () => {
    if (!knowledgeDialogQuestion) {
      return;
    }
    updateQuestion(
      {
        resource: "questions",
        id: knowledgeDialogQuestion.id,
        values: {
          knowledge_point_ids: [...selectedKnowledgePointIds],
        },
      },
      {
        onSuccess: () => {
          refreshQuestions();
          setKnowledgeDialogQuestion(null);
        },
      },
    );
  };

  const toggleMajorExpanded = (majorId: string) => {
    setExpandedMajors((prev) => {
      const next = new Set(prev);
      if (next.has(majorId)) {
        next.delete(majorId);
      } else {
        next.add(majorId);
      }
      return next;
    });
  };

  const toggleDirectionExpanded = (directionId: string) => {
    setExpandedDirections((prev) => {
      const next = new Set(prev);
      if (next.has(directionId)) {
        next.delete(directionId);
      } else {
        next.add(directionId);
      }
      return next;
    });
  };

  const toggleKnowledgeNodeExpanded = (nodeId: string) => {
    setExpandedKnowledgeNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!knowledgeDialogQuestion) {
      return;
    }

    let cancelled = false;
    const loadKnowledgeTree = async () => {
      setKnowledgeTreeLoading(true);
      setKnowledgeTreeError(null);
      try {
        const majors = await knowledgeApiFetch<KnowledgeMajor[]>("/api/knowledge/majors");
        const directionGroups = await Promise.all(
          majors.map((major) => knowledgeApiFetch<KnowledgeDirection[]>(`/api/knowledge/majors/${major.id}/directions`)),
        );
        const directions = directionGroups.flat();
        const trees = await Promise.all(
          directions.map((direction) =>
            knowledgeApiFetch<{ nodes: Array<{ data: KnowledgeTreeNode }> }>(`/api/knowledge/directions/${direction.id}/tree`),
          ),
        );
        const nextNodes = trees.flatMap((tree) => tree.nodes.map((node) => node.data));

        if (cancelled) {
          return;
        }

        setKnowledgeMajors(majors);
        setKnowledgeDirections(directions);
        setKnowledgeTreeNodes(nextNodes);
        setExpandedMajors(new Set(majors.map((major) => major.id)));
        setExpandedDirections(new Set(directions.map((direction) => direction.id)));
        setExpandedKnowledgeNodes(
          new Set(
            nextNodes
              .filter((node) => nextNodes.some((candidate) => candidate.parent_id === node.id))
              .map((node) => node.id),
          ),
        );
      } catch (error) {
        if (!cancelled) {
          setKnowledgeTreeError(error instanceof Error ? error.message : "加载知识树失败");
        }
      } finally {
        if (!cancelled) {
          setKnowledgeTreeLoading(false);
        }
      }
    };

    void loadKnowledgeTree();

    return () => {
      cancelled = true;
    };
  }, [knowledgeDialogQuestion]);

  const renderKnowledgeTreeNodes = (directionId: string, parentId: string | null = null, depth = 0): ReactNode => {
    const children = (knowledgeChildrenMap[parentId ?? "__root__"] ?? [])
      .filter((node) => node.direction_id === directionId)
      .filter((node) => matchKnowledgeNode(node) || hasMatchedDescendant(node.id));

    if (children.length === 0) {
      return null;
    }

    return (
      <>
        {children.map((node) => {
          const checked = selectedKnowledgePointIds.has(node.id);
          const childNodes = (knowledgeChildrenMap[node.id] ?? [])
            .filter((child) => child.direction_id === directionId)
            .filter((child) => matchKnowledgeNode(child) || hasMatchedDescendant(child.id));
          const hasChildren = childNodes.length > 0;
          const isExpanded = knowledgeSearchKeyword ? true : expandedKnowledgeNodes.has(node.id);
          const descendants = hasChildren && isExpanded ? renderKnowledgeTreeNodes(directionId, node.id, depth + 1) : null;
          return (
            <div key={node.id} className="space-y-1">
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleToggleKnowledgePoint(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleToggleKnowledgePoint(node.id);
                  }
                }}
                className={`relative flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  checked
                    ? "bg-primary/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)]"
                    : "hover:bg-muted/70"
                }`}
                style={{ marginLeft: depth * 20 }}
              >
                {depth > 0 && (
                  <>
                    <span className="pointer-events-none absolute top-0 h-full w-px bg-border/60" style={{ left: -10 }} />
                    <span className="pointer-events-none absolute h-px w-3 bg-border/60" style={{ left: -10, top: 18 }} />
                  </>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) {
                      toggleKnowledgeNodeExpanded(node.id);
                    }
                  }}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground ${
                    hasChildren ? "hover:bg-background hover:text-foreground" : ""
                  }`}
                >
                  {hasChildren ? (
                    isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                  )}
                </button>
                <Checkbox
                  checked={checked}
                  className="mt-0.5"
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => handleToggleKnowledgePoint(node.id)}
                />
                <div className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-0.5 hover:border-border/60">
                  <p className="text-sm font-medium text-foreground">{node.name}</p>
                </div>
              </div>
              {descendants}
            </div>
          );
        })}
      </>
    );
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  const toggleSelectAll = () => {
    if (selected.size === questions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(questions.map((q) => q.id)));
    }
  };

  const paginationPages = generatePaginationPages(current, pageCount);

  /* Filter sidebar content — shared between desktop aside & mobile dialog */
  const filterContent = (
    <div className="space-y-3">
      {/* 题库 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Library size={14} />
            题库
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setNewBankName("");
                  setNewBankDesc("");
                  setCreateBankOpen(true);
                }}
                className="p-0.5 rounded text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>新建题库</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="max-h-60 overflow-y-hidden hover:overflow-y-auto -mx-1">
          <button
            type="button"
            onClick={() => handleBankFilter(null)}
            className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              activeQuestionBankId === null
                ? "bg-primary/10 text-primary font-medium"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <Library size={14} className="shrink-0" />
            <span className="flex-1 min-w-0 flex items-center gap-1.5">
              全部题库
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                {noBankCount + banks.reduce((s, b) => s + b.question_count, 0)}
              </Badge>
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleBankFilter("__none__")}
            className={`group flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              activeQuestionBankId === "__none__"
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <PackageOpen size={14} className="shrink-0" />
            <span className="flex-1 min-w-0 flex items-center gap-1.5">
              未在题库
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                {noBankCount}
              </Badge>
            </span>
          </button>
          {banks.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">暂无题库</p>
          ) : (
            banks.map((bank) => {
              const isActive = activeQuestionBankId === bank.id;
              return (
                <div
                  key={bank.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleBankFilter(bank.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleBankFilter(bank.id); }}
                  className={`group flex items-center w-full text-left px-3 py-2 rounded-md cursor-pointer transition-colors ${
                    isActive
                      ? "bg-primary/10"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className={`flex-1 min-w-0 ${bank.description ? "" : "flex items-center"}`}>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm truncate ${isActive ? "text-primary font-medium" : "text-foreground"}`}>
                        {bank.name}
                      </p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        {bank.question_count}
                      </Badge>
                    </div>
                    {bank.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {bank.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteBankTarget(bank);
                    }}
                    className="shrink-0 ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    title="删除该题库所有题目"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Separator />

      {/* 题型 — collapsible */}
      <div>
        <button
          type="button"
          onClick={() => setTypesExpanded((v) => !v)}
          className="flex items-center justify-between w-full mb-1"
        >
          <p className="text-sm font-medium text-foreground">题型</p>
          {typesExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
        {typesExpanded && (
          <>
            <ToggleItem
              checked={activeTypes.size === ALL_FILTER_TYPE_KEYS.size}
              label="全部"
              onClick={handleToggleAllTypes}
            />
            <div className="grid grid-cols-2 gap-x-1">
              {FILTER_TYPE_ITEMS.map((item) => (
                <ToggleItem
                  key={item.key}
                  checked={activeTypes.has(item.key)}
                  label={item.label}
                  onClick={() => handleToggleType(item.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Separator />

      {/* 难度 — collapsible */}
      <div>
        <button
          type="button"
          onClick={() => setDifficultyExpanded((v) => !v)}
          className="flex items-center justify-between w-full mb-1"
        >
          <p className="text-sm font-medium text-foreground">难度</p>
          {difficultyExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
        {difficultyExpanded && (
          <>
            <ToggleItem
              checked={activeDifficulties.size === ALL_DIFFICULTY_SET.size}
              label="所有"
              onClick={handleToggleAllDifficulties}
            />
            <div className="grid grid-cols-3 gap-x-1">
              {ALL_DIFFICULTIES.map((level) => (
                <ToggleItem
                  key={level}
                  checked={activeDifficulties.has(level)}
                  label={difficultyConfig[level].label}
                  onClick={() => handleToggleDifficulty(level)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Separator />

      {/* 标签 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-foreground">标签</p>
          <div className="flex items-center rounded-md border border-border text-[11px] overflow-hidden">
            {([["all", "全部"], ["standard", "标准"], ["custom", "自定义"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTagTypeFilter(key)}
                className={`px-2 py-0.5 transition-colors ${
                  tagTypeFilter === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative mb-2">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-7 h-7 text-xs"
            placeholder="搜索标签..."
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
          <button
            type="button"
            onClick={handleToggleAllTags}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors border ${
              allTagsSelected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            全部
          </button>
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-1">暂无标签</p>
          ) : (
            tags
              .filter((tag) => {
                if (tagTypeFilter === "standard" && tag.type === "custom") return false;
                if (tagTypeFilter === "custom" && tag.type !== "custom") return false;
                if (tagSearch && !tag.name.toLowerCase().includes(tagSearch.toLowerCase())) return false;
                return true;
              })
              .map((tag) => {
                const isActive = !allTagsSelected && activeTagIds.has(tag.id);
                const isCustom = tag.type === "custom";
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleToggleTag(tag.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors border ${
                      isActive
                        ? isCustom
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-primary text-primary-foreground border-primary"
                        : isCustom
                          ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {tag.name}
                    <span
                      className={`text-[10px] ${
                        isActive ? "opacity-80" : "opacity-50"
                      }`}
                    >
                      {tag.question_count}
                    </span>
                  </button>
                );
              })
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-bold text-foreground tracking-tight">
            题库管理
          </h1>
          <p className="text-sm text-muted-foreground hidden sm:block">
            管理考试题目、标签与知识点
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile filter button */}
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={() => setMobileFilterOpen(true)}
          >
            <SlidersHorizontal size={16} />
          </Button>
          <div className="relative flex-1 sm:flex-none">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9 w-full sm:w-60"
              placeholder="搜索题目标题..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Button className="shrink-0" onClick={() => create("questions")}>
            <Plus size={16} />
            <span className="hidden sm:inline">新建题目</span>
          </Button>
        </div>
      </div>

      {/* Two-column layout: sidebar left, list right */}
      <div className="flex gap-6">
        {/* Left: sidebar filters (desktop only) */}
        <aside className="hidden lg:block w-64 shrink-0">
          <Card>
            <CardContent className="p-4">
              <TooltipProvider>
                {filterContent}
              </TooltipProvider>
            </CardContent>
          </Card>
        </aside>

        {/* Right: question list */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Select all + total count */}
          <div className="flex items-center justify-between px-1">
            {questions.length > 0 ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={
                    selected.size === questions.length && questions.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-muted-foreground">
                  {selected.size > 0 ? `已选择 ${selected.size} 题` : "全选"}
                </span>
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                共 {total} 道题目
              </span>
              <button
                type="button"
                onClick={() => setAllExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                title={allExpanded ? "收缩全部" : "展开全部"}
              >
                {allExpanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
                <span className="hidden sm:inline">{allExpanded ? "收缩" : "展开"}</span>
              </button>
            </div>
          </div>

          {/* Cards */}
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <span className="inline-block h-5 w-5 border-2 border-border border-t-foreground rounded-full animate-spin mr-2 align-middle" />
              加载中...
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen size={40} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">暂无题目数据</p>
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((question, idx) => {
                const diff = difficultyConfig[question.difficulty] ?? {
                  label: String(question.difficulty),
                  variant: "outline" as const,
                };
                const globalIndex = (current - 1) * PAGE_SIZE + idx + 1;
                const answerText = renderAnswer(question);

                return (
                  <div
                    key={question.id}
                    className="flex gap-2 rounded-lg border border-border bg-card p-3 sm:p-4 transition-all hover:border-primary hover:shadow-md"
                    onMouseEnter={() => {
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                      hoverTimerRef.current = setTimeout(() => setHoveredCard(question.id), 500);
                    }}
                    onMouseLeave={() => {
                      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
                      setHoveredCard(null);
                    }}
                  >
                    {/* Left: index number */}
                    <div className="flex-shrink-0 w-5 pt-0.5 text-sm font-bold text-muted-foreground text-left">
                      {globalIndex}.
                    </div>

                    {/* Right: all content */}
                    <div className="flex-1 min-w-0">
                      {/* Title row with type badge + checkbox on the right */}
                      <div className="flex items-start gap-2">
                        {(() => {
                          const html = getContentHtml(question);
                          if (html) {
                            return (
                              <RichContent
                                html={html}
                                className="flex-1 text-sm text-foreground leading-relaxed"
                              />
                            );
                          }
                          return (
                            <p className="flex-1 text-sm text-foreground leading-relaxed">
                              {renderTitle(question)}
                            </p>
                          );
                        })()}
                        <div className="flex-shrink-0 flex items-center gap-2 ml-2">
                          <div
                            className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold ${
                              question.type === "choice" && isMultiChoice(question)
                                ? "bg-cyan-500 text-white"
                                : questionTypeColorClass[question.type]
                            }`}
                          >
                            {question.type === "choice"
                              ? isMultiChoice(question)
                                ? "多"
                                : "单"
                              : questionTypeChar[question.type]}
                          </div>
                          <Checkbox
                            checked={selected.has(question.id)}
                            onCheckedChange={() => toggleSelect(question.id)}
                          />
                        </div>
                      </div>

                      {renderOptions(question)}
                      {answerText !== "" && (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {question.type === "short_answer" || question.type === "essay" ? "答案要点：" : "答案："}
                          {answerText}
                        </p>
                      )}

                      {/* Expandable details with smooth transition */}
                      <div
                        className="grid transition-[grid-template-rows] duration-300 ease-out"
                        style={{ gridTemplateRows: isCardExpanded(question.id) ? "1fr" : "0fr" }}
                      >
                        <div className="overflow-hidden">
                      {renderCodeAnswer(question)}
                      {question.analysis && (
                        <div className="mt-1.5 text-sm text-muted-foreground">
                          <span className="text-xs text-muted-foreground/70">解析：</span>
                          {question.analysis.startsWith("<") ? (
                            <RichContent html={question.analysis} />
                          ) : (
                            <RenderTextWithCode text={question.analysis} language={(question.content?.language as string) || undefined} />
                          )}
                        </div>
                      )}

                      {/* Bottom: metadata left, actions right */}
                      <div className="mt-2.5 flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={diff.variant}>{diff.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {question.score} 分
                          </span>
                          <span className="hidden sm:inline text-xs text-muted-foreground">
                            {new Date(question.created_at).toLocaleDateString(
                              "zh-CN",
                              {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              }
                            )}
                          </span>
                          <span className="hidden sm:inline text-xs text-muted-foreground">
                            已使用 {question.usage_count} 次
                          </span>
                          {question.tags.length > 0 && (
                            <>
                              <span className="h-3.5 w-px bg-border" />
                              <span className="text-emerald-600 dark:text-emerald-400">
                                <Tag size={11} />
                              </span>
                              {question.tags.slice(0, 4).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  variant="outline"
                                  className="text-[11px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800"
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                              {question.tags.length > 4 && (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center rounded p-0.5 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
                                      title="查看更多标签"
                                    >
                                      <EllipsisVertical size={14} />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto max-w-60 p-2" align="start">
                                    <div className="flex flex-wrap gap-1">
                                      {question.tags.slice(4).map((tag) => (
                                        <Badge
                                          key={tag.id}
                                          variant="outline"
                                          className="text-[11px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800"
                                        >
                                          {tag.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </>
                          )}
                          {question.knowledge_points.length > 0 && (
                            <>
                              <span className="h-3.5 w-px bg-border" />
                              <span className="text-indigo-600 dark:text-indigo-400">
                                <GraduationCap size={12} />
                              </span>
                              {question.knowledge_points.map((kp) => (
                                <Badge
                                  key={kp.id}
                                  variant="outline"
                                  className="text-[11px] px-1.5 py-0 bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-400 dark:border-indigo-800"
                                >
                                  {kp.name}
                                </Badge>
                              ))}
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0 ml-2 sm:ml-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                            onClick={() => handleOpenKnowledgeDialog(question)}
                          >
                            <Link2 size={13} className="sm:mr-1" />
                            <span className="hidden sm:inline">关联知识点</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                            onClick={() => edit("questions", question.id)}
                          >
                            <Pencil size={13} className="sm:mr-1" />
                            <span className="hidden sm:inline">编辑</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => handleDelete(question)}
                          >
                            <Trash2 size={13} className="sm:mr-1" />
                            <span className="hidden sm:inline">删除</span>
                          </Button>
                        </div>
                      </div>
                        </div>{/* end overflow-hidden */}
                      </div>{/* end grid transition */}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs sm:text-sm text-muted-foreground shrink-0">
                <span className="hidden sm:inline">显示 {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, total)} 条，</span>共 {total} 条
              </p>
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => {
                        if (current > 1) setCurrent(current - 1);
                      }}
                      className={
                        current <= 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                  {paginationPages.map((page, idx) =>
                    page === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${idx}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={page}>
                        <PaginationLink
                          isActive={page === current}
                          onClick={() => setCurrent(page)}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => {
                        if (current < pageCount) setCurrent(current + 1);
                      }}
                      className={
                        current >= pageCount
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
      </div>

      {/* 移动端筛选 Dialog */}
      <Dialog open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
        <DialogContent className="sm:max-w-sm max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>筛选条件</DialogTitle>
          </DialogHeader>
          <TooltipProvider>
            {filterContent}
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!knowledgeDialogQuestion}
        onOpenChange={(open) => {
          if (!open) {
            setKnowledgeDialogQuestion(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>关联知识点</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground line-clamp-2">
                {knowledgeDialogQuestion ? renderTitle(knowledgeDialogQuestion) : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                选择后会更新这道题目的知识点关联。
              </p>
            </div>

            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                placeholder="搜索专业、方向或知识点..."
                value={knowledgeSearch}
                onChange={(e) => setKnowledgeSearch(e.target.value)}
              />
            </div>

            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-medium">知识树</p>
                <p className="text-xs text-muted-foreground">
                  已选 {selectedKnowledgePointIds.size} 个
                </p>
              </div>
              <div className="max-h-[48vh] overflow-y-auto p-2">
                {knowledgeTreeLoading ? (
                  <div className="px-2 py-8 text-center text-sm text-muted-foreground">知识树加载中...</div>
                ) : knowledgeTreeError ? (
                  <div className="px-2 py-8 text-center text-sm text-destructive">{knowledgeTreeError}</div>
                ) : knowledgeMajors.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                    还没有可关联的知识结构
                  </div>
                ) : (
                  <div className="space-y-1">
                    {knowledgeMajors
                      .filter((major) => !knowledgeSearchKeyword || hasMajorMatch(major.id))
                      .map((major) => {
                        const majorDirections = knowledgeDirections.filter(
                          (direction) => direction.major_id === major.id && (!knowledgeSearchKeyword || hasDirectionMatch(direction.id)),
                        );
                        const majorExpanded = expandedMajors.has(major.id);

                        if (majorDirections.length === 0) {
                          return null;
                        }

                        return (
                          <div key={major.id} className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm">
                            <button
                              type="button"
                              onClick={() => toggleMajorExpanded(major.id)}
                              className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                            >
                              {majorExpanded ? (
                                <ChevronDown size={14} className="text-muted-foreground" />
                              ) : (
                                <ChevronRight size={14} className="text-muted-foreground" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-foreground">{major.name}</p>
                              </div>
                            </button>

                            {majorExpanded && (
                              <div className="border-t border-border/70 px-2 py-2">
                                <div className="space-y-2">
                                  {majorDirections.map((direction) => {
                                    const directionExpanded = expandedDirections.has(direction.id);
                                    const directionTree = renderKnowledgeTreeNodes(direction.id);
                                    if (!directionTree) {
                                      return null;
                                    }

                                    return (
                                      <div key={direction.id} className="overflow-hidden rounded-md border border-border/60 bg-background">
                                        <button
                                          type="button"
                                          onClick={() => toggleDirectionExpanded(direction.id)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                                        >
                                          {directionExpanded ? (
                                            <ChevronDown size={14} className="text-muted-foreground" />
                                          ) : (
                                            <ChevronRight size={14} className="text-muted-foreground" />
                                          )}
                                          <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-foreground">{direction.name}</p>
                                          </div>
                                        </button>

                                        {directionExpanded && (
                                          <div className="border-t border-border/50 bg-muted/20 px-2 py-2">
                                            {directionTree}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    {!knowledgeTreeLoading &&
                      !knowledgeTreeError &&
                      knowledgeMajors.filter((major) => !knowledgeSearchKeyword || hasMajorMatch(major.id)).length === 0 && (
                        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                          没有匹配的知识点
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!knowledgeDialogQuestion || updateQuestionMutation.isPending}
              onClick={handleSaveKnowledgePoints}
            >
              <Save size={14} />
              保存关联
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建题库 Dialog */}
      <Dialog open={createBankOpen} onOpenChange={setCreateBankOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建题库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">题库名称</label>
              <Input
                placeholder="请输入题库名称"
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBankName.trim()) {
                    createBank(
                      { resource: "question-banks", values: { name: newBankName.trim(), description: newBankDesc || null } },
                      { onSuccess: () => { refreshBanks(); setCreateBankOpen(false); } },
                    );
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">描述（可选）</label>
              <Input
                placeholder="请输入题库描述"
                value={newBankDesc}
                onChange={(e) => setNewBankDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!newBankName.trim()}
              onClick={() => {
                createBank(
                  { resource: "question-banks", values: { name: newBankName.trim(), description: newBankDesc || null } },
                  { onSuccess: () => { refreshBanks(); setCreateBankOpen(false); } },
                );
              }}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除题库 AlertDialog */}
      <AlertDialog open={!!deleteBankTarget} onOpenChange={(open) => { if (!open) setDeleteBankTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题库</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除题库「{deleteBankTarget?.name}」吗？其中的题目将移至"未在题库"，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteBankTarget) return;
                deleteBank(
                  { resource: "question-banks", id: deleteBankTarget.id },
                  {
                    onSuccess: () => {
                      if (activeQuestionBankId === deleteBankTarget.id) handleBankFilter(null);
                      refreshBanks();
                      refreshQuestions();
                      setDeleteBankTarget(null);
                    },
                  },
                );
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteQuestionTarget} onOpenChange={(open) => { if (!open) setDeleteQuestionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这道题目吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteQuestionTarget) {
                  return;
                }
                deleteQuestion(
                  { resource: "questions", id: deleteQuestionTarget.id },
                  { onSuccess: () => setDeleteQuestionTarget(null) },
                );
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
