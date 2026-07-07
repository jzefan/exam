import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronRight,
  FileText,
  Layers3,
  ListChecks,
  Loader2,
  Plus,
  Search,
  ShoppingBasket,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipButton } from "@/components/ui/tooltip-button";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { getQuestionTitle } from "@/components/questions/question-preview-utils";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import { QuestionEditFormContent, type QuestionEditSubmitValues } from "@/pages/questions/edit";
import {
  getCourseKnowledgeTree,
  getTeacherCourse,
  listCourseQuestions,
  type CourseKnowledgeNode,
  type TeacherCourseDetail,
} from "@/pages/courses/api";
import type {
  IKnowledgePoint,
  IPaperDetail,
  IQuestion,
  IQuestionBank,
  ITag,
  QuestionType,
} from "@/types";

type ManualQuestionType = QuestionType | "single_choice" | "multi_choice";
type BasketView = "order" | "type";
type SelectValueType = QuestionType | "all";

type CoursePaperDraft = {
  selectedIds: string[];
  selectedKnowledgePointId: string | null;
  basketView: BasketView;
  updatedAt: string;
};

type GeneratedQuestion = {
  type: QuestionType;
  title?: string;
  content?: Record<string, unknown>;
  options?: Record<string, unknown> | null;
  answer?: Record<string, unknown>;
  analysis?: string | null;
  difficulty?: number;
  score?: number;
};

type FlatKnowledgeNode = {
  id: string;
  name: string;
  path: string;
  depth: number;
  children: CourseKnowledgeNode[];
};

const ALL_TYPES = "all";
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

const QUESTION_TYPE_LABELS: Record<string, string> = {
  choice: "选择题",
  single_choice: "单选题",
  multi_choice: "多选题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const QUESTION_TYPES: QuestionType[] = [
  "choice",
  "true_false",
  "fill_in",
  "short_answer",
  "essay",
  "code",
];

function courseQuestionBankName(courseName: string | undefined) {
  const normalized = courseName?.trim();
  return normalized ? `${normalized.slice(0, 197)}-题库` : "主知识对应题库";
}

function toBackendQuestionType(type: ManualQuestionType): QuestionType {
  return type === "single_choice" || type === "multi_choice" ? "choice" : type;
}

function flattenKnowledgeTree(
  node: CourseKnowledgeNode | null,
  depth = 0,
  parentPath = "",
): FlatKnowledgeNode[] {
  if (!node) return [];
  const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
  return [
    {
      id: node.id,
      name: node.name,
      path,
      depth,
      children: node.children,
    },
    ...node.children.flatMap((child) => flattenKnowledgeTree(child, depth + 1, path)),
  ];
}

