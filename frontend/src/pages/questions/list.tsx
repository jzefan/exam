import { useList, useCreate, useDelete, useGetIdentity, useInvalidate, useNavigation, useUpdate } from "@refinedev/core";
import type { CrudFilter } from "@refinedev/core";
import type { IQuestion, IQuestionBank, ITag, QuestionType } from "../../types";
import { Search, BookOpen, Pencil, Trash2, Plus, ChevronDown, ChevronUp, Library, Check, PackageOpen, GraduationCap, SlidersHorizontal, Link2, Save, ChevronRight, Lock, Upload, Sparkles, Loader2, Eraser, AlertTriangle, FolderInput, FilePlus2 } from "lucide-react";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getUserRole } from "@/types/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  QuestionPreviewCard,
} from "@/components/questions/question-preview-card";
import { getQuestionTitle } from "@/components/questions/question-preview-utils";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearPersistedQuestionImportJobId,
  getQuestionKnowledgeRecognitionStatus,
  persistQuestionImportJobId,
  readPersistedQuestionImportJobId,
} from "./question-knowledge-recognition";
import {
  CreateFromSelectionDialog,
} from "./components/create-from-selection-dialog";
import type { QuestionImportJobResponse } from "./import-types";
import { getQuestionDeleteDescription } from "@/lib/deletion-copy";
import { formatMajorName } from "@/lib/knowledge-display";
import { getQuestionBankOwnerLabel } from "@/lib/question-banks";

const difficultyConfig: Record<
  number,
  { label: string; variant: BadgeProps["variant"] }
> = {
  1: { label: "容易", variant: "success" },
  2: { label: "较易", variant: "secondary" },
  3: { label: "中等", variant: "outline" },
  4: { label: "较难", variant: "warning" },
  5: { label: "很难", variant: "destructive" },
};

// Sidebar filter type items: split "choice" into single/multi, add others
type FilterTypeKey = "single_choice" | "multi_choice" | "true_false" | "fill_in" | "short_answer" | "essay" | "code";

type QuestionBankClearResult = {
  deleted: number;
  hard_deleted: number;
  soft_deleted: number;
};

type QuestionBulkMoveResult = {
  moved: number;
};

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

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

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

