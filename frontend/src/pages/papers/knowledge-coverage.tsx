import { useEffect, useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import {
  ChevronDown,
  ChevronRight,
  Layers3,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { useToast } from "@/hooks/use-toast";
import { QuestionSelector } from "@/pages/exams/components/QuestionSelector";
import {
  QuestionEditFormContent,
  type QuestionEditSubmitValues,
} from "@/pages/questions/edit";
import type {
  IKnowledgePoint,
  IPaperDetail,
  IPaperQuestion,
  IPaperQuestionKnowledgeSuggestion,
  IQuestion,
  IQuestionBank,
  ITag,
  QuestionType,
} from "@/types";
import { cn } from "@/lib/utils";

import { paperApiRequest } from "./api";

type CoverageMode = "overall" | "type";
type ManualQuestionType = QuestionType | "single_choice" | "multi_choice";

type PaperCoverageNavState = {
  backTo?: string;
  backLabel?: string;
  courseOrigin?: boolean;
  courseQuestionBankName?: string;
  knowledgePointOptions?: PaperKnowledgePointOption[];
  rootKnowledgePointId?: string;
  rootKnowledgePointName?: string;
};

type PaperKnowledgePointOption = {
  id: string;
  name: string;
  path: string;
};

type CoverageNode = PaperKnowledgePointOption & {
  depth: number;
  children: CoverageNode[];
  virtual?: boolean;
  unassigned?: boolean;
  colorIndex?: number;
  reason?: string | null;
  questionIds?: string[];
};

type PaperKnowledgeSuggestionGenerateResponse = {
  suggestions: IPaperQuestionKnowledgeSuggestion[];
};

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const QUESTION_TYPE_ORDER: Record<QuestionType, number> = {
  choice: 0,
  true_false: 1,
  fill_in: 2,
  short_answer: 3,
  essay: 4,
  code: 5,
};

const MANUAL_QUESTION_TYPES: Array<{ value: ManualQuestionType; label: string }> = [
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

const VIRTUAL_KNOWLEDGE_COLORS = [
  "border-sky-300 bg-sky-50 text-sky-800",
  "border-emerald-300 bg-emerald-50 text-emerald-800",
  "border-violet-300 bg-violet-50 text-violet-800",
  "border-amber-300 bg-amber-50 text-amber-800",
  "border-rose-300 bg-rose-50 text-rose-800",
  "border-cyan-300 bg-cyan-50 text-cyan-800",
  "border-lime-300 bg-lime-50 text-lime-800",
  "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800",
  "border-orange-300 bg-orange-50 text-orange-800",
  "border-teal-300 bg-teal-50 text-teal-800",
  "border-indigo-300 bg-indigo-50 text-indigo-800",
  "border-pink-300 bg-pink-50 text-pink-800",
];

const UNASSIGNED_KNOWLEDGE_NODE_ID = "system:missing-concrete-knowledge";

function toBackendQuestionType(type: ManualQuestionType): QuestionType {
  return type === "single_choice" || type === "multi_choice" ? "choice" : type;
}

function getQuestionTypeLabel(type: QuestionType | string | null | undefined) {
  if (!type) return "未知题型";
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type;
}

function deriveCourseQuestionBankName(courseName: string | null | undefined) {
  const normalized = courseName?.trim();
  return normalized ? `${normalized.slice(0, 197)}-题库` : undefined;
}

function normalizePathParts(option: PaperKnowledgePointOption) {
  return (option.path || option.name)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildTreeFromOptions(options: PaperKnowledgePointOption[]): CoverageNode[] {
  const nodesByPath = new Map<string, CoverageNode>();
  const sorted = [...options].sort(
    (a, b) => normalizePathParts(a).length - normalizePathParts(b).length,
  );

  for (const option of sorted) {
    const parts = normalizePathParts(option);
    const path = parts.join(" / ") || option.name;
    nodesByPath.set(path, {
      id: option.id,
      name: option.name,
      path,
      depth: Math.max(0, parts.length - 1),
      children: [],
    });
  }

  const roots: CoverageNode[] = [];
  for (const option of sorted) {
    const parts = normalizePathParts(option);
    const path = parts.join(" / ") || option.name;
    const node = nodesByPath.get(path);
    if (!node) continue;

    const parentPath = parts.slice(0, -1).join(" / ");
    const parent = parentPath ? nodesByPath.get(parentPath) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function buildOptionsFromKnowledgePoints(
  points: IKnowledgePoint[],
  rootId: string | null | undefined,
  rootName: string | null | undefined,
): PaperKnowledgePointOption[] {
  const byId = new Map(points.map((point) => [point.id, point]));
  const childrenByParent = new Map<string | null, IKnowledgePoint[]>();
  for (const point of points) {
    const key = point.parent_id ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(point);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }

  const root = rootId ? byId.get(rootId) : null;
  if (!root && rootId) {
    return [
      {
        id: rootId,
        name: rootName ?? "当前课程",
        path: rootName ?? "当前课程",
      },
    ];
  }

  const roots = root
    ? [root]
    : points.filter((point) => point.parent_id === null);
  const options: PaperKnowledgePointOption[] = [];
  const visit = (point: IKnowledgePoint, path: string) => {
    options.push({ id: point.id, name: point.name, path });
    for (const child of childrenByParent.get(point.id) ?? []) {
      visit(child, `${path} / ${child.name}`);
    }
  };
  for (const item of roots) {
    visit(item, item.name);
  }
  return options;
}

function collectNodeIds(node: CoverageNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of collectNodeIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

function buildDescendantMap(nodes: CoverageNode[]) {
  const map = new Map<string, Set<string>>();
  const visit = (node: CoverageNode) => {
    map.set(node.id, collectNodeIds(node));
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return map;
}

function flattenNodes(nodes: CoverageNode[]): CoverageNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function defaultExpandedNodeIds(nodes: CoverageNode[]) {
  const expanded = new Set<string>();
  for (const node of nodes) {
    if (node.depth === 0 && node.children.length > 0) {
      expanded.add(node.id);
    }
  }
  return expanded;
}

function buildVirtualSuggestionNodes({
  suggestions,
  eligibleQuestionIds,
}: {
  suggestions: IPaperQuestionKnowledgeSuggestion[];
  eligibleQuestionIds: Set<string>;
}): CoverageNode[] {
  const byName = new Map<
    string,
    {
      firstSuggestion: IPaperQuestionKnowledgeSuggestion;
      questionIds: string[];
    }
  >();
  for (const suggestion of suggestions) {
    const name = suggestion.suggested_name.trim();
    if (!name || !eligibleQuestionIds.has(suggestion.question_id)) continue;
    const group = byName.get(name);
    if (group) {
      group.questionIds.push(suggestion.question_id);
    } else {
      byName.set(name, {
        firstSuggestion: suggestion,
        questionIds: [suggestion.question_id],
      });
    }
  }
  return Array.from(byName.entries())
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .map(([name, group], index) => ({
      id: `virtual:${name}`,
      name,
      path: name,
      depth: 1,
      children: [],
      virtual: true,
      colorIndex: index % VIRTUAL_KNOWLEDGE_COLORS.length,
      reason: group.firstSuggestion.reason,
      questionIds: Array.from(new Set(group.questionIds)),
    }));
}

function buildUnassignedQuestionNode({
  items,
  realCoveredQuestionIds,
  suggestedQuestionIds,
}: {
  items: IPaperQuestion[];
  realCoveredQuestionIds: Set<string>;
  suggestedQuestionIds: Set<string>;
}): CoverageNode | null {
  const questionIds = items
    .map((item) => item.question_id)
    .filter((questionId) => !realCoveredQuestionIds.has(questionId))
    .filter((questionId) => !suggestedQuestionIds.has(questionId));
  if (questionIds.length === 0) return null;
  return {
    id: UNASSIGNED_KNOWLEDGE_NODE_ID,
    name: "未关联课程知识点",
    path: "未关联课程知识点",
    depth: 1,
    children: [],
    unassigned: true,
    reason: "这些题暂未命中当前课程知识点，可查看或删除。",
    questionIds,
  };
}

function getPaperQuestionTitle(item: IPaperQuestion): string {
  const question = item.question;
  if (!question) return "题目已不存在";
  if (question.title?.trim()) return question.title.trim();
  const content = question.content as { text?: unknown } | string | null | undefined;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (
    content &&
    typeof content === "object" &&
    typeof content.text === "string" &&
    content.text.trim()
  ) {
    return content.text.trim();
  }
  return "未命名题目";
}

function paperOptionToKnowledgePoint(option: PaperKnowledgePointOption | null): IKnowledgePoint | null {
  if (!option) return null;
  return {
    id: option.id,
    name: option.name,
    parent_id: null,
    description: null,
    created_at: "",
  };
}

function needsVirtualKnowledgeSuggestion(
  item: IPaperQuestion,
  concreteKnowledgePointIds: Set<string>,
) {
  const knowledgePointIds = item.question?.knowledge_points.map((point) => point.id) ?? [];
  return !knowledgePointIds.some((id) => concreteKnowledgePointIds.has(id));
}

function createManualQuestionDraft({
  type,
  bank,
  knowledgePoint,
}: {
  type: ManualQuestionType;
  bank: IQuestionBank | null;
  knowledgePoint: IKnowledgePoint | null;
}): IQuestion {
  const now = new Date().toISOString();
  const backendType = toBackendQuestionType(type);
  const answer =
    backendType === "true_false"
      ? { correct: true }
      : backendType === "fill_in"
        ? { correct: [""] }
        : backendType === "short_answer" || backendType === "essay"
          ? { points: [] }
          : backendType === "code"
            ? { code: "" }
            : { correct: type === "multi_choice" ? ["A"] : "A" };

  return {
    id: "manual-draft",
    type: backendType,
    title: "",
    content:
      backendType === "choice"
        ? { html: "", text: "", multi: type === "multi_choice" }
        : { html: "", text: "" },
    options:
      backendType === "choice"
        ? { A: "", B: "", C: "", D: "" }
        : null,
    answer,
    analysis: null,
    difficulty: 3,
    score: 10,
    source: "manual",
    usage_count: 0,
    question_bank_id: bank?.id ?? null,
    question_bank_name: bank?.name ?? null,
    tags: [],
    knowledge_points: knowledgePoint ? [knowledgePoint] : [],
    edit_lock: null,
    created_by: "",
    created_by_name: "",
    created_at: now,
    updated_at: now,
  };
}

export function PaperKnowledgeCoveragePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as PaperCoverageNavState;
  const { toast } = useToast();

  const [paper, setPaper] = useState<IPaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<CoverageMode>("overall");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [activeAddNode, setActiveAddNode] = useState<CoverageNode | null>(null);
  const [addSelectedIds, setAddSelectedIds] = useState<string[]>([]);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualQuestionType, setManualQuestionType] = useState<ManualQuestionType>("single_choice");
  const [manualSaving, setManualSaving] = useState(false);
  const [selectorRefreshKey, setSelectorRefreshKey] = useState(0);
  const [ensuredCourseBank, setEnsuredCourseBank] = useState<IQuestionBank | null>(null);
  const [ensuringCourseBank, setEnsuringCourseBank] = useState(false);
  const [previewQuestionId, setPreviewQuestionId] = useState<string | null>(null);
  const [suggestionGenerating, setSuggestionGenerating] = useState(false);

  const { query: banksQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.data?.data ?? [];

  const { query: tagsQuery } = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const allTags = tagsQuery.data?.data ?? [];

  const { query: knowledgePointsQuery } = useList<IKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const allKnowledgePoints = knowledgePointsQuery.data?.data ?? [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!id) return;
    paperApiRequest<IPaperDetail>(`/papers/${id}`)
      .then((value) => {
        if (cancelled) return;
        setPaper(value);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "加载试卷失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, toast]);

  const courseQuestionBankName =
    navState.courseQuestionBankName ??
    deriveCourseQuestionBankName(navState.rootKnowledgePointName ?? paper?.root_knowledge_point?.name);

  const courseKnowledgeOptions = useMemo(() => {
    if (navState.knowledgePointOptions?.length) {
      return navState.knowledgePointOptions;
    }
    return buildOptionsFromKnowledgePoints(
      allKnowledgePoints,
      navState.rootKnowledgePointId ?? paper?.root_knowledge_point_id,
      navState.rootKnowledgePointName ?? paper?.root_knowledge_point?.name,
    );
  }, [
    allKnowledgePoints,
    navState.knowledgePointOptions,
    navState.rootKnowledgePointId,
    navState.rootKnowledgePointName,
    paper?.root_knowledge_point?.name,
    paper?.root_knowledge_point_id,
  ]);

  const orderedItems = useMemo(
    () => [...(paper?.questions ?? [])].sort((a, b) => a.order - b.order),
    [paper?.questions],
  );
  const realKnowledgeTree = useMemo(
    () => buildTreeFromOptions(courseKnowledgeOptions),
    [courseKnowledgeOptions],
  );
  const rootKnowledgePointId = navState.rootKnowledgePointId ?? paper?.root_knowledge_point_id;
  const courseKnowledgePointIds = useMemo(
    () => new Set(courseKnowledgeOptions.map((option) => option.id)),
    [courseKnowledgeOptions],
  );
  const concreteKnowledgePointIds = useMemo(
    () =>
      new Set(
        courseKnowledgeOptions
          .map((option) => option.id)
          .filter((optionId) => optionId !== rootKnowledgePointId),
      ),
    [courseKnowledgeOptions, rootKnowledgePointId],
  );
  const virtualSuggestionCandidateItems = useMemo(
    () =>
      orderedItems.filter((item) =>
        needsVirtualKnowledgeSuggestion(item, concreteKnowledgePointIds),
      ),
    [concreteKnowledgePointIds, orderedItems],
  );
  const virtualSuggestionCandidateQuestionIds = useMemo(
    () => new Set(virtualSuggestionCandidateItems.map((item) => item.question_id)),
    [virtualSuggestionCandidateItems],
  );
  const virtualSuggestionNodes = useMemo(
    () =>
      buildVirtualSuggestionNodes({
        suggestions: paper?.knowledge_suggestions ?? [],
        eligibleQuestionIds: virtualSuggestionCandidateQuestionIds,
      }),
    [paper?.knowledge_suggestions, virtualSuggestionCandidateQuestionIds],
  );
  const suggestedCandidateQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of virtualSuggestionNodes) {
      for (const questionId of node.questionIds ?? []) {
        ids.add(questionId);
      }
    }
    return ids;
  }, [virtualSuggestionNodes]);
  const realCoveredQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of orderedItems) {
      const knowledgePointIds = item.question?.knowledge_points.map((point) => point.id) ?? [];
      if (knowledgePointIds.some((id) => courseKnowledgePointIds.has(id))) {
        ids.add(item.question_id);
      }
    }
    return ids;
  }, [courseKnowledgePointIds, orderedItems]);
  const unassignedQuestionNode = useMemo(
    () =>
      buildUnassignedQuestionNode({
        items: virtualSuggestionCandidateItems,
        realCoveredQuestionIds,
        suggestedQuestionIds: suggestedCandidateQuestionIds,
      }),
    [realCoveredQuestionIds, suggestedCandidateQuestionIds, virtualSuggestionCandidateItems],
  );
  const supplementalKnowledgeNodes = useMemo(
    () => [
      ...(unassignedQuestionNode ? [unassignedQuestionNode] : []),
      ...virtualSuggestionNodes,
    ],
    [unassignedQuestionNode, virtualSuggestionNodes],
  );
  const knowledgeTree = useMemo(() => {
    if (supplementalKnowledgeNodes.length === 0) return realKnowledgeTree;
    const rootId = rootKnowledgePointId;
    if (!rootId) {
      return [
        ...realKnowledgeTree,
        ...supplementalKnowledgeNodes.map((node) => ({ ...node, depth: 0 })),
      ];
    }
    let attached = false;
    const attachVirtualNodes = (nodes: CoverageNode[]): CoverageNode[] =>
      nodes.map((node) => {
        if (node.id === rootId) {
          attached = true;
          return {
            ...node,
            children: [...node.children, ...supplementalKnowledgeNodes],
          };
        }
        return {
          ...node,
          children: attachVirtualNodes(node.children),
        };
      });
    const nextTree = attachVirtualNodes(realKnowledgeTree);
    return attached
      ? nextTree
      : [
          ...nextTree,
          ...supplementalKnowledgeNodes.map((node) => ({ ...node, depth: 0 })),
        ];
  }, [realKnowledgeTree, rootKnowledgePointId, supplementalKnowledgeNodes]);
  const flatKnowledgeNodes = useMemo(() => flattenNodes(knowledgeTree), [knowledgeTree]);
  const realKnowledgeNodeCount = useMemo(
    () => flatKnowledgeNodes.filter((node) => !node.virtual && !node.unassigned).length,
    [flatKnowledgeNodes],
  );
  const descendantIdsByNodeId = useMemo(
    () => buildDescendantMap(realKnowledgeTree),
    [realKnowledgeTree],
  );

  useEffect(() => {
    const expanded = defaultExpandedNodeIds(knowledgeTree);
    if (supplementalKnowledgeNodes.length > 0 && rootKnowledgePointId) {
      expanded.add(rootKnowledgePointId);
    }
    setExpandedNodeIds(expanded);
  }, [knowledgeTree, rootKnowledgePointId, supplementalKnowledgeNodes.length]);
  const itemByQuestionId = useMemo(
    () => new Map(orderedItems.map((item) => [item.question_id, item])),
    [orderedItems],
  );
  const questionNumberById = useMemo(
    () => new Map(orderedItems.map((item, index) => [item.question_id, index + 1])),
    [orderedItems],
  );
  const currentQuestionIds = useMemo(
    () => orderedItems.map((item) => item.question_id),
    [orderedItems],
  );
  const previewItem = useMemo(
    () => (previewQuestionId ? itemByQuestionId.get(previewQuestionId) ?? null : null),
    [itemByQuestionId, previewQuestionId],
  );
  const typeQuestionGroups = useMemo(() => {
    const grouped = new Map<QuestionType, IPaperQuestion[]>();
    for (const item of orderedItems) {
      const type = item.question?.type;
      if (!type) continue;
      const list = grouped.get(type) ?? [];
      list.push(item);
      grouped.set(type, list);
    }
    return Array.from(grouped.entries()).sort(
      ([left], [right]) => QUESTION_TYPE_ORDER[left] - QUESTION_TYPE_ORDER[right],
    );
  }, [orderedItems]);
  const courseBank =
    ensuredCourseBank ??
    (courseQuestionBankName
      ? banks.find((bank) => bank.name === courseQuestionBankName)
      : null) ??
    null;

  useEffect(() => {
    if (!courseQuestionBankName || courseBank || ensuringCourseBank || banksQuery.isLoading) return;
    let cancelled = false;
    setEnsuringCourseBank(true);
    paperApiRequest<IQuestionBank>("/question-banks", {
      method: "POST",
      body: JSON.stringify({
        name: courseQuestionBankName,
        description: "课程对应题库",
      }),
    })
      .then((created) => {
        if (cancelled) return;
        setEnsuredCourseBank(created);
        void banksQuery.refetch();
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "课程题库准备失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setEnsuringCourseBank(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    banksQuery.isLoading,
    banksQuery.refetch,
    courseBank,
    courseQuestionBankName,
    ensuringCourseBank,
    toast,
  ]);

  const typeGroups = useMemo(() => {
    const types = new Set<QuestionType>();
    for (const item of orderedItems) {
      if (item.question?.type) {
        types.add(item.question.type);
      }
    }
    return Array.from(types).sort(
      (a, b) => QUESTION_TYPE_ORDER[a] - QUESTION_TYPE_ORDER[b],
    );
  }, [orderedItems]);

  const selectedForAddDialog = useMemo(
    () => Array.from(new Set([...currentQuestionIds, ...addSelectedIds])),
    [addSelectedIds, currentQuestionIds],
  );
  const missingSuggestionCount = Math.max(
    0,
    virtualSuggestionCandidateItems.length - suggestedCandidateQuestionIds.size,
  );

  const activeKnowledgePoint = useMemo(() => {
    if (!activeAddNode) return null;
    return (
      allKnowledgePoints.find((point) => point.id === activeAddNode.id) ??
      paperOptionToKnowledgePoint(activeAddNode)
    );
  }, [activeAddNode, allKnowledgePoints]);

  const manualQuestionDraft = activeAddNode
    ? createManualQuestionDraft({
        type: manualQuestionType,
        bank: courseBank,
        knowledgePoint: activeKnowledgePoint,
      })
    : null;

  const backTo = navState.backTo ?? "/papers";
  const backLabel = navState.backLabel ?? "返回试卷列表";

  const toggleNode = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const getNodeItems = (node: CoverageNode, type?: QuestionType) => {
    if (node.virtual || node.unassigned) {
      const byQuestionId = new Map<string, IPaperQuestion>();
      for (const questionId of node.questionIds ?? []) {
        const item = itemByQuestionId.get(questionId);
        if (!item) continue;
        if (type && item.question?.type !== type) continue;
        byQuestionId.set(questionId, item);
      }
      return Array.from(byQuestionId.values()).sort((a, b) => a.order - b.order);
    }
    const scopeIds = descendantIdsByNodeId.get(node.id) ?? new Set([node.id]);
    const byQuestionId = new Map<string, IPaperQuestion>();
    for (const item of orderedItems) {
      if (type && item.question?.type !== type) continue;
      const knowledgePoints = item.question?.knowledge_points ?? [];
      if (knowledgePoints.some((point) => scopeIds.has(point.id))) {
        byQuestionId.set(item.question_id, item);
      }
    }
    return Array.from(byQuestionId.values()).sort((a, b) => a.order - b.order);
  };

  const persistQuestionIds = async (
    nextQuestionIds: string[],
    successMessage: string,
  ): Promise<boolean> => {
    if (!paper || !id) return false;
    setSaving(true);
    try {
      const uniqueIds = Array.from(new Set(nextQuestionIds));
      const updated = await paperApiRequest<IPaperDetail>(`/papers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          question_items: uniqueIds.map((questionId, index) => {
            const existing = itemByQuestionId.get(questionId);
            return {
              question_id: questionId,
              order: index,
              score_override: existing?.score_override ?? null,
            };
          }),
        }),
      });
      setPaper(updated);
      toast({
        title: "试卷已更新",
        description: successMessage,
      });
      return true;
    } catch (error) {
      toast({
        title: "操作失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const removeQuestion = async (questionId: string) => {
    await persistQuestionIds(
      currentQuestionIds.filter((idValue) => idValue !== questionId),
      "已从当前试卷移除这道题。",
    );
  };

  const openAddDialog = (node: CoverageNode) => {
    if (node.virtual) return;
    setActiveAddNode(node);
    setAddSelectedIds([]);
  };

  const generateVirtualKnowledgeSuggestions = async () => {
    if (!paper) return;
    if (virtualSuggestionCandidateItems.length === 0) {
      toast({
        title: "无需生成 AI 建议",
        description: "当前试卷题目都已有具体课程子知识点覆盖。",
      });
      return;
    }

    setSuggestionGenerating(true);
    toast({
      title: "正在生成 AI 建议知识点",
      description: `将为 ${virtualSuggestionCandidateItems.length} 道缺少具体课程子知识点覆盖的题目生成展示用建议，可能需要一点时间。`,
    });
    try {
      const response = await paperApiRequest<PaperKnowledgeSuggestionGenerateResponse>(
        `/papers/${paper.id}/knowledge-suggestions`,
        { method: "POST" },
      );
      setPaper((prev) =>
        prev
          ? {
              ...prev,
              knowledge_suggestions: response.suggestions,
            }
          : prev,
      );
      const coveredIds = new Set(
        response.suggestions
          .filter((suggestion) => virtualSuggestionCandidateQuestionIds.has(suggestion.question_id))
          .map((suggestion) => suggestion.question_id),
      );
      toast({
        title: "AI 建议知识点已更新",
        description: `已为 ${coveredIds.size} 道题生成展示用知识点建议。`,
      });
    } catch (error) {
      toast({
        title: "AI 建议知识点生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSuggestionGenerating(false);
    }
  };

  const handleAddSelectionChange = (nextIds: string[]) => {
    const existing = new Set(currentQuestionIds);
    setAddSelectedIds(nextIds.filter((questionId) => !existing.has(questionId)));
  };

  const confirmAddSelectedQuestions = async () => {
    if (!activeAddNode || addSelectedIds.length === 0) return;
    const saved = await persistQuestionIds(
      [...currentQuestionIds, ...addSelectedIds],
      `已向「${activeAddNode.name}」补充 ${addSelectedIds.length} 道题。`,
    );
    if (saved) {
      setActiveAddNode(null);
      setAddSelectedIds([]);
    }
  };

  const ensureCourseQuestionBank = async (): Promise<IQuestionBank> => {
    const bankName = courseQuestionBankName?.trim();
    if (!bankName) {
      throw new Error("当前课程题库不存在，无法自动放入课程题库。");
    }
    const existing = banks.find((bank) => bank.name === bankName);
    if (existing) return existing;
    const created = await paperApiRequest<IQuestionBank>("/question-banks", {
      method: "POST",
      body: JSON.stringify({
        name: bankName,
        description: "课程对应题库",
      }),
    });
    setEnsuredCourseBank(created);
    await banksQuery.refetch();
    return created;
  };

  const handleManualQuestionSubmit = async (values: QuestionEditSubmitValues) => {
    if (!activeAddNode) return;
    setManualSaving(true);
    try {
      const bank = await ensureCourseQuestionBank();
      const created = await paperApiRequest<IQuestion>("/questions", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          question_bank_id: bank.id,
          knowledge_point_ids: [activeAddNode.id],
          source: "manual",
        }),
      });
      const saved = await persistQuestionIds(
        [...currentQuestionIds, created.id],
        `已新建题目，并关联到「${activeAddNode.name}」。`,
      );
      if (saved) {
        setManualAddOpen(false);
        setActiveAddNode(null);
        setManualQuestionType("single_choice");
        setSelectorRefreshKey((value) => value + 1);
      }
    } catch (error) {
      toast({
        title: "添加题目失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setManualSaving(false);
    }
  };

  const renderQuestionNumberButton = (item: IPaperQuestion) => {
    const questionNumber = questionNumberById.get(item.question_id) ?? item.order + 1;
    return (
      <TooltipButton
        key={item.question_id}
        type="button"
        variant="outline"
        className="h-9 min-w-9 px-2 text-sm tabular-nums"
        onClick={() => setPreviewQuestionId(item.question_id)}
        tooltip={getPaperQuestionTitle(item)}
        aria-label={`查看第 ${questionNumber} 题`}
      >
        {questionNumber}
      </TooltipButton>
    );
  };

  const renderQuestionChips = (items: IPaperQuestion[]) => {
    if (items.length === 0) {
      return <span className="text-xs text-muted-foreground">暂无覆盖</span>;
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => {
          const questionNumber = questionNumberById.get(item.question_id) ?? item.order + 1;
          return (
            <TooltipProvider key={item.question_id} delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 py-1 pl-1 pr-2 text-xs font-semibold text-primary"
                  >
                    <button
                      type="button"
                      className="rounded-full px-1.5 text-primary transition-colors hover:bg-primary/10 hover:text-primary"
                      onClick={() => setPreviewQuestionId(item.question_id)}
                      aria-label={`查看第 ${questionNumber} 题`}
                    >
                      {questionNumber}
                    </button>
                    <button
                      type="button"
                      className="rounded-full text-primary/60 hover:text-destructive"
                      onClick={() => void removeQuestion(item.question_id)}
                      disabled={saving}
                      aria-label={`移除第 ${questionNumber} 题`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{getPaperQuestionTitle(item)}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  };

  const renderNodeRows = (nodes: CoverageNode[], type?: QuestionType) =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const expanded = expandedNodeIds.has(node.id);
      const items = getNodeItems(node, type);
      const virtualColorClass = node.virtual
        ? VIRTUAL_KNOWLEDGE_COLORS[node.colorIndex ?? 0]
        : null;
      return (
        <div
          key={`${type ?? "overall"}-${node.id}`}
          className={cn(
            "border-b border-border/50 last:border-b-0",
            node.virtual && virtualColorClass,
            node.unassigned && "border-dashed bg-muted/20",
          )}
        >
          <div
            className={cn(
              "grid min-h-14 grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)_auto] items-center gap-4 px-4 py-3",
              node.virtual && "border-l-4",
              node.unassigned && "border-l-4 border-muted-foreground/30",
            )}
          >
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${Math.max(0, node.depth) * 18}px` }}
            >
              {hasChildren ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => toggleNode(node.id)}
                  aria-label={expanded ? "收起知识点" : "展开知识点"}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <span className="h-7 w-7 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      node.virtual ? "text-current" : "text-foreground",
                    )}
                  >
                    {node.name}
                  </p>
                  {node.virtual ? (
                    <Badge variant="secondary" className="shrink-0">
                      AI建议
                    </Badge>
                  ) : node.unassigned ? (
                    <Badge variant="outline" className="shrink-0">
                      待建议
                    </Badge>
                  ) : null}
                </div>
                {(node.virtual || node.unassigned) && node.reason ? (
                  <p className="mt-0.5 truncate text-xs text-current/70">{node.reason}</p>
                ) : node.depth <= 1 ? null : (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{node.path}</p>
                )}
              </div>
            </div>
            <div className="min-w-0">{renderQuestionChips(items)}</div>
            {node.virtual || node.unassigned ? (
              <span className="h-8 w-8" />
            ) : (
              <TooltipButton
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openAddDialog(node)}
                tooltip={`向「${node.name}」添加题目`}
              >
                <Plus className="h-4 w-4" />
              </TooltipButton>
            )}
          </div>
          {hasChildren && expanded ? (
            <div>{renderNodeRows(node.children, type)}</div>
          ) : null}
        </div>
      );
    });

  return (
    <div className="flex flex-col gap-5">
      <PageIntroHeader
        title={paper?.title ?? "试卷知识点覆盖"}
        description={`题目数 ${paper?.questions.length ?? 0} · 知识点数 ${realKnowledgeNodeCount}${
          virtualSuggestionNodes.length > 0 ? ` · AI建议 ${virtualSuggestionNodes.length}` : ""
        }`}
        onBack={() => navigate(backTo)}
        backLabel={backLabel}
        actions={
          <div className="flex items-center gap-2">
            {saving ? (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                保存中
              </Badge>
            ) : null}
            <TooltipButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void generateVirtualKnowledgeSuggestions()}
              disabled={!paper || suggestionGenerating}
              tooltip={
                missingSuggestionCount > 0
                  ? `为 ${missingSuggestionCount} 道题生成展示用知识点建议`
                  : "生成或刷新展示用知识点建议"
              }
            >
              {suggestionGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              AI建议知识点
            </TooltipButton>
          </div>
        }
      />

      {suggestionGenerating ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">正在生成 AI 建议知识点</p>
            <p className="mt-0.5 text-xs text-amber-800">
              这些建议只用于当前知识点视角展示，不会写入题目的真实知识点关联。
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-3">
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-1">
          {[
            ["overall", "整卷视角"],
            ["type", "题型视角"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(
                "h-8 rounded-md px-3 text-sm font-semibold transition-colors",
                mode === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
              onClick={() => setMode(value as CoverageMode)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          题型视角下，每个题型都会展示整门课程知识点覆盖情况。
        </p>
      </div>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-border/50 bg-card text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载试卷...
        </div>
      ) : !paper ? (
        <div className="rounded-2xl border border-border/50 bg-card p-10 text-center text-sm text-muted-foreground">
          试卷不存在或无权访问。
        </div>
      ) : knowledgeTree.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-10 text-center text-sm text-muted-foreground">
          当前课程暂无知识点，无法展示覆盖关系。
        </div>
      ) : mode === "overall" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">整卷知识点覆盖</h2>
              </div>
              <span className="text-xs text-muted-foreground">右侧题号为当前试卷顺序</span>
            </div>
            <div>{renderNodeRows(knowledgeTree)}</div>
          </section>
          <aside className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-foreground">题型题号</h2>
              <p className="mt-1 text-xs text-muted-foreground">点击题号查看题目详情。</p>
            </div>
            {typeQuestionGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无题目</p>
            ) : (
              <div className="flex flex-col gap-4">
                {typeQuestionGroups.map(([type, items]) => (
                  <section key={type} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary">{getQuestionTypeLabel(type)}</Badge>
                      <span className="text-xs text-muted-foreground">{items.length} 题</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {items.map((item) => renderQuestionNumberButton(item))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {typeGroups.length === 0 ? (
            <div className="rounded-2xl border border-border/50 bg-card p-10 text-center text-sm text-muted-foreground">
              当前试卷暂无题目。
            </div>
          ) : (
            typeGroups.map((type) => (
              <section
                key={type}
                className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{getQuestionTypeLabel(type)}</Badge>
                    <h2 className="text-sm font-semibold text-foreground">
                      {getQuestionTypeLabel(type)}知识点覆盖
                    </h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    展示整门课程知识点
                  </span>
                </div>
                <div>{renderNodeRows(knowledgeTree, type)}</div>
              </section>
            ))
          )}
        </div>
      )}

      <Dialog
        open={Boolean(activeAddNode)}
        modal={!manualAddOpen}
        onOpenChange={(open) => {
          if (!open) {
            setActiveAddNode(null);
            setAddSelectedIds([]);
          }
        }}
      >
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1300px] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>向「{activeAddNode?.name}」添加题目</DialogTitle>
            <DialogDescription>
              默认从当前课程题库和当前知识点筛选；没有合适题目时可以手动添加。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {activeAddNode ? (
              <QuestionSelector
                key={`${activeAddNode.id}-${selectorRefreshKey}`}
                selectedIds={selectedForAddDialog}
                onChange={handleAddSelectionChange}
                showSummary
                renderSummary={({ total, currentBankTotal, onOpenFullscreen }) => (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        选择要加入试卷的题目
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        新增已选 {addSelectedIds.length} 题
                        {currentBankTotal != null
                          ? ` · 当前题库共 ${currentBankTotal} 题`
                          : ` · 当前筛选共 ${total} 题`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setManualAddOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        手动添加
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={onOpenFullscreen}>
                        全屏显示
                      </Button>
                    </div>
                  </div>
                )}
                initialBankName={courseQuestionBankName}
                initialBankId={courseBank?.id}
                initialBankQuestionCount={courseBank?.question_count}
                initialKnowledgePointId={activeAddNode.id}
                knowledgePointOptions={courseKnowledgeOptions}
                restrictKnowledgePointsToOptions={courseKnowledgeOptions.length > 0}
                fillAvailableHeight
                refreshKey={selectorRefreshKey}
              />
            ) : null}
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setActiveAddNode(null);
                setAddSelectedIds([]);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={saving || addSelectedIds.length === 0}
              onClick={() => void confirmAddSelectedQuestions()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              加入 {addSelectedIds.length} 题
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动添加题目</DialogTitle>
            <DialogDescription>
              题目会保存到「{courseQuestionBankName ?? "课程题库"}」，并默认关联「{activeAddNode?.name ?? "当前知识点"}」。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <Label htmlFor="coverage-manual-question-type">题型</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  选择题型后填写题干、答案和解析。
                </p>
              </div>
              <select
                id="coverage-manual-question-type"
                value={manualQuestionType}
                onChange={(event) => setManualQuestionType(event.target.value as ManualQuestionType)}
                disabled={manualSaving}
                className="h-9 min-w-36 rounded-md border border-input bg-background px-3 text-sm"
              >
                {MANUAL_QUESTION_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            {manualQuestionDraft ? (
              <QuestionEditFormContent
                key={`${manualQuestionType}-${activeAddNode?.id ?? "no-kp"}-${courseBank?.id ?? "no-bank"}`}
                question={manualQuestionDraft}
                banks={courseBank ? [courseBank] : banks}
                allTags={allTags}
                knowledgePoints={allKnowledgePoints}
                isSubmitting={manualSaving}
                submitLabel="保存并加入试卷"
                cancelLabel="取消"
                showHeader={false}
                showQuestionBankAndTags={false}
                allowTypeChange={false}
                variant="dialog"
                onCancel={() => setManualAddOpen(false)}
                onSubmit={handleManualQuestionSubmit}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewItem?.question)} onOpenChange={(open) => {
        if (!open) setPreviewQuestionId(null);
      }}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              第 {previewItem ? questionNumberById.get(previewItem.question_id) ?? previewItem.order + 1 : ""} 题
            </DialogTitle>
            <DialogDescription>
              题目详情
            </DialogDescription>
          </DialogHeader>
          {previewItem?.question ? (
            <QuestionPreviewCard
              question={previewItem.question}
              mode="detailed"
              expanded
              index={questionNumberById.get(previewItem.question_id) ?? previewItem.order + 1}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