function findKnowledgeNode(
  node: CourseKnowledgeNode | null,
  nodeId: string | null,
): CourseKnowledgeNode | null {
  if (!node || !nodeId) return null;
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const found = findKnowledgeNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function findKnowledgeNodeIdPath(
  node: CourseKnowledgeNode | null,
  nodeId: string | null,
  trail: string[] = [],
): string[] {
  if (!node || !nodeId) return [];
  const nextTrail = [...trail, node.id];
  if (node.id === nodeId) return nextTrail;
  for (const child of node.children) {
    const found = findKnowledgeNodeIdPath(child, nodeId, nextTrail);
    if (found.length > 0) return found;
  }
  return [];
}

function collectKnowledgeNodeIds(node: CourseKnowledgeNode | null): Set<string> {
  const ids = new Set<string>();
  const visit = (current: CourseKnowledgeNode | null) => {
    if (!current) return;
    ids.add(current.id);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return ids;
}

function findFirstQuestionKnowledgePointId(
  question: IQuestion,
  courseKnowledgeIds: Set<string>,
  fallbackId: string | null,
) {
  const match = question.knowledge_points.find((kp) => courseKnowledgeIds.has(kp.id));
  return match?.id ?? fallbackId;
}

function getQuestionSearchText(question: IQuestion) {
  const content = question.content as { text?: unknown; html?: unknown } | null;
  const contentText =
    typeof content?.text === "string"
      ? content.text
      : typeof content?.html === "string"
        ? content.html.replace(/<[^>]+>/g, " ")
        : "";
  return [
    question.title,
    contentText,
    Object.values(question.options ?? {}).join(" "),
    question.knowledge_points.map((kp) => kp.name).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildKnowledgeCounts(
  tree: CourseKnowledgeNode | null,
  questions: IQuestion[],
) {
  const directCounts: Record<string, number> = {};
  for (const node of flattenKnowledgeTree(tree)) {
    directCounts[node.id] = 0;
  }
  for (const question of questions) {
    for (const kp of question.knowledge_points) {
      directCounts[kp.id] = (directCounts[kp.id] ?? 0) + 1;
    }
  }

  const aggregateCounts: Record<string, number> = {};
  const visit = (node: CourseKnowledgeNode): number => {
    const total = (directCounts[node.id] ?? 0) + node.children.reduce((sum, child) => sum + visit(child), 0);
    aggregateCounts[node.id] = total;
    return total;
  };
  if (tree) visit(tree);
  return aggregateCounts;
}

function paperDraftKey(courseId: string) {
  return `course-paper-draft:${courseId}`;
}

function readDraft(courseId: string): CoursePaperDraft | null {
  try {
    const raw = localStorage.getItem(paperDraftKey(courseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoursePaperDraft;
    if (!Array.isArray(parsed.selectedIds) || parsed.selectedIds.length === 0) return null;
    return {
      selectedIds: parsed.selectedIds.filter((id) => typeof id === "string"),
      selectedKnowledgePointId:
        typeof parsed.selectedKnowledgePointId === "string" ? parsed.selectedKnowledgePointId : null,
      basketView: parsed.basketView === "type" ? "type" : "order",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
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
  const baseAnswer: Record<string, unknown> =
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
    id: "course-paper-manual-draft",
    type: backendType,
    title: "",
    content:
      backendType === "choice"
        ? { html: "", text: "", multi: type === "multi_choice" }
        : { html: "", text: "" },
    options: backendType === "choice" ? { A: "", B: "", C: "", D: "" } : null,
    answer: baseAnswer,
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

function toKnowledgePoint(node: FlatKnowledgeNode | undefined): IKnowledgePoint | null {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    parent_id: null,
    description: null,
    created_at: "",
  };
}

async function streamGenerateCourseQuestions({
  totalCount,
  type,
  difficulty,
  knowledgePointIds,
  courseName,
  knowledgePath,
}: {
  totalCount: number;
  type: QuestionType;
  difficulty: number;
  knowledgePointIds: string[];
  courseName: string;
  knowledgePath: string;
}): Promise<GeneratedQuestion[]> {
  const token = localStorage.getItem("access_token");
  const response = await fetch("/api/questions/ai-generate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      total_count: totalCount,
      difficulty,
      type_distribution: { [type]: totalCount },
      knowledge_point_ids: knowledgePointIds,
      course_name: courseName,
      prompt: `请为课程「${courseName}」生成题目，知识点范围为「${knowledgePath}」。题目要直接考查该知识点，避免生成与课程无关的泛化内容。`,
      model: "deepseek",
    }),
  });

  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? `AI 生成请求失败: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const generated: GeneratedQuestion[] = [];
  let buffer = "";
  let streamError: string | null = null;

  const processEvent = (part: string) => {
    const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = dataLine.replace(/^data:\s*/, "").trim();
    if (!payload || payload === "[DONE]") return;
    let event: { type?: string; data?: GeneratedQuestion; message?: string };
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === "question" && event.data) {
      generated.push(event.data);
    } else if (event.type === "error") {
      streamError = event.message ?? "AI 生成失败";
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      processEvent(part);
      if (streamError) {
        await reader.cancel();
        break;
      }
    }
    if (streamError) break;
  }
  if (!streamError && buffer.trim()) {
    processEvent(buffer);
  }
  if (streamError) {
    throw new Error(streamError);
  }
  if (generated.length === 0) {
    throw new Error("AI 未返回题目数据");
  }
  return generated;
}

export function CoursePaperCreatePage() {
  const { id: courseId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const listRef = useRef<HTMLDivElement | null>(null);
  const basketButtonRef = useRef<HTMLButtonElement | null>(null);

  const [course, setCourse] = useState<TeacherCourseDetail | null>(null);
  const [tree, setTree] = useState<CourseKnowledgeNode | null>(null);
  const [questions, setQuestions] = useState<IQuestion[]>([]);
  const [banks, setBanks] = useState<IQuestionBank[]>([]);
  const [allTags, setAllTags] = useState<ITag[]>([]);
  const [knowledgePoints, setKnowledgePoints] = useState<IKnowledgePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKnowledgePointId, setSelectedKnowledgePointId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<SelectValueType>(ALL_TYPES);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [basketOpen, setBasketOpen] = useState(false);
  const [basketView, setBasketView] = useState<BasketView>("order");
  const [previewMode, setPreviewMode] = useState(false);
  const [highlightQuestionId, setHighlightQuestionId] = useState<string | null>(null);

  const [draftPrompt, setDraftPrompt] = useState<CoursePaperDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [paperTitle, setPaperTitle] = useState("");
  const [savingPaper, setSavingPaper] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualType, setManualType] = useState<ManualQuestionType>("single_choice");
  const [manualKnowledgePointId, setManualKnowledgePointId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [ensuringBank, setEnsuringBank] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiCount, setAiCount] = useState(5);
  const [aiType, setAiType] = useState<QuestionType>("choice");
  const [aiDifficulty, setAiDifficulty] = useState(3);
  const [aiKnowledgePointId, setAiKnowledgePointId] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const playBasketConfirmAnimation = useCallback(() => {
    const basketButton = basketButtonRef.current;
    if (!basketButton) return;
    basketButton.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.08)" },
        { transform: "scale(1)" },
      ],
      {
        duration: 260,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }, []);

  const playCardToBasketAnimation = useCallback(
    (cardElement: HTMLElement | null) => {
      const basketButton = basketButtonRef.current;
      if (!cardElement || !basketButton) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        playBasketConfirmAnimation();
        return;
      }

      const sourceRect = cardElement.getBoundingClientRect();
      const targetRect = basketButton.getBoundingClientRect();
      if (sourceRect.width === 0 || sourceRect.height === 0) return;

      const clone = cardElement.cloneNode(true) as HTMLElement;
      clone.setAttribute("aria-hidden", "true");
      Object.assign(clone.style, {
        position: "fixed",
        left: `${sourceRect.left}px`,
        top: `${sourceRect.top}px`,
        width: `${sourceRect.width}px`,
        height: `${sourceRect.height}px`,
        margin: "0",
        pointerEvents: "none",
        overflow: "hidden",
        transformOrigin: "center",
        boxShadow: "0 24px 60px hsl(var(--foreground) / 0.18)",
        zIndex: "2147483647",
      });
      document.body.appendChild(clone);

      const targetX =
        targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
      const targetY =
        targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
      const animation = clone.animate(
        [
          {
            opacity: 1,
            transform: "translate3d(0, 0, 0) scale(1)",
            filter: "saturate(1)",
          },
          {
            opacity: 0.82,
            offset: 0.55,
            transform: `translate3d(${targetX * 0.72}px, ${targetY * 0.72}px, 0) scale(0.48) rotate(-2deg)`,
            filter: "saturate(1.12)",
          },
          {
            opacity: 0,
            transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(0.12) rotate(-6deg)`,
            filter: "saturate(1.2)",
          },
        ],
        {
          duration: 560,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );
      animation.onfinish = () => {
        clone.remove();
        playBasketConfirmAnimation();
      };
      animation.oncancel = () => clone.remove();
    },
    [playBasketConfirmAnimation],
  );

  const rootKnowledgePointId = tree?.id ?? courseId ?? null;
  const defaultBackTo = courseId ? `/courses/${courseId}?tab=papers` : "/courses";
  const courseBankName = courseQuestionBankName(course?.name);
  const courseBank = useMemo(
    () => banks.find((bank) => bank.name === courseBankName) ?? null,
    [banks, courseBankName],
  );
  const flatNodes = useMemo(() => flattenKnowledgeTree(tree), [tree]);
  const courseKnowledgeIds = useMemo(() => collectKnowledgeNodeIds(tree), [tree]);
  const knowledgeCountById = useMemo(
    () => buildKnowledgeCounts(tree, questions),
    [questions, tree],
  );
  const activeKnowledgePointId = selectedKnowledgePointId ?? rootKnowledgePointId;
  const activeNode = useMemo(
    () => findKnowledgeNode(tree, activeKnowledgePointId),
    [activeKnowledgePointId, tree],
  );
  const activeDescendantIds = useMemo(
    () => collectKnowledgeNodeIds(activeNode),
    [activeNode],
  );
  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );
  const selectedQuestionItems = useMemo(
    () =>
      selectedIds
        .map((id) => questionById.get(id))
        .filter((question): question is IQuestion => Boolean(question)),
    [questionById, selectedIds],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedGroups = useMemo(() => {
    const grouped = new Map<QuestionType, IQuestion[]>();
    for (const question of selectedQuestionItems) {
      const items = grouped.get(question.type) ?? [];
      items.push(question);
      grouped.set(question.type, items);
    }
    return Array.from(grouped.entries()).sort(
      ([a], [b]) => QUESTION_TYPE_ORDER[a] - QUESTION_TYPE_ORDER[b],
    );
  }, [selectedQuestionItems]);
  const visibleQuestions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const source = previewMode ? selectedQuestionItems : questions;
    return source.filter((question) => {
      const kpMatch =
        !activeKnowledgePointId ||
        activeKnowledgePointId === rootKnowledgePointId ||
        question.knowledge_points.some((kp) => activeDescendantIds.has(kp.id));
      const typeMatch = typeFilter === ALL_TYPES || question.type === typeFilter;
      const searchMatch = !query || getQuestionSearchText(question).includes(query);
      return kpMatch && typeMatch && searchMatch;
    });
  }, [
    activeDescendantIds,
    activeKnowledgePointId,
    previewMode,
    questions,
    rootKnowledgePointId,
    searchText,
    selectedQuestionItems,
    typeFilter,
  ]);

  const manualKnowledgePoint =
    flatNodes.find((node) => node.id === manualKnowledgePointId) ??
    flatNodes.find((node) => node.id === activeKnowledgePointId) ??
    flatNodes[0];
  const aiKnowledgePoint =
    flatNodes.find((node) => node.id === aiKnowledgePointId) ??
    flatNodes.find((node) => node.id === activeKnowledgePointId) ??
    flatNodes[0];
  const manualQuestionDraft = createManualQuestionDraft({
    type: manualType,
    bank: courseBank,
    knowledgePoint: toKnowledgePoint(manualKnowledgePoint),
  });

  const updateSelectedIds = useCallback((nextIds: string[]) => {
    setSelectedIds(Array.from(new Set(nextIds)));
  }, []);

  const toggleSelected = useCallback(
    (question: IQuestion) => {
      if (selectedSet.has(question.id)) {
        updateSelectedIds(selectedIds.filter((id) => id !== question.id));
      } else {
        updateSelectedIds([...selectedIds, question.id]);
      }
    },
    [selectedIds, selectedSet, updateSelectedIds],
  );

  const removeSelected = useCallback((questionId: string) => {
    setSelectedIds((current) => current.filter((id) => id !== questionId));
  }, []);

  const clearSelected = useCallback(() => {
    setSelectedIds([]);
  }, []);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      getTeacherCourse(courseId),
      getCourseKnowledgeTree(courseId),
      listCourseQuestions(courseId),
      apiRequest<IQuestionBank[]>("/question-banks?_start=0&_end=1000"),
      apiRequest<ITag[]>("/tags?_start=0&_end=1000"),
      apiRequest<IKnowledgePoint[]>("/knowledge-points?_start=0&_end=1000"),
    ])
      .then(([courseValue, treeValue, questionValue, bankValue, tagValue, knowledgeValue]) => {
        if (cancelled) return;
        setCourse(courseValue);
        setTree(treeValue);
        setQuestions(questionValue);
        setBanks(bankValue);
        setAllTags(tagValue);
        setKnowledgePoints(knowledgeValue);
        setSelectedKnowledgePointId(treeValue.id);
        setExpandedNodeIds(new Set([treeValue.id]));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "课程组卷数据加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  useEffect(() => {
    if (!courseId || loading || draftReady) return;
    const draft = readDraft(courseId);
    if (draft) {
      setDraftPrompt(draft);
    } else {
      setDraftReady(true);
    }
  }, [courseId, draftReady, loading]);

  useEffect(() => {
    if (!courseId || !draftReady) return;
    const key = paperDraftKey(courseId);
    if (selectedIds.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    const draft: CoursePaperDraft = {
      selectedIds,
      selectedKnowledgePointId,
      basketView,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(draft));
  }, [basketView, courseId, draftReady, selectedIds, selectedKnowledgePointId]);

  useEffect(() => {
    if (!highlightQuestionId) return;
    const timer = window.setTimeout(() => {
      const element = listRef.current?.querySelector<HTMLElement>(
        `[data-course-paper-question-id="${highlightQuestionId}"]`,
      );
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.focus({ preventScroll: true });
    }, 80);
    const clearTimer = window.setTimeout(() => setHighlightQuestionId(null), 1800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightQuestionId, visibleQuestions]);

  const continueDraft = () => {
    if (!draftPrompt) return;
    const knownIds = new Set(questions.map((question) => question.id));
    updateSelectedIds(draftPrompt.selectedIds.filter((id) => knownIds.has(id)));
    setSelectedKnowledgePointId(
      draftPrompt.selectedKnowledgePointId && courseKnowledgeIds.has(draftPrompt.selectedKnowledgePointId)
        ? draftPrompt.selectedKnowledgePointId
        : rootKnowledgePointId,
    );
    setBasketView(draftPrompt.basketView);
    setDraftPrompt(null);
    setDraftReady(true);
    toast({
      title: "已恢复草稿",
      description: `试题篮中有 ${draftPrompt.selectedIds.length} 道已选题。`,
    });
  };

  const restartDraft = () => {
    if (courseId) {
      localStorage.removeItem(paperDraftKey(courseId));
    }
    setSelectedIds([]);
    setDraftPrompt(null);
    setDraftReady(true);
  };

  const ensureCourseBank = async () => {
    if (courseBank) return courseBank;
    setEnsuringBank(true);
    try {
      const created = await apiRequest<IQuestionBank>("/question-banks", {
        method: "POST",
        body: JSON.stringify({
          name: courseBankName,
          description: "课程对应题库",
        }),
      });
      setBanks((current) => [created, ...current.filter((bank) => bank.id !== created.id)]);
      return created;
    } finally {
      setEnsuringBank(false);
    }
  };

  const handleManualSubmit = async (values: QuestionEditSubmitValues) => {
    setManualSaving(true);
    try {
      const bank = await ensureCourseBank();
      const fallbackKnowledgeId = manualKnowledgePoint?.id ?? rootKnowledgePointId;
      const knowledgePointIds =
        manualKnowledgePointId || fallbackKnowledgeId
          ? [manualKnowledgePointId || fallbackKnowledgeId].filter((id): id is string => Boolean(id))
          : values.knowledge_point_ids;
      const created = await apiRequest<IQuestion>("/questions", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          question_bank_id: bank.id,
          knowledge_point_ids: knowledgePointIds,
          source: "manual",
        }),
      });
      setQuestions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      updateSelectedIds([...selectedIds, created.id]);
      setManualOpen(false);
      setManualType("single_choice");
      toast({
        title: "题目已添加",
        description: `已保存到「${bank.name}」，并加入试题篮。`,
      });
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

  const handleAIGenerate = async () => {
    if (!course) return;
    const node = aiKnowledgePoint;
    if (!node) {
      toast({
        title: "请选择知识点",
        description: "AI 生成题目需要明确课程知识点范围。",
        variant: "destructive",
      });
      return;
    }
    setAiGenerating(true);
    try {
      const bank = await ensureCourseBank();
      const generated = await streamGenerateCourseQuestions({
        totalCount: aiCount,
        type: aiType,
        difficulty: aiDifficulty,
        knowledgePointIds: [node.id],
        courseName: course.name,
        knowledgePath: node.path,
      });
      const created: IQuestion[] = [];
      for (const question of generated) {
        const saved = await apiRequest<IQuestion>("/questions", {
          method: "POST",
          body: JSON.stringify({
            type: question.type ?? aiType,
            title: question.title ?? "",
            content: question.content ?? { text: question.title ?? "" },
            options: question.options ?? null,
            answer: question.answer ?? {},
            analysis: question.analysis ?? null,
            difficulty: question.difficulty ?? aiDifficulty,
            score: question.score ?? 10,
            source: "ai_generated",
            tag_ids: [],
            knowledge_point_ids: [node.id],
            question_bank_id: bank.id,
          }),
        });
        created.push(saved);
      }
      setQuestions((current) => [
        ...created,
        ...current.filter((item) => !created.some((createdItem) => createdItem.id === item.id)),
      ]);
      updateSelectedIds([...selectedIds, ...created.map((question) => question.id)]);
      setAiOpen(false);
      toast({
        title: "AI 题目已加入",
        description: `已生成 ${created.length} 道题并保存到「${bank.name}」。`,
      });
    } catch (error) {
      toast({
        title: "AI 生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAiGenerating(false);
    }
  };

  const handleBasketQuestionClick = (question: IQuestion) => {
    const targetKnowledgeId = findFirstQuestionKnowledgePointId(
      question,
      courseKnowledgeIds,
      rootKnowledgePointId,
    );
    setSelectedKnowledgePointId(targetKnowledgeId);
    setSearchText("");
    setTypeFilter(ALL_TYPES);
    setPreviewMode(false);
    setBasketOpen(false);
    setHighlightQuestionId(question.id);
    if (targetKnowledgeId) {
      const pathIds = findKnowledgeNodeIdPath(tree, targetKnowledgeId);
      setExpandedNodeIds((current) => new Set([...current, ...pathIds]));
    }
  };

  const handleSavePaper = async () => {
    const title = paperTitle.trim();
    if (!title) {
      toast({
        title: "请输入试卷名称",
        variant: "destructive",
      });
      return;
    }
    if (selectedIds.length === 0) {
      toast({
        title: "试题篮为空",
        description: "请先选择至少一道题目。",
        variant: "destructive",
      });
      return;
    }
    setSavingPaper(true);
    try {
      const created = await apiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: null,
          source_type: "manual",
          root_knowledge_point_id: rootKnowledgePointId,
          question_items: selectedIds.map((questionId, index) => ({
            question_id: questionId,
            order: index,
            score_override: null,
          })),
        }),
      });
      if (courseId) {
        localStorage.removeItem(paperDraftKey(courseId));
      }
      toast({
        title: "试卷已创建",
        description: `已保存 ${created.questions.length} 道题。`,
      });
      navigate(`/papers/${created.id}`, {
        state: {
          backTo: defaultBackTo,
          backLabel: "返回课程详情",
          courseOrigin: true,
          courseKpId: rootKnowledgePointId ?? undefined,
        },
      });
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSavingPaper(false);
    }
  };

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const renderKnowledgeNode = (node: CourseKnowledgeNode, depth = 0) => {
    const isExpanded = expandedNodeIds.has(node.id);
    const isActive = activeKnowledgePointId === node.id;
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id} className="flex flex-col gap-1">
        <div
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors",
            isActive ? "bg-muted/70 text-foreground ring-1 ring-border/60" : "hover:bg-muted",
          )}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded",
              hasChildren ? "hover:bg-background/20" : "opacity-30",
            )}
            disabled={!hasChildren}
            aria-label={isExpanded ? "收起知识点" : "展开知识点"}
            onClick={() => toggleExpanded(node.id)}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
            onClick={() => {
              setSelectedKnowledgePointId(node.id);
              setPreviewMode(false);
            }}
          >
            <span className="truncate font-medium">{node.name}</span>
            <Badge
              variant={isActive ? "secondary" : "outline"}
              className={cn("shrink-0", isActive && "border-transparent")}
            >
              {knowledgeCountById[node.id] ?? 0}
            </Badge>
          </button>
        </div>
        {hasChildren && isExpanded ? (
          <div className="flex flex-col gap-1">
            {node.children.map((child) => renderKnowledgeNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderQuestionAction = (question: IQuestion) => {
    const isSelected = selectedSet.has(question.id);
    return (
      <Button
        type="button"
        size="sm"
        variant={isSelected ? "default" : "outline"}
        onClick={(event) => {
          event.stopPropagation();
          if (!isSelected) {
            const cardElement = event.currentTarget.closest<HTMLElement>(
              "[data-course-paper-question-id]",
            );
            playCardToBasketAnimation(cardElement);
          }
          toggleSelected(question);
        }}
      >
        {isSelected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {isSelected ? "已选" : "选择"}
      </Button>
    );
  };

  const renderQuestionList = () => (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
      {visibleQuestions.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
          <FileText className="h-8 w-8 opacity-30" />
          {previewMode ? "试题篮中暂无符合当前筛选的题目" : "暂无符合当前筛选的题目"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleQuestions.map((question, index) => {
            const isSelected = selectedSet.has(question.id);
            const isHighlighted = highlightQuestionId === question.id;
            return (
              <div
                key={question.id}
                tabIndex={-1}
                data-course-paper-question-id={question.id}
                className={cn(
                  "rounded-lg outline-none transition-all",
                  isSelected && "ring-1 ring-primary/30",
                  isHighlighted && "ring-2 ring-primary",
                )}
              >
                <QuestionPreviewCard
                  question={question}
                  index={index + 1}
                  mode="detailed"
                  expandOnClick
                  hideAnswer
                  hideMeta
                  markChoiceAnswer
                  className={cn(isSelected && "border-primary/50 bg-primary/5")}
                  trailing={previewMode ? undefined : renderQuestionAction(question)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderBasketQuestions = (items: IQuestion[], showType = false) => (
    <div className="flex flex-col gap-3">
      {items.map((question) => (
        <div key={question.id} className="rounded-lg border border-border/60 bg-background p-3">
          <button
            type="button"
            className="mb-2 flex w-full items-start justify-between gap-3 text-left"
            onClick={() => handleBasketQuestionClick(question)}
          >
            <span className="min-w-0 flex-1 line-clamp-2 text-sm font-medium text-foreground">
              {getQuestionTitle(question)}
            </span>
            {showType ? (
              <Badge variant="outline" className="shrink-0">
                {QUESTION_TYPE_LABELS[question.type] ?? question.type}
              </Badge>
            ) : null}
          </button>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {question.knowledge_points.map((kp) => kp.name).join(" / ") || "未绑定知识点"}
            </span>
            <TooltipButton
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              tooltip="从试题篮移除"
              onClick={() => removeSelected(question.id)}
            >
              <Trash2 className="h-4 w-4" />
            </TooltipButton>
          </div>
        </div>
      ))}
    </div>
  );

  if (!courseId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        缺少课程 ID，无法创建试卷。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageIntroHeader
        title="创建试卷"
        description={`${course?.name ?? "课程"} · 已选 ${selectedIds.length} 题`}
        onBack={() => navigate(defaultBackTo)}
        backLabel="返回课程详情"
        embedded
        className="sticky top-0 z-20 shrink-0"
        actions={
          <>
            <Button
              type="button"
              variant={previewMode ? "default" : "outline"}
              size="sm"
              disabled={selectedIds.length === 0}
              onClick={() => setPreviewMode((current) => !current)}
            >
              <ListChecks className="h-4 w-4" />
              {previewMode ? "退出预览" : "预览"}
            </Button>
            <Button
              ref={basketButtonRef}
              type="button"
              size="sm"
              onClick={() => setBasketOpen(true)}
            >
              <ShoppingBasket className="h-4 w-4" />
              试题篮 {selectedIds.length}
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载课程题库...
        </div>
      ) : loadError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{loadError}</p>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-[280px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">课程知识点</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  默认显示一级节点，可展开子节点
                </p>
              </div>
              <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {tree ? renderKnowledgeNode(tree) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无知识点
                </div>
              )}
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="shrink-0 border-b border-border/60 p-4">
              <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_auto]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="搜索题干、标题、选项或知识点"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={typeFilter}
                  onValueChange={(value) => setTypeFilter(value as SelectValueType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="全部题型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TYPES}>全部题型</SelectItem>
                    {QUESTION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {QUESTION_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!previewMode ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" className="w-full lg:w-auto">
                        <Plus className="h-4 w-4" />
                        增加题目
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setManualKnowledgePointId(
                            activeKnowledgePointId && activeKnowledgePointId !== rootKnowledgePointId
                              ? activeKnowledgePointId
                              : rootKnowledgePointId ?? "",
                          );
                          setManualOpen(true);
                        }}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        手动增加
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setAiKnowledgePointId(
                            activeKnowledgePointId && activeKnowledgePointId !== rootKnowledgePointId
                              ? activeKnowledgePointId
                              : rootKnowledgePointId ?? "",
                          );
                          setAiOpen(true);
                        }}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        AI 生成
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              {renderQuestionList()}
            </div>
          </main>
        </div>
      )}

      <Drawer open={basketOpen} onOpenChange={setBasketOpen} direction="right">
        <DrawerContent className="bottom-0 right-0 top-0 w-[min(620px,calc(100vw-1rem))] border-l border-border shadow-2xl">
          <DrawerHeader>
            <div className="min-w-0">
              <DrawerTitle>试题篮</DrawerTitle>
              <DrawerDescription>
                已选 {selectedIds.length} 道题，可保存为试卷或继续作为草稿保留。
              </DrawerDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => setBasketOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
              <Tabs value={basketView} onValueChange={(value) => setBasketView(value as BasketView)}>
                <TabsList>
                  <TabsTrigger value="order">按顺序</TabsTrigger>
                  <TabsTrigger value="type">按题型</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectedIds.length === 0}
                  onClick={() => {
                    setPreviewMode(true);
                    setBasketOpen(false);
                  }}
                >
                  预览
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={selectedIds.length === 0}
                  onClick={clearSelected}
                >
                  全部清空
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {selectedQuestionItems.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <ShoppingBasket className="h-8 w-8 opacity-30" />
                  暂无已选题目
                </div>
              ) : (
                <>
                  <Tabs value={basketView} className="contents">
                    <TabsContent value="order" className="mt-0">
                      {renderBasketQuestions(selectedQuestionItems, true)}
                    </TabsContent>
                    <TabsContent value="type" className="mt-0">
                      <div className="flex flex-col gap-4">
                        {selectedGroups.map(([type, items]) => (
                          <section key={type} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {QUESTION_TYPE_LABELS[type] ?? type}
                              </p>
                              <Badge variant="outline">{items.length} 题</Badge>
                            </div>
                            {renderBasketQuestions(items)}
                          </section>
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBasketOpen(false);
                  toast({ title: "已保存为草稿", description: "下次进入创建试卷时可继续。" });
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => setSaveDialogOpen(true)}
              >
                保存试卷
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={Boolean(draftPrompt)} onOpenChange={() => undefined}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>继续上次组卷？</DialogTitle>
            <DialogDescription>
              检测到试题篮里有 {draftPrompt?.selectedIds.length ?? 0} 道上次选择的题目，可以继续，也可以重新开始。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={restartDraft}>
              重新开始
            </Button>
            <Button type="button" onClick={continueDraft}>
              继续组卷
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存试卷</DialogTitle>
            <DialogDescription>
              填写试卷名称后，将用试题篮中的 {selectedIds.length} 道题创建一份新试卷。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-paper-title">试卷名称</Label>
            <Input
              id="course-paper-title"
              value={paperTitle}
              onChange={(event) => setPaperTitle(event.target.value)}
              placeholder={`${course?.name ?? "课程"}试卷`}
              disabled={savingPaper}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={savingPaper} onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={savingPaper} onClick={handleSavePaper}>
              {savingPaper ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>手动增加题目</DialogTitle>
            <DialogDescription>
              题目会保存到「{courseBankName}」，并自动加入试题篮。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-question-type">题型</Label>
                <Select
                  value={manualType}
                  onValueChange={(value) => setManualType(value as ManualQuestionType)}
                  disabled={manualSaving}
                >
                  <SelectTrigger id="manual-question-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_QUESTION_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-question-knowledge">知识点</Label>
                <Select
                  value={manualKnowledgePointId || rootKnowledgePointId || ""}
                  onValueChange={setManualKnowledgePointId}
                  disabled={manualSaving}
                >
                  <SelectTrigger id="manual-question-knowledge">
                    <SelectValue placeholder="选择知识点" />
                  </SelectTrigger>
                  <SelectContent>
                    {flatNodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        {"　".repeat(Math.max(0, node.depth))}
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <QuestionEditFormContent
              key={`${manualType}-${manualKnowledgePoint?.id ?? "none"}-${courseBank?.id ?? "no-bank"}`}
              question={manualQuestionDraft}
              banks={courseBank ? [courseBank] : banks}
              allTags={allTags}
              knowledgePoints={knowledgePoints}
              isSubmitting={manualSaving || ensuringBank}
              submitLabel="保存并加入试题篮"
              cancelLabel="取消"
              showHeader={false}
              showQuestionBankAndTags={false}
              allowTypeChange={false}
              variant="dialog"
              onCancel={() => setManualOpen(false)}
              onSubmit={handleManualSubmit}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 生成题目</DialogTitle>
            <DialogDescription>
              生成后会保存到「{courseBankName}」，并自动加入试题篮。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-count">数量</Label>
              <Input
                id="ai-count"
                type="number"
                min={1}
                max={50}
                value={aiCount}
                disabled={aiGenerating}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setAiCount(Number.isFinite(value) ? Math.min(50, Math.max(1, value)) : 1);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-difficulty">难度</Label>
              <Select
                value={String(aiDifficulty)}
                onValueChange={(value) => setAiDifficulty(Number(value))}
                disabled={aiGenerating}
              >
                <SelectTrigger id="ai-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      难度 {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-type">题型</Label>
              <Select
                value={aiType}
                onValueChange={(value) => setAiType(value as QuestionType)}
                disabled={aiGenerating}
              >
                <SelectTrigger id="ai-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {QUESTION_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-knowledge">知识点</Label>
              <Select
                value={aiKnowledgePointId || rootKnowledgePointId || ""}
                onValueChange={setAiKnowledgePointId}
                disabled={aiGenerating}
              >
                <SelectTrigger id="ai-knowledge">
                  <SelectValue placeholder="选择知识点" />
                </SelectTrigger>
                <SelectContent>
                  {flatNodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {"　".repeat(Math.max(0, node.depth))}
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={aiGenerating} onClick={() => setAiOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={aiGenerating} onClick={handleAIGenerate}>
              {aiGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成并加入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