async function questionApiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export function QuestionList() {
  const { toast } = useToast();
  const { data: identity } = useGetIdentity<{ id?: string; primary_org?: { role_name?: string } | null }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeImportJobId, setActiveImportJobId] = useState<string | null>(() => {
    const importJobIdFromQuery = new URLSearchParams(window.location.search).get("import_job_id");
    return importJobIdFromQuery ?? readPersistedQuestionImportJobId();
  });
  const [activeImportJob, setActiveImportJob] = useState<QuestionImportJobResponse | null>(null);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<CrudFilter[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagSearch, setTagSearch] = useState("");

  // Active sidebar filter values (multi-select)
  const [activeQuestionBankId, setActiveQuestionBankId] = useState<string | null>(null);
  const [activeKnowledgePointId, setActiveKnowledgePointId] = useState<string | null>(
    searchParams.get("knowledge_point_id"),
  );
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

  // 移动端筛选面板
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // 新建题库对话框
  const [createBankOpen, setCreateBankOpen] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [newBankDesc, setNewBankDesc] = useState("");

  // 删除题库确认对话框
  const [deleteBankTarget, setDeleteBankTarget] = useState<IQuestionBank | null>(null);
  const [clearBankTarget, setClearBankTarget] = useState<IQuestionBank | null>(null);
  const [clearingBank, setClearingBank] = useState(false);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<IQuestion | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [moveQuestionTarget, setMoveQuestionTarget] = useState<IQuestion | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [moveTargetBankId, setMoveTargetBankId] = useState<string>("__none__");
  const [movingQuestions, setMovingQuestions] = useState(false);
  const [createFromSelectionOpen, setCreateFromSelectionOpen] = useState(false);
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
      knowledgePointId: string | null,
      types: Set<FilterTypeKey>,
      difficulties: Set<number>,
      tagIds: Set<string>,
      allTags: boolean,
    ) => {
      const next: CrudFilter[] = [];

      // Search
      if (searchVal) {
        next.push({ field: "search_text", operator: "contains", value: searchVal } as CrudFilter);
      }

      // Question bank
      if (bankId) {
        next.push({ field: "question_bank_id", operator: "eq", value: bankId } as CrudFilter);
      }

      if (knowledgePointId) {
        next.push({ field: "knowledge_point_id", operator: "eq", value: knowledgePointId } as CrudFilter);
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

  useEffect(() => {
    const knowledgePointId = searchParams.get("knowledge_point_id");
    setActiveKnowledgePointId(knowledgePointId);
    rebuildFilters(search, activeQuestionBankId, knowledgePointId, activeTypes, activeDifficulties, activeTagIds, allTagsSelected);
  }, [activeDifficulties, activeQuestionBankId, activeTagIds, activeTypes, allTagsSelected, rebuildFilters, search, searchParams]);

  useEffect(() => {
    const importJobIdFromQuery = searchParams.get("import_job_id");
    const nextImportJobId = importJobIdFromQuery ?? readPersistedQuestionImportJobId();
    setActiveImportJobId(nextImportJobId);
    if (importJobIdFromQuery) {
      persistQuestionImportJobId(importJobIdFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeImportJobId) {
      setActiveImportJob(null);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const pollImportJob = async () => {
      try {
        const job = await questionApiFetch<QuestionImportJobResponse>(`/api/questions/import/jobs/${activeImportJobId}`);
        if (cancelled) {
          return;
        }
        setActiveImportJob(job);

        if (job.status === "pending" || job.status === "running") {
          timer = window.setTimeout(pollImportJob, 2000);
          return;
        }

        clearPersistedQuestionImportJobId();
        setActiveImportJobId(null);
        setSearchParams((currentParams) => {
          if (!currentParams.has("import_job_id")) {
            return currentParams;
          }
          const nextParams = new URLSearchParams(currentParams);
          nextParams.delete("import_job_id");
          return nextParams;
        });
      } catch {
        if (cancelled) {
          return;
        }
        clearPersistedQuestionImportJobId();
        setActiveImportJobId(null);
        setActiveImportJob(null);
      }
    };

    void pollImportJob();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeImportJobId, setSearchParams]);

  // Disable query when no types or no difficulties selected — result must be empty
  const hasEmptyFilter = activeTypes.size === 0 || activeDifficulties.size === 0;

  const { query: listQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: current, pageSize, mode: "server" },
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
  const pageCount = Math.ceil((data?.total ?? 0) / pageSize) || 1;

  const { mutate: deleteQuestion } = useDelete();
  const { mutate: createBank } = useCreate();
  const { mutate: deleteBank } = useDelete();
  const { mutate: updateQuestion, mutation: updateQuestionMutation } = useUpdate();
  const invalidate = useInvalidate();
  const { create, edit } = useNavigation();

  const refreshBanks = () => invalidate({ resource: "question-banks", invalidates: ["list"] });
  const refreshQuestions = () => invalidate({ resource: "questions", invalidates: ["list"] });
  const refreshQuestionData = () => {
    refreshQuestions();
    refreshBanks();
  };
  // Client-side filtering for single/multi choice distinction
  // (backend only has "choice" type, can't distinguish single vs multi)
  const rawQuestions = data?.data ?? [];
  const needChoiceFilter =
    activeTypes.size < ALL_FILTER_TYPE_KEYS.size &&
    (activeTypes.has("single_choice") !== activeTypes.has("multi_choice"));
  const questions = needChoiceFilter
    ? rawQuestions.filter((q) => {
        if (q.type !== "choice") return true;
        const isMulti = Array.isArray(q.answer?.correct);
        if (isMulti) return activeTypes.has("multi_choice");
        return activeTypes.has("single_choice");
      })
    : rawQuestions;
  const visibleQuestionIds = new Set(questions.map((question) => question.id));
  const selectedQuestionIds = [...selected].filter((id) => visibleQuestionIds.has(id));
  const selectedQuestionCount = selectedQuestionIds.length;
  const total = hasEmptyFilter ? 0 : (data?.total ?? 0);
  const banks = banksQuery.data?.data ?? [];
  const roleName = identity ? getUserRole(identity) : "";
  const showBankOwner = roleName === "platform_admin";
  const canManageSharedResources = roleName === "admin" || roleName === "platform_admin" || roleName === "school_admin";
  const writableBanks = banks.filter(
    (bank) => bank.visibility !== "platform" || bank.owner_id === identity?.id || canManageSharedResources,
  );
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
      if (
        major &&
        (matchKnowledgeText(major.name) ||
          matchKnowledgeText(formatMajorName(major.name)) ||
          matchKnowledgeText(major.description))
      ) {
        return true;
      }
      return knowledgeDirections
        .filter((direction) => direction.major_id === majorId)
        .some((direction) => hasDirectionMatch(direction.id));
    },
    [hasDirectionMatch, knowledgeDirections, knowledgeMajors, matchKnowledgeText],
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    rebuildFilters(value, activeQuestionBankId, activeKnowledgePointId, activeTypes, activeDifficulties, activeTagIds, allTagsSelected);
  };

  const handleBankFilter = (bankId: string | null) => {
    if (bankId === activeQuestionBankId) return; // already selected
    setActiveQuestionBankId(bankId);
    // Reset dependent filters when bank changes
    setActiveTypes(new Set(ALL_FILTER_TYPE_KEYS));
    setActiveDifficulties(new Set(ALL_DIFFICULTY_SET));
    setActiveTagIds(new Set());
    setAllTagsSelected(true);
    rebuildFilters(search, bankId, activeKnowledgePointId, new Set(ALL_FILTER_TYPE_KEYS), new Set(ALL_DIFFICULTY_SET), new Set(), true);
  };

  const openCreateBankDialog = () => {
    setNewBankName("");
    setNewBankDesc("");
    setCreateBankOpen(true);
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
      rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, next, activeDifficulties, activeTagIds, allTagsSelected);
      return next;
    });
  };

  const handleToggleAllTypes = () => {
    const allSelected = activeTypes.size === ALL_FILTER_TYPE_KEYS.size;
    const next = allSelected ? new Set<FilterTypeKey>() : new Set(ALL_FILTER_TYPE_KEYS);
    setActiveTypes(next);
    rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, next, activeDifficulties, activeTagIds, allTagsSelected);
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
      rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, activeTypes, next, activeTagIds, allTagsSelected);
      return next;
    });
  };

  const handleToggleAllDifficulties = () => {
    const allSelected = activeDifficulties.size === ALL_DIFFICULTY_SET.size;
    const next = allSelected ? new Set<number>() : new Set(ALL_DIFFICULTY_SET);
    setActiveDifficulties(next);
    rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, activeTypes, next, activeTagIds, allTagsSelected);
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
      rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, activeTypes, activeDifficulties, next, isAll);
      return next;
    });
  };

  const handleToggleAllTags = () => {
    const newAll = !allTagsSelected;
    setAllTagsSelected(newAll);
    const next = newAll ? new Set<string>() : new Set<string>();
    setActiveTagIds(next);
    rebuildFilters(search, activeQuestionBankId, activeKnowledgePointId, activeTypes, activeDifficulties, next, newAll);
  };

  const handleDelete = (question: IQuestion) => {
    setDeleteQuestionTarget(question);
  };

  const handleClearBankQuestions = async () => {
    if (!clearBankTarget) {
      return;
    }

    const clearedBankId = clearBankTarget.id;
    setClearingBank(true);
    try {
      const result = await questionApiFetch<QuestionBankClearResult>(`/api/question-banks/${clearedBankId}/clear`, {
        method: "POST",
      });
      toast({
        title: `已清空 ${result.deleted} 道题目`,
        description: `硬删除 ${result.hard_deleted} 道，软删除 ${result.soft_deleted} 道。`,
      });
      setActiveQuestionBankId(clearedBankId);
      rebuildFilters(search, clearedBankId, activeKnowledgePointId, activeTypes, activeDifficulties, activeTagIds, allTagsSelected);
      setClearBankTarget(null);
      refreshQuestionData();
    } catch (error) {
      toast({
        title: "清空题库失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setClearingBank(false);
    }
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
    if (selectedQuestionCount === questions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(questions.map((q) => q.id)));
    }
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrent(1);
    setSelected(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedQuestionIds.length === 0) {
      return;
    }
    setBulkDeleting(true);
    try {
      const result = await questionApiFetch<{ deleted: number }>("/api/questions/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ question_ids: selectedQuestionIds }),
      });
      toast({ title: `已删除 ${result.deleted} 道题目` });
      setSelected(new Set());
      setBulkDeleteOpen(false);
      refreshQuestionData();
    } catch (error) {
      toast({
        title: "批量删除失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  const openMoveDialog = (question: IQuestion) => {
    setMoveQuestionTarget(question);
    setMoveTargetBankId(question.question_bank_id ?? "__none__");
  };

  const openBulkMoveDialog = () => {
    if (selectedQuestionIds.length === 0) {
      return;
    }
    setMoveQuestionTarget(null);
    setMoveTargetBankId(activeQuestionBankId && activeQuestionBankId !== "__none__" ? activeQuestionBankId : "__none__");
    setBulkMoveOpen(true);
  };

  const openCreateFromSelectionDialog = () => {
    if (selectedQuestionIds.length === 0) {
      toast({
        title: "请先选择题目",
        description: "勾选至少一道题目后再发起考试/作业。",
        variant: "destructive",
      });
      return;
    }
    setCreateFromSelectionOpen(true);
  };

  const buildSelectionSummary = useCallback(() => {
    const byId = new Map<string, IQuestion>();
    for (const q of questions) {
      byId.set(q.id, q);
    }
    // 保持用户点击时的视觉顺序：以题目列表当前顺序为准。
    const ordered: IQuestion[] = [];
    for (const q of questions) {
      if (selectedQuestionIds.includes(q.id)) ordered.push(q);
    }
    return ordered;
  }, [questions, selectedQuestionIds]);

  // 选中的题目生成有序摘要供 CreateFromSelectionDialog 使用。
  const selectedQuestionsInOrder = buildSelectionSummary();

  const defaultCreateTitle = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 练习`;
  })();

  const closeMoveDialog = () => {
    if (movingQuestions) {
      return;
    }
    setMoveQuestionTarget(null);
    setBulkMoveOpen(false);
  };

  const handleMoveQuestions = async () => {
    const questionIds = moveQuestionTarget ? [moveQuestionTarget.id] : selectedQuestionIds;
    if (questionIds.length === 0) {
      return;
    }

    setMovingQuestions(true);
    try {
      const result = await questionApiFetch<QuestionBulkMoveResult>("/api/questions/bulk-move", {
        method: "POST",
        body: JSON.stringify({
          question_ids: questionIds,
          question_bank_id: moveTargetBankId === "__none__" ? null : moveTargetBankId,
        }),
      });
      const targetName =
        moveTargetBankId === "__none__"
          ? "未在题库"
          : writableBanks.find((bank) => bank.id === moveTargetBankId)?.name ?? "目标题库";
      toast({ title: `已移动 ${result.moved} 道题目`, description: `目标位置：${targetName}` });
      if (bulkMoveOpen) {
        setSelected(new Set());
      }
      setMoveQuestionTarget(null);
      setBulkMoveOpen(false);
      refreshQuestionData();
    } catch (error) {
      toast({
        title: "移动题目失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setMovingQuestions(false);
    }
  };

  const paginationPages = generatePaginationPages(current, pageCount);

  /* Filter sidebar content — shared between desktop aside & mobile dialog */
  const filterContent = (
    <div className="flex h-full min-h-0 flex-col space-y-3">
      {/* 题库 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Library size={14} />
            题库
          </p>
          <button
            type="button"
            onClick={openCreateBankDialog}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Plus size={14} />
            新建
          </button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 space-y-1.5 overflow-y-hidden hover:overflow-y-auto">
          <button
            type="button"
            onClick={() => handleBankFilter(null)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
              activeQuestionBankId === null
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Library size={14} className="shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              全部题库
              <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px]">
                {noBankCount + banks.reduce((s, b) => s + b.question_count, 0)}
              </Badge>
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleBankFilter("__none__")}
            className={`group flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
              activeQuestionBankId === "__none__"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <PackageOpen size={14} className="shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              未在题库
              <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px]">
                {noBankCount}
              </Badge>
            </span>
          </button>
          {banks.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">暂无题库</p>
          ) : (
            banks.map((bank) => {
              const isActive = activeQuestionBankId === bank.id;
              const isReadOnlyShared =
                bank.visibility === "platform" &&
                bank.owner_id !== identity?.id &&
                !canManageSharedResources;
              const ownerLabel = showBankOwner ? getQuestionBankOwnerLabel(bank) : null;
              return (
                <div
                  key={bank.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleBankFilter(bank.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleBankFilter(bank.id); }}
                  className={`group flex w-full cursor-pointer items-center rounded-md px-3 py-3 text-left transition-colors ${
                    isActive
                      ? "bg-primary/10"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={`min-w-0 truncate text-sm ${isActive ? "text-primary font-medium" : "text-foreground"}`}>
                            {bank.name}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="start" className="max-w-xs">
                          <p>{bank.name}</p>
                          {ownerLabel ? <p className="text-xs text-muted-foreground">所有者：{ownerLabel}</p> : null}
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px]">
                        {bank.question_count}
                      </Badge>
                      {isReadOnlyShared && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                          <Lock size={10} className="mr-1" />
                          共享只读
                        </Badge>
                      )}
                    </div>
                    {bank.description && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {bank.description}
                      </p>
                    )}
                    {ownerLabel ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        所有者：{ownerLabel}
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const canClearBank = !isReadOnlyShared && bank.question_count > 0;
                              if (!canClearBank) return;
                              setClearBankTarget(bank);
                            }}
                            disabled={isReadOnlyShared || bank.question_count <= 0}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-amber-600 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                          >
                            <Eraser size={13} />
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>清除这个题库的所有题目</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isReadOnlyShared) return;
                              setDeleteBankTarget(bank);
                            }}
                            disabled={isReadOnlyShared}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>只是删除题库，但是题目会移动到未在题库里</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })
          )}
          <button
            type="button"
            onClick={openCreateBankDialog}
            className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-primary/30 bg-primary/[0.02] text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            <Plus size={15} />
            新建题库
          </button>
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
              placeholder="搜索题目内容、标题或选项..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Button className="shrink-0" onClick={() => create("questions")}>
            <Plus size={16} />
            <span className="hidden sm:inline">新建题目</span>
          </Button>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => {
              const query =
                activeQuestionBankId && activeQuestionBankId !== "__none__"
                  ? `?question_bank_id=${encodeURIComponent(activeQuestionBankId)}`
                  : "";
              navigate(`/questions/import${query}`);
            }}
          >
            <Upload size={16} />
            <span className="hidden sm:inline">导入题目</span>
          </Button>
          <Button variant="outline" className="shrink-0" onClick={() => navigate("/questions/ai-generate")}>
            <Sparkles size={16} />
            <span className="hidden sm:inline">AI 生成</span>
          </Button>
        </div>
      </div>

      {activeKnowledgePointId ? (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300">
          <GraduationCap size={15} />
          <span className="min-w-0 flex-1 truncate">当前只显示指定知识点关联的题目</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/70"
            onClick={() => {
              setSearchParams((currentParams) => {
                const nextParams = new URLSearchParams(currentParams);
                nextParams.delete("knowledge_point_id");
                return nextParams;
              });
            }}
          >
            清除
          </Button>
        </div>
      ) : null}

      {/* Two-column layout: sidebar left, list right */}
      <div className="flex gap-6">
        {/* Left: sidebar filters (desktop only) */}
        <aside className="hidden w-80 shrink-0 self-start lg:sticky lg:top-6 lg:block lg:h-[calc(100vh-8rem-20px)]">
          <Card className="h-full">
            <CardContent className="h-full overflow-y-hidden p-4 hover:overflow-y-auto">
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
                    selectedQuestionCount === questions.length && questions.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-muted-foreground">
                  {selectedQuestionCount > 0 ? `已选择 ${selectedQuestionCount} 题` : "全选"}
                </span>
                {selectedQuestionCount > 0 ? (
                  <>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={openCreateFromSelectionDialog}
                    >
                      <FilePlus2 size={13} />
                      发起考试/作业
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={openBulkMoveDialog}
                    >
                      <FolderInput size={13} />
                      批量移动
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 size={13} />
                      批量删除
                    </Button>
                  </>
                ) : null}
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                共 {total} 道题目
              </span>
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
                const globalIndex = (current - 1) * pageSize + idx + 1;
                return (
                  <QuestionPreviewCard
                    key={question.id}
                    question={question}
                    index={globalIndex}
                    className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                    expandOnHover
                    hideAnswer
                    highlightKeyword={search}
                    trailing={
                      <Checkbox
                        checked={selected.has(question.id)}
                        onCheckedChange={() => toggleSelect(question.id)}
                      />
                    }
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-blue-600 sm:px-2 dark:hover:text-blue-400"
                          onClick={() => handleOpenKnowledgeDialog(question)}
                        >
                          <Link2 size={13} className="sm:mr-1" />
                          <span className="hidden sm:inline">关联知识点</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-blue-600 sm:px-2 dark:hover:text-blue-400"
                          onClick={() => openMoveDialog(question)}
                        >
                          <FolderInput size={13} className="sm:mr-1" />
                          <span className="hidden sm:inline">移动</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-blue-600 sm:px-2 dark:hover:text-blue-400"
                          onClick={() => edit("questions", question.id)}
                        >
                          <Pencil size={13} className="sm:mr-1" />
                          <span className="hidden sm:inline">编辑</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-red-600 sm:px-2 dark:hover:text-red-400"
                          onClick={() => handleDelete(question)}
                        >
                          <Trash2 size={13} className="sm:mr-1" />
                          <span className="hidden sm:inline">删除</span>
                        </Button>
                      </>
                    }
                    knowledgeRecognitionStatus={getQuestionKnowledgeRecognitionStatus(question.id, activeImportJob) ?? undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                <span className="hidden sm:inline">显示 {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} 条，</span>
                <span>共 {total} 条</span>
                <span>每页</span>
                <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                  <SelectTrigger className="h-8 w-[76px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)} className="text-xs">
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>条</span>
              </div>
              {pageCount > 1 ? (
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
              ) : null}
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
                {knowledgeDialogQuestion ? getQuestionTitle(knowledgeDialogQuestion) : ""}
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
                                <p className="text-sm font-semibold text-foreground">{formatMajorName(major.name)}</p>
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
                      refreshQuestionData();
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

      <AlertDialog open={!!clearBankTarget} onOpenChange={(open) => { if (!open && !clearingBank) setClearBankTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空题库题目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要清空题库「{clearBankTarget?.name}」中的全部 {clearBankTarget?.question_count ?? 0} 道题目吗？题库会保留，但其中的题目会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert className="flex items-start gap-3 border-destructive/30 bg-destructive/5 text-destructive [&>svg]:static [&>svg]:translate-y-0">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <AlertDescription className="text-sm leading-6">
              请务必小心：从未被考试或练习使用过的题目会被硬删除，已被使用过的题目会软删除以保留历史记录。此操作不能撤销。
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingBank}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={clearingBank || !clearBankTarget}
              onClick={(event) => {
                event.preventDefault();
                void handleClearBankQuestions();
              }}
            >
              {clearingBank ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              清空题目
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!open && !bulkDeleting) setBulkDeleteOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除题目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除已选择的 {selectedQuestionCount} 道题目吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleting || selectedQuestionCount === 0}
              onClick={(event) => {
                event.preventDefault();
                void handleBulkDelete();
              }}
            >
              {bulkDeleting ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              删除 {selectedQuestionCount} 题
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!moveQuestionTarget || bulkMoveOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeMoveDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{moveQuestionTarget ? "移动题目" : "批量移动题目"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {moveQuestionTarget ? (
                <span className="line-clamp-2">{getQuestionTitle(moveQuestionTarget)}</span>
              ) : (
                <span>将已选择的 {selectedQuestionCount} 道题目移动到指定题库。</span>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">目标题库</Label>
              <Select value={moveTargetBankId} onValueChange={setMoveTargetBankId}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择题库" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未在题库</SelectItem>
                  {writableBanks.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {writableBanks.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有可移动到的题库，也可以先移动到“未在题库”。</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={movingQuestions} onClick={closeMoveDialog}>
              取消
            </Button>
            <Button type="button" size="sm" disabled={movingQuestions} onClick={() => void handleMoveQuestions()}>
              {movingQuestions ? <Loader2 size={14} className="mr-1 animate-spin" /> : <FolderInput size={14} />}
              确认移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteQuestionTarget} onOpenChange={(open) => { if (!open) setDeleteQuestionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题目</AlertDialogTitle>
            <AlertDialogDescription>
              {getQuestionDeleteDescription()}
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
                  {
                    onSuccess: () => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(deleteQuestionTarget.id);
                        return next;
                      });
                      setDeleteQuestionTarget(null);
                      refreshQuestionData();
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

      <CreateFromSelectionDialog
        open={createFromSelectionOpen}
        onOpenChange={setCreateFromSelectionOpen}
        selected={selectedQuestionsInOrder.map((q) => ({
          id: q.id,
          type: q.type,
          score: q.score,
        }))}
        defaultTitle={defaultCreateTitle}
        onPublished={() => {
          navigate("/exams");
        }}
      />
    </div>
  );
}
