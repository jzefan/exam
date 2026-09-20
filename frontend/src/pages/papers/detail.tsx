import { useEffect, useMemo, useRef, useState } from "react";
import { useList, useOne } from "@refinedev/core";
import {
  ChevronDown,
  Copy,
  FilePlus2,
  Filter,
  Hash,
  Layers,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip-button";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { QuestionReplacementDialog } from "@/components/questions/question-replacement-dialog";
import type { QuestionReplacementConfirmPayload } from "@/components/questions/question-replacement-utils";
import { QuestionSelector } from "@/pages/exams/components/QuestionSelector";
import { cn } from "@/lib/utils";
import type {
  IKnowledgePoint,
  IPaperDetail,
  IPaperQuestion,
  IQuestion,
  IQuestionBank,
  ITag,
  QuestionType,
} from "@/types";
import {
  QuestionEditFormContent,
  type QuestionEditSubmitValues,
} from "@/pages/questions/edit";
import type { ExamQuestionFormItem } from "@/pages/exams/components/exam-form-utils";
import {
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
  getQuestionTypeGroupKey,
  getQuestionTypeGroupLabel,
  getPaperQuestionAnchorId,
  splitQuestionTypeDisplayOrder,
  splitChoiceTypeLabels,
  type QuestionTypeSummary,
} from "@/pages/exams/components/paper-view-utils";
import {
  PaperScorePanel,
  type ScoreViewMode,
} from "@/pages/exams/components/PaperScorePanel";

import {
  appendPaperQuestionsWithAI,
  getDifficultyStrategyLabel,
  paperApiRequest,
  type PaperDifficultyStrategy,
} from "./api";
import { PaperAIGenerateDialog } from "./ai-generate-dialog";
import {
  applyPaperTypeScoreAllocation,
  arePaperScoreItemsEqual,
  buildPaperScoreItems,
  buildPaperScoreUpdatePayload,
  totalPaperScore,
} from "./paper-detail-score";
import {
  PaperQuickPublishDialog,
  type PaperQuickPublishMode,
} from "./quick-publish-dialog";

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: "手工创建",
  import: "导入",
  ai_generated: "AI 生成",
};

type PaperDetailNavState = {
  backTo?: string;
  backLabel?: string;
  courseOrigin?: boolean;
  courseKpId?: string;
  courseSemesterId?: string;
  courseQuestionBankName?: string;
  knowledgePointOptions?: PaperKnowledgePointOption[];
  publishExamSuccessTo?: string;
  publishPracticeSuccessTo?: string;
};

type PaperKnowledgePointOption = {
  id: string;
  name: string;
  path: string;
};

type ManualQuestionType = QuestionType | "single_choice" | "multi_choice";
type PendingPaperQuestionAction = {
  item: IPaperQuestion;
  index: number;
};

const QUESTION_REPLACE_TRANSITION_MS = 1000;

const MANUAL_QUESTION_TYPES: Array<{ value: ManualQuestionType; label: string }> = [
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_in", label: "填空题" },
  { value: "short_answer", label: "简答题" },
  { value: "essay", label: "论述题" },
  { value: "code", label: "编程题" },
];

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getQuestionTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type;
}

function toBackendQuestionType(type: ManualQuestionType): QuestionType {
  return type === "single_choice" || type === "multi_choice" ? "choice" : type;
}

function createManualQuestionDraft({
  type,
  bank,
  knowledgePoint,
}: {
  type: ManualQuestionType;
  bank: IQuestionBank | null;
  knowledgePoint: IKnowledgePoint | null | undefined;
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

function paperKnowledgePointOptionToKnowledgePoint(
  option: PaperKnowledgePointOption | undefined,
): IKnowledgePoint | null {
  if (!option) return null;
  return {
    id: option.id,
    name: option.name,
    parent_id: null,
    description: null,
    created_at: "",
  };
}

export function PaperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as PaperDetailNavState;
  const backTo = navState.backTo ?? "/papers";
  const backLabel = navState.backLabel ?? "返回试卷列表";
  const courseQuestionBankName = navState.courseQuestionBankName;
  const knowledgePointOptions = navState.knowledgePointOptions;
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [paperTitleDraft, setPaperTitleDraft] = useState("");
  const [paperRenameSaving, setPaperRenameSaving] = useState(false);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [bankAddOpen, setBankAddOpen] = useState(false);
  const [bankAddSelectedIds, setBankAddSelectedIds] = useState<string[]>([]);
  const [bankAddSaving, setBankAddSaving] = useState(false);
  const [manualQuestionType, setManualQuestionType] = useState<ManualQuestionType>("single_choice");
  const [manualKnowledgePointId, setManualKnowledgePointId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<PaperDifficultyStrategy>("similar");
  const [aiAppending, setAiAppending] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<IQuestion | null>(null);
  const [questionSaving, setQuestionSaving] = useState(false);
  const [replacingQuestionId, setReplacingQuestionId] = useState<string | null>(null);
  const [fadingOutQuestionId, setFadingOutQuestionId] = useState<string | null>(null);
  const [enteringQuestionId, setEnteringQuestionId] = useState<string | null>(null);
  const [removingQuestionId, setRemovingQuestionId] = useState<string | null>(null);
  const [pendingRemoveQuestion, setPendingRemoveQuestion] =
    useState<PendingPaperQuestionAction | null>(null);
  const [quickPublishMode, setQuickPublishMode] = useState<PaperQuickPublishMode | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [scoreDrawerOpen, setScoreDrawerOpen] = useState(false);
  const [currentPaper, setCurrentPaper] = useState<IPaperDetail | null>(null);
  const [scoreItems, setScoreItems] = useState<ExamQuestionFormItem[]>([]);
  const [initialScoreItems, setInitialScoreItems] = useState<ExamQuestionFormItem[]>([]);
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("type");
  const [pendingJumpQuestionId, setPendingJumpQuestionId] = useState<string | null>(null);
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<string, string>>
  >({});
  const [scoreSaving, setScoreSaving] = useState(false);
  const typeScoreDraftDefaultsRef = useRef<
    Partial<Record<string, string>>
  >({});
  const enteringQuestionTimerRef = useRef<number | null>(null);

  const { result: fetchedPaper, query } = useOne<IPaperDetail>({
    resource: "papers",
    id: id!,
    queryOptions: { enabled: Boolean(id) },
  });

  useEffect(() => {
    return () => {
      if (enteringQuestionTimerRef.current !== null) {
        window.clearTimeout(enteringQuestionTimerRef.current);
      }
    };
  }, []);

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
  const knowledgePoints = knowledgePointsQuery.data?.data ?? [];
  const [ensuredCourseBank, setEnsuredCourseBank] = useState<IQuestionBank | null>(null);
  const courseBank =
    ensuredCourseBank ??
    (courseQuestionBankName
      ? banks.find((bank) => bank.name === courseQuestionBankName)
      : null) ??
    null;

  useEffect(() => {
    if (!fetchedPaper) return;
    const nextScoreItems = buildPaperScoreItems(fetchedPaper);
    setCurrentPaper(fetchedPaper);
    setScoreItems(nextScoreItems);
    setInitialScoreItems(nextScoreItems);
    setTypeScoreDrafts({});
    typeScoreDraftDefaultsRef.current = {};
  }, [fetchedPaper]);

  const paperQuestions = useMemo(
    () =>
      (currentPaper?.questions ?? [])
        .map((item) => item.question)
        .filter((question): question is NonNullable<typeof question> => Boolean(question)),
    [currentPaper?.questions],
  );

  const previewItems = useMemo(
    () => buildPaperPreviewItems(scoreItems, paperQuestions),
    [paperQuestions, scoreItems],
  );

  const questionTypeSummaries = useMemo(
    () => buildQuestionTypeSummaries(previewItems, { splitChoice: true }),
    [previewItems],
  );

  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<string, string>>>(
        (acc, summary) => {
          acc[summary.key ?? summary.type] =
            summary.totalScore > 0 ? String(summary.totalScore) : "";
          return acc;
        },
        {},
      ),
    [questionTypeSummaries],
  );

  useEffect(() => {
    const previousDefaults = typeScoreDraftDefaultsRef.current;

    setTypeScoreDrafts((prev) => {
      const next = questionTypeSummaries.reduce<
        Partial<Record<string, string>>
      >((acc, summary) => {
        const key = summary.key ?? summary.type;
        const defaultValue = questionTypeDraftDefaults[key] ?? "";
        const previousDefaultValue = previousDefaults[key];
        const currentValue = prev[key];
        acc[key] =
          currentValue === undefined || currentValue === previousDefaultValue
            ? defaultValue
            : currentValue;
        return acc;
      }, {});

      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });

    typeScoreDraftDefaultsRef.current = questionTypeDraftDefaults;
  }, [questionTypeDraftDefaults, questionTypeSummaries]);

  const scoreItemByQuestionId = useMemo(
    () => new Map(scoreItems.map((item) => [item.question_id, item])),
    [scoreItems],
  );

  const scoreDirty = !arePaperScoreItemsEqual(scoreItems, initialScoreItems);
  const scoreTotal = totalPaperScore(scoreItems);
  const manualQuestionDraft = currentPaper
    ? createManualQuestionDraft({
        type: manualQuestionType,
        bank: courseBank,
        knowledgePoint:
          knowledgePoints.find((item) => item.id === manualKnowledgePointId) ??
          paperKnowledgePointOptionToKnowledgePoint(
            knowledgePointOptions?.find((item) => item.id === manualKnowledgePointId),
          ) ??
          currentPaper.root_knowledge_point,
      })
    : null;

  const canAIAppend = Boolean(currentPaper && currentPaper.questions.length > 0 && !currentPaper.archived_at);

  const bankAddSelectorIds = useMemo(
    () =>
      currentPaper
        ? Array.from(
            new Set([
              ...currentPaper.questions.map((item) => item.question_id),
              ...bankAddSelectedIds,
            ]),
          )
        : bankAddSelectedIds,
    [bankAddSelectedIds, currentPaper],
  );

  const selectorKnowledgePointOptions = useMemo<SelectedKnowledgePoint[] | undefined>(
    () =>
      knowledgePointOptions?.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
      })),
    [knowledgePointOptions],
  );

  const typeBuckets = useMemo(() => {
    if (!currentPaper) return [] as Array<{ key: string; label: string; count: number; totalScore: number }>;
    const map = new Map<string, { key: string; label: string; count: number; totalScore: number }>();
    for (const item of currentPaper.questions) {
      const key = item.question ? getQuestionTypeGroupKey(item.question) ?? "unknown" : "unknown";
      const label =
        key === "single_choice"
          ? splitChoiceTypeLabels.single_choice
          : key === "multi_choice"
            ? splitChoiceTypeLabels.multi_choice
            : getQuestionTypeLabel(item.question?.type ?? "unknown");
      const bucket = map.get(key) ?? { key, label, count: 0, totalScore: 0 };
      bucket.count += 1;
      bucket.totalScore += scoreItemByQuestionId.get(item.question_id)?.score_override ?? 0;
      map.set(key, bucket);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        (splitQuestionTypeDisplayOrder[a.key] ?? Number.MAX_SAFE_INTEGER) -
          (splitQuestionTypeDisplayOrder[b.key] ?? Number.MAX_SAFE_INTEGER) ||
        a.label.localeCompare(b.label),
    );
  }, [currentPaper, scoreItemByQuestionId]);

  const filteredQuestions = useMemo(() => {
    if (!currentPaper) return [];
    if (selectedTypes.size === 0) return currentPaper.questions;
    return currentPaper.questions.filter((item) =>
      selectedTypes.has(item.question ? getQuestionTypeGroupKey(item.question) ?? "unknown" : "unknown"),
    );
  }, [currentPaper, selectedTypes]);

  useEffect(() => {
    if (!pendingJumpQuestionId) return;
    if (!filteredQuestions.some((item) => item.question_id === pendingJumpQuestionId)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(getPaperQuestionAnchorId(pendingJumpQuestionId))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingJumpQuestionId(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredQuestions, pendingJumpQuestionId]);

  const updateQuestionScore = (questionId: string, value: string) => {
    const parsed = Number(value);
    setScoreItems((prev) =>
      prev.map((item) =>
        item.question_id === questionId
          ? {
              ...item,
              score_override: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
            }
          : item,
      ),
    );
  };

  const handleApplyTypeScore = (summary: QuestionTypeSummary) => {
    const parsed = Number(typeScoreDrafts[summary.key ?? summary.type]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({
        title: "题型总分无效",
        description: `${getQuestionTypeGroupLabel(summary)}的总分必须大于 0。`,
        variant: "destructive",
      });
      return;
    }
    setScoreItems((prev) => applyPaperTypeScoreAllocation(prev, summary, parsed));
  };

  const syncPaperState = (updated: IPaperDetail) => {
    const nextScoreItems = buildPaperScoreItems(updated);
    setCurrentPaper(updated);
    setScoreItems(nextScoreItems);
    setInitialScoreItems(nextScoreItems);
    setTypeScoreDrafts({});
    typeScoreDraftDefaultsRef.current = {};
    setSelectedTypes((prev) => {
      const availableTypes = new Set<string>(
        updated.questions.map((item) =>
          item.question ? getQuestionTypeGroupKey(item.question) ?? "unknown" : "unknown",
        ),
      );
      const next = new Set(Array.from(prev).filter((type) => availableTypes.has(type)));
      return next.size === prev.size ? prev : next;
    });
    setExpandedIds((prev) => {
      const availableIds = new Set(updated.questions.map((item) => item.question_id));
      const next = new Set(Array.from(prev).filter((questionId) => availableIds.has(questionId)));
      return next.size === prev.size ? prev : next;
    });
  };

  const patchPaperQuestions = async (
    questionItems: Array<Pick<IPaperQuestion, "question_id" | "score_override">>,
  ) => {
    if (!currentPaper) {
      throw new Error("试卷尚未加载完成");
    }
    const updated = await paperApiRequest<IPaperDetail>(`/papers/${currentPaper.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        question_items: questionItems.map((item, index) => ({
          question_id: item.question_id,
          order: index,
          score_override: item.score_override,
        })),
      }),
    });
    syncPaperState(updated);
    await query.refetch();
    return updated;
  };

  const openBankAddDialog = () => {
    setBankAddSelectedIds([]);
    setBankAddOpen(true);
  };

  const handleBankAddSelectionChange = (ids: string[]) => {
    if (!currentPaper) {
      setBankAddSelectedIds(ids);
      return;
    }
    const existingIds = new Set(currentPaper.questions.map((item) => item.question_id));
    setBankAddSelectedIds(ids.filter((questionId) => !existingIds.has(questionId)));
  };

  const handleBankAddSubmit = async () => {
    if (!currentPaper || bankAddSaving) return;
    if (bankAddSelectedIds.length === 0) {
      toast({
        title: "请选择题目",
        description: "请至少选择一道要加入试卷的题目。",
        variant: "destructive",
      });
      return;
    }
    setBankAddSaving(true);
    try {
      await patchPaperQuestions([
        ...currentPaper.questions.map((item) => ({
          question_id: item.question_id,
          score_override: item.score_override,
        })),
        ...bankAddSelectedIds.map((questionId) => ({
          question_id: questionId,
          score_override: null,
        })),
      ]);
      toast({
        title: "题目已加入",
        description: `已从题库加入 ${bankAddSelectedIds.length} 道题。`,
      });
      setBankAddOpen(false);
      setBankAddSelectedIds([]);
    } catch (error) {
      toast({
        title: "从题库添加失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBankAddSaving(false);
    }
  };

  const ensureCourseQuestionBank = async (): Promise<IQuestionBank> => {
    const bankName = courseQuestionBankName?.trim();
    if (!bankName) {
      const fallbackBank = courseBank ?? banks[0];
      if (fallbackBank) return fallbackBank;
      throw new Error("当前没有可用题库。");
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
    await banksQuery.refetch();
    setEnsuredCourseBank(created);
    return created;
  };

  const handleManualQuestionSubmit = async (values: QuestionEditSubmitValues) => {
    if (!currentPaper) return;
    setManualSaving(true);
    try {
      const bank = await ensureCourseQuestionBank();
      const explicitKnowledgePointIds = manualKnowledgePointId
        ? [manualKnowledgePointId]
        : values.knowledge_point_ids;
      const knowledgePointIds =
        explicitKnowledgePointIds.length > 0
          ? explicitKnowledgePointIds
          : currentPaper.root_knowledge_point_id
            ? [currentPaper.root_knowledge_point_id]
            : [];
      const created = await paperApiRequest<IQuestion>("/questions", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          question_bank_id: bank.id,
          knowledge_point_ids: knowledgePointIds,
          source: "manual",
        }),
      });
      await patchPaperQuestions([
        ...currentPaper.questions.map((item) => ({
          question_id: item.question_id,
          score_override: item.score_override,
        })),
        {
          question_id: created.id,
          score_override: null,
        },
      ]);
      setManualAddOpen(false);
      setManualQuestionType("single_choice");
      setManualKnowledgePointId("");
      toast({
        title: "题目已添加",
        description: `已保存到「${bank.name}」，并加入当前试卷。`,
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

  const handleAIAppend = async () => {
    if (!currentPaper) return;
    setAiAppending(true);
    try {
      const targetBank = courseQuestionBankName ? await ensureCourseQuestionBank() : courseBank;
      const beforeCount = currentPaper.questions.length;
      const updated = await appendPaperQuestionsWithAI<IPaperDetail>(currentPaper.id, {
        question_count: aiCount,
        difficulty_strategy: aiDifficulty,
        prefer_root_knowledge_point: true,
        model: "deepseek",
        ...(targetBank ? { question_bank_id: targetBank.id } : {}),
      });
      syncPaperState(updated);
      setAiPanelOpen(false);
      toast({
        title: "AI 题目已加入",
        description: `新增 ${Math.max(0, updated.questions.length - beforeCount)} 道题。`,
      });
      await query.refetch();
    } catch (error) {
      toast({
        title: "AI 添加失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAiAppending(false);
    }
  };

  const handleQuestionEditSubmit = async (values: QuestionEditSubmitValues) => {
    if (!editingQuestion || !currentPaper) return;
    setQuestionSaving(true);
    try {
      const updatedQuestion = await paperApiRequest<IQuestion>(`/questions/${editingQuestion.id}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      const updatedPaper = {
        ...currentPaper,
        questions: currentPaper.questions.map((item) =>
          item.question_id === updatedQuestion.id
            ? { ...item, question: updatedQuestion }
            : item,
        ),
      };
      syncPaperState(updatedPaper);
      setEditingQuestion(null);
      toast({
        title: "题目已更新",
        description: "当前试卷和课程题库中的题目内容已同步更新。",
      });
      await query.refetch();
    } catch (error) {
      toast({
        title: "修改题目失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setQuestionSaving(false);
    }
  };

  const resolveReplacementBank = async (question: IQuestion): Promise<IQuestionBank> => {
    if (question.question_bank_id) {
      const existing = banks.find((bank) => bank.id === question.question_bank_id);
      if (existing) return existing;
      return {
        id: question.question_bank_id,
        name: question.question_bank_name ?? "原题题库",
        description: null,
        owner_id: "",
        visibility: "private",
        question_count: 0,
        created_at: "",
      };
    }
    return ensureCourseQuestionBank();
  };

  const handleReplacementConfirmed = async (
    action: PendingPaperQuestionAction,
    { replacementQuestion }: QuestionReplacementConfirmPayload,
  ) => {
    if (!currentPaper) return;
    setReplacingQuestionId(action.item.question_id);
    try {
      setFadingOutQuestionId(action.item.question_id);
      await new Promise((resolve) =>
        window.setTimeout(resolve, QUESTION_REPLACE_TRANSITION_MS),
      );
      await patchPaperQuestions(
        currentPaper.questions.map((questionItem) =>
          questionItem.question_id === action.item.question_id
            ? {
                question_id: replacementQuestion.id,
                score_override: action.item.score_override,
              }
            : {
                question_id: questionItem.question_id,
                score_override: questionItem.score_override,
            },
        ),
      );
      if (enteringQuestionTimerRef.current !== null) {
        window.clearTimeout(enteringQuestionTimerRef.current);
      }
      setEnteringQuestionId(replacementQuestion.id);
      enteringQuestionTimerRef.current = window.setTimeout(() => {
        setEnteringQuestionId(null);
        enteringQuestionTimerRef.current = null;
      }, QUESTION_REPLACE_TRANSITION_MS);
    } finally {
      setReplacingQuestionId(null);
      setFadingOutQuestionId(null);
    }
  };

  const handleRemoveQuestion = async (item: IPaperQuestion, index: number) => {
    if (!currentPaper) return;
    if (replacingQuestionId || removingQuestionId) {
      return;
    }
    setRemovingQuestionId(item.question_id);
    try {
      await patchPaperQuestions(
        currentPaper.questions
          .filter((questionItem) => questionItem.question_id !== item.question_id)
          .map((questionItem) => ({
            question_id: questionItem.question_id,
            score_override: questionItem.score_override,
          })),
      );
      toast({ title: "题目已移除", description: `当前试卷已移除第 ${index + 1} 题。` });
    } catch (error) {
      toast({
        title: "移除题目失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setRemovingQuestionId(null);
      setPendingRemoveQuestion(null);
    }
  };

  const handleSaveScores = async () => {
    if (!currentPaper || scoreSaving) return;
    const invalidItem = scoreItems.find(
      (item) =>
        !Number.isFinite(Number(item.score_override)) ||
        Number(item.score_override) < 0,
    );
    if (invalidItem) {
      toast({
        title: "分数无效",
        description: "每道题分数必须大于或等于 0。",
        variant: "destructive",
      });
      return;
    }
    setScoreSaving(true);
    try {
      const updated = await paperApiRequest<IPaperDetail>(`/papers/${currentPaper.id}`, {
        method: "PATCH",
        body: JSON.stringify(buildPaperScoreUpdatePayload(scoreItems)),
      });
      const nextScoreItems = buildPaperScoreItems(updated);
      setCurrentPaper(updated);
      setScoreItems(nextScoreItems);
      setInitialScoreItems(nextScoreItems);
      toast({
        title: "分数已保存",
        description: `当前试卷总分 ${updated.total_score} 分。`,
      });
      await query.refetch();
    } catch (error) {
      toast({
        title: "保存分数失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setScoreSaving(false);
    }
  };

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      if (prev.has(type)) return new Set();
      return new Set([type]);
    });
  };

  const jumpToQuestion = (questionId: string) => {
    setExpandedIds((prev) => new Set(prev).add(questionId));
    setSelectedTypes(new Set());
    setPendingJumpQuestionId(questionId);
  };

  const openRenameDialog = () => {
    if (!currentPaper) return;
    setPaperTitleDraft(currentPaper.title);
    setRenameOpen(true);
  };

  const handleRenamePaper = async () => {
    if (!currentPaper || paperRenameSaving) return;
    const nextTitle = paperTitleDraft.trim();
    if (!nextTitle) {
      toast({
        title: "试卷名称不能为空",
        description: "请输入新的试卷名称。",
        variant: "destructive",
      });
      return;
    }
    setPaperRenameSaving(true);
    try {
      const updated = await paperApiRequest<IPaperDetail>(`/papers/${currentPaper.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle }),
      });
      syncPaperState(updated);
      setRenameOpen(false);
      toast({ title: "试卷名称已更新", description: updated.title });
      await query.refetch();
    } catch (error) {
      toast({
        title: "修改试卷名称失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setPaperRenameSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!currentPaper) return;
    setBusy(true);
    try {
      const created = await paperApiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title: `${currentPaper.title}（复制）`,
          description: currentPaper.description,
          source_type: "manual",
          source_paper_id: currentPaper.id,
          root_knowledge_point_id: currentPaper.root_knowledge_point_id,
          question_items: currentPaper.questions.map((item) => ({
            question_id: item.question_id,
            order: item.order,
            score_override:
              scoreItemByQuestionId.get(item.question_id)?.score_override ?? item.score_override,
          })),
        }),
      });
      toast({ title: "复制成功", description: `已创建试卷：${created.title}` });
      navigate(`/papers/${created.id}`, { state: navState });
    } catch (error) {
      toast({
        title: "复制失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (query.isLoading || !currentPaper) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-center px-6 py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载试卷中...
      </div>
    );
  }

  const archived = Boolean(currentPaper.archived_at);
  const handleBack = () => {
    navigate(backTo, {
      state: navState.courseOrigin ? { courseOrigin: true } : undefined,
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageIntroHeader
        title={currentPaper.title}
        description={currentPaper.description || "试卷详情：查看题目构成、题型分布，并可复制、AI 再生成或直接发起考试。"}
        onBack={handleBack}
        backLabel={backLabel}
        embedded
        className="sticky top-0 z-20 -mt-6 mb-6 ml-[calc(50%-50vw)] w-screen"
        actions={
          <div className="flex items-center gap-2">
            <TooltipButton
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={busy}
              tooltip="复制出一份新试卷"
            >
              <Copy className="h-4 w-4" />
              复制
            </TooltipButton>
            <TooltipButton
              variant="outline"
              size="sm"
              onClick={() => setAiDialogOpen(true)}
              disabled={busy || archived}
              tooltip="基于当前试卷 AI 生成新试卷"
            >
              <Sparkles className="h-4 w-4" />
              AI 生成新试卷
            </TooltipButton>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <TooltipButton
              variant="outline"
              size="sm"
              onClick={openRenameDialog}
              disabled={busy || archived || paperRenameSaving}
              tooltip="修改当前试卷名称"
            >
              <Pencil className="h-4 w-4" />
              修改试卷名称
            </TooltipButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={archived || currentPaper.questions.length === 0}>
                  <Send className="h-4 w-4" />
                  发布
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setQuickPublishMode("practice")}>
                  <Send className="mr-2 h-4 w-4" />
                  发布练习
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setQuickPublishMode("exam")}>
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  创建考试
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="grid gap-6 px-4 pb-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left rail: filters & meta */}
        <aside className="paper-detail-sidebar-scroll space-y-5 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          {/* Paper meta */}
          <section className="rounded-xl border border-border/60 bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                试卷信息
              </span>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">状态</dt>
                <dd className="mt-1">
                  <Badge variant={archived ? "secondary" : "default"}>
                    {archived ? "已归档" : "可用"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">来源</dt>
                <dd className="mt-0.5 font-medium">
                  {SOURCE_TYPE_LABELS[currentPaper.source_type] ?? currentPaper.source_type}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">主知识点</dt>
                <dd className="mt-0.5 font-medium">{currentPaper.root_knowledge_point?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">题目数 / 总分</dt>
                <dd className="mt-0.5 font-medium">
                  <span className="tabular-nums">{currentPaper.question_count}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="tabular-nums">{scoreTotal}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">创建人</dt>
                <dd className="mt-0.5 font-medium">{currentPaper.created_by_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">创建时间</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{formatDateTime(currentPaper.created_at)}</dd>
              </div>
            </dl>
          </section>

          {/* Type filter */}
          <section className="rounded-xl border border-border/60 bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  题型筛选
                </span>
              </div>
              {selectedTypes.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedTypes(new Set())}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  清除
                </button>
              ) : null}
            </div>

            {typeBuckets.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无题目</p>
            ) : (
              <ul className="space-y-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedTypes(new Set())}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      selectedTypes.size === 0
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground hover:bg-muted/60"
                    }`}
                  >
                    <span>全部</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {currentPaper.questions.length}
                    </span>
                  </button>
                </li>
                {typeBuckets.map((bucket) => {
                  const active = selectedTypes.has(bucket.key);
                  return (
                    <li key={bucket.key}>
                      <button
                        type="button"
                        onClick={() => toggleType(bucket.key)}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground hover:bg-muted/60"
                        }`}
                      >
                        <span className="truncate">{bucket.label}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {bucket.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>

        {/* Right content */}
        <div className="min-w-0 space-y-5">
          {/* Questions */}
          <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-5 py-3">
              <div className="flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-sm font-semibold">题目列表</h2>
                <span className="text-xs text-muted-foreground">
                  共 {filteredQuestions.length}
                  {selectedTypes.size > 0 ? ` / ${currentPaper.questions.length}` : ""} 题
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedTypes.size > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selectedTypes).map((type) => (
                      <Badge key={type} variant="secondary" className="text-xs">
                        {typeBuckets.find((bucket) => bucket.key === type)?.label ?? getQuestionTypeLabel(type)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {filteredQuestions.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      if (expandedIds.size > 0) {
                        setExpandedIds(new Set());
                      } else {
                        setExpandedIds(
                          new Set(filteredQuestions.map((item) => item.question_id)),
                        );
                      }
                    }}
                  >
                    {expandedIds.size > 0 ? "全部收起" : "全部展开"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setScoreDrawerOpen(true)}
                >
                  <SlidersHorizontal data-icon="inline-start" />
                  设置分数
                  {scoreDirty ? (
                    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                      未保存
                    </span>
                  ) : null}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={archived || aiAppending || manualSaving}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      添加题目
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={openBankAddDialog}>
                      <Layers className="mr-2 h-4 w-4" />
                      从题库中添加
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setManualAddOpen(true)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      手动添加
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAiPanelOpen(true)} disabled={!canAIAppend}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      AI 添加
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {filteredQuestions.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                {currentPaper.questions.length === 0 ? "暂无题目" : "当前筛选下没有题目"}
              </div>
            ) : (
              <div className="space-y-2 p-3 sm:p-4">
                {filteredQuestions.map((item, index) => {
                  if (!item.question) {
                    return (
                      <div
                        key={item.question_id}
                        className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground"
                      >
                        {index + 1}. 未知题目
                      </div>
                    );
                  }
                  const isExpanded = expandedIds.has(item.question_id);
                  const score =
                    scoreItemByQuestionId.get(item.question_id)?.score_override ??
                    item.score_override ??
                    item.question.score;
                  return (
                    <div
                      key={item.question_id}
                      id={getPaperQuestionAnchorId(item.question_id)}
                      className={cn(
                        "transition-all duration-1000 ease-in-out",
                        replacingQuestionId === item.question_id &&
                          fadingOutQuestionId !== item.question_id &&
                          "opacity-70",
                        fadingOutQuestionId === item.question_id && "opacity-0",
                        removingQuestionId === item.question_id && "opacity-50",
                        enteringQuestionId === item.question_id &&
                          "animate-in fade-in-0 duration-1000",
                      )}
                    >
                      <QuestionPreviewCard
                        question={{ ...item.question, score }}
                        mode="detailed"
                        expanded={isExpanded}
                        index={index + 1}
                        expandOnClick
                        hideAnswer
                        markChoiceAnswer
                        className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                        actionsPlacement="header"
                        actions={
                          <div className="flex items-center gap-1">
                            <TooltipButton
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={archived || questionSaving}
                              onClick={() => setEditingQuestion(item.question)}
                              tooltip="编辑题目"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </TooltipButton>
                            <QuestionReplacementDialog
                              question={item.question}
                              currentQuestionIds={currentPaper.questions.map(
                                (questionItem) => questionItem.question_id,
                              )}
                              request={paperApiRequest}
                              resolveTargetBank={resolveReplacementBank}
                              onConfirmReplacement={(payload) =>
                                handleReplacementConfirmed({ item, index }, payload)
                              }
                              courseKnowledgePointId={currentPaper.root_knowledge_point_id}
                              rootKnowledgePointName={
                                currentPaper.root_knowledge_point?.name
                              }
                              examTitle={currentPaper.title}
                              questionLabel={`第 ${index + 1} 题`}
                              triggerLabel="题库换题"
                              triggerTitle="题库换题"
                              triggerMode="icon"
                              triggerVariant="ghost"
                              triggerSize="icon"
                              triggerClassName="h-7 w-7"
                              disabled={
                                archived ||
                                Boolean(replacingQuestionId) ||
                                Boolean(removingQuestionId)
                              }
                              getSuccessToast={({ candidate }) => ({
                                title: `第 ${index + 1} 题已替换`,
                                description:
                                  candidate.kind === "ai"
                                    ? `已用 AI 生成并保存到「${candidate.targetBank.name}」。`
                                    : `已从「${candidate.targetBank.name}」中替换为同类题目。`,
                              })}
                            />
                            <TooltipButton
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              disabled={archived || Boolean(replacingQuestionId) || Boolean(removingQuestionId)}
                              onClick={() => setPendingRemoveQuestion({ item, index })}
                              tooltip="移除题目"
                            >
                              {removingQuestionId === item.question_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </TooltipButton>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <PaperAIGenerateDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        paperId={currentPaper.id}
        paperTitle={currentPaper.title}
        rootKnowledgePointName={currentPaper.root_knowledge_point?.name}
        generatedPaperState={navState}
      />

      <AlertDialog
        open={Boolean(pendingRemoveQuestion)}
        onOpenChange={(open) => {
          if (!open && !removingQuestionId) {
            setPendingRemoveQuestion(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除题目？</AlertDialogTitle>
            <AlertDialogDescription>
              确认从试卷中移除第 {(pendingRemoveQuestion?.index ?? 0) + 1} 题？移除后会立即更新试卷。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(removingQuestionId)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(removingQuestionId)}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingRemoveQuestion) return;
                void handleRemoveQuestion(
                  pendingRemoveQuestion.item,
                  pendingRemoveQuestion.index,
                );
              }}
            >
              {removingQuestionId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (!open && !paperRenameSaving) setRenameOpen(false);
          if (open) openRenameDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>修改试卷名称</DialogTitle>
            <DialogDescription>
              保存后会立即更新当前试卷名称。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="paper-title-draft">试卷名称</Label>
            <Input
              id="paper-title-draft"
              value={paperTitleDraft}
              onChange={(event) => setPaperTitleDraft(event.target.value)}
              disabled={paperRenameSaving}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRenamePaper();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={paperRenameSaving}
              onClick={() => setRenameOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={paperRenameSaving}
              onClick={handleRenamePaper}
            >
              {paperRenameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {quickPublishMode ? (
        <PaperQuickPublishDialog
          open={Boolean(quickPublishMode)}
          mode={quickPublishMode}
          paper={currentPaper}
          courseKpId={navState.courseKpId}
          courseSemesterId={navState.courseSemesterId}
          onOpenChange={(next) => {
            if (!next) setQuickPublishMode(null);
          }}
          onPublished={() => {
            const successTo =
              quickPublishMode === "practice"
                ? navState.publishPracticeSuccessTo
                : navState.publishExamSuccessTo;
            navigate(successTo ?? "/exams");
          }}
        />
      ) : null}

      <Dialog
        open={bankAddOpen}
        onOpenChange={(open) => {
          if (!open && !bankAddSaving) {
            setBankAddOpen(false);
            setBankAddSelectedIds([]);
          }
        }}
      >
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1300px] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>从题库中添加</DialogTitle>
            <DialogDescription>
              默认从当前课程题库筛选；保存后只会把新选择的题目追加到当前试卷。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <QuestionSelector
              selectedIds={bankAddSelectorIds}
              onChange={handleBankAddSelectionChange}
              showSummary
              renderSummary={({ total, currentBankTotal, onOpenFullscreen }) => (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      选择要加入试卷的题目
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      新增已选 {bankAddSelectedIds.length} 题
                      {currentBankTotal != null
                        ? ` · 当前题库共 ${currentBankTotal} 题`
                        : ` · 当前筛选共 ${total} 题`}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={onOpenFullscreen}>
                    <Maximize2 className="h-4 w-4" />
                    全屏显示
                  </Button>
                </div>
              )}
              initialBankName={courseQuestionBankName}
              initialBankId={courseBank?.id}
              initialBankQuestionCount={courseBank?.question_count}
              lockInitialBank={false}
              knowledgePointOptions={selectorKnowledgePointOptions}
              restrictKnowledgePointsToOptions={selectorKnowledgePointOptions !== undefined}
              fillAvailableHeight
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={bankAddSaving}
              onClick={() => {
                setBankAddOpen(false);
                setBankAddSelectedIds([]);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={bankAddSaving || bankAddSelectedIds.length === 0}
              onClick={handleBankAddSubmit}
            >
              {bankAddSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              加入试卷
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加题目</DialogTitle>
            <DialogDescription>
              题目会保存到「{courseQuestionBankName ?? courseBank?.name ?? "题库"}」，并立即加入当前试卷。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <Label htmlFor="manual-question-type">题型</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  选择题型后填写题干、答案和解析。
                </p>
              </div>
              <Select
                value={manualQuestionType}
                onValueChange={(value) => setManualQuestionType(value as ManualQuestionType)}
                disabled={manualSaving}
              >
                <SelectTrigger id="manual-question-type" className="min-w-36">
                  <SelectValue placeholder="选择题型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MANUAL_QUESTION_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <Label htmlFor="manual-question-knowledge">知识点（可选）</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  不选择时默认绑定当前课程知识点。
                </p>
              </div>
              <Select
                value={manualKnowledgePointId || "__default__"}
                onValueChange={(value) =>
                  setManualKnowledgePointId(value === "__default__" ? "" : value)
                }
                disabled={manualSaving}
              >
                <SelectTrigger id="manual-question-knowledge" className="min-w-52">
                  <SelectValue placeholder="选择知识点" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__default__">默认：当前课程知识点</SelectItem>
                    {(knowledgePointOptions ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.path || item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {manualQuestionDraft ? (
              <QuestionEditFormContent
                key={`${manualQuestionType}-${manualQuestionDraft.question_bank_id ?? "no-bank"}-${manualQuestionDraft.knowledge_points[0]?.id ?? "no-kp"}-${manualKnowledgePointId || "default-kp"}`}
                question={manualQuestionDraft}
                banks={courseBank ? [courseBank] : banks}
                allTags={allTags}
                knowledgePoints={knowledgePoints}
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

      <Dialog
        open={Boolean(editingQuestion)}
        onOpenChange={(open) => {
          if (!open && !questionSaving) setEditingQuestion(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑题目</DialogTitle>
            <DialogDescription>
              修改后会同步更新课程题库，并保留在当前试卷中。
            </DialogDescription>
          </DialogHeader>
          {editingQuestion ? (
            <QuestionEditFormContent
              key={editingQuestion.id}
              question={editingQuestion}
              banks={courseBank ? [courseBank] : banks}
              allTags={allTags}
              knowledgePoints={knowledgePoints}
              isSubmitting={questionSaving}
              submitLabel="保存题目"
              cancelLabel="取消"
              showHeader={false}
              showQuestionBankAndTags={false}
              variant="dialog"
              onCancel={() => {
                if (!questionSaving) setEditingQuestion(null);
              }}
              onSubmit={handleQuestionEditSubmit}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={aiPanelOpen} onOpenChange={setAiPanelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI 添加题目</DialogTitle>
            <DialogDescription>
              基于当前试卷题型、难度和课程知识点生成新题，生成后立即加入当前试卷。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="paper-detail-ai-count">数量</Label>
                <Input
                  id="paper-detail-ai-count"
                  type="number"
                  min={1}
                  max={50}
                  value={aiCount}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setAiCount(Number.isFinite(value) ? Math.min(50, Math.max(1, value)) : 1);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="paper-detail-ai-difficulty">难度</Label>
                <Select
                  value={aiDifficulty}
                  onValueChange={(value) => setAiDifficulty(value as PaperDifficultyStrategy)}
                >
                  <SelectTrigger id="paper-detail-ai-difficulty" className="h-10 w-full">
                    <SelectValue placeholder="选择难度" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(["similar", "easier", "harder"] as const).map((strategy) => (
                        <SelectItem key={strategy} value={strategy}>
                          {getDifficultyStrategyLabel(strategy)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!canAIAppend ? (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                当前试卷没有源题或已归档，暂不能基于试卷 AI 添加。
              </p>
            ) : null}
            <Button
              type="button"
              className="w-full"
              disabled={!canAIAppend || aiAppending}
              onClick={handleAIAppend}
            >
              {aiAppending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成并加入
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Drawer open={scoreDrawerOpen} onOpenChange={setScoreDrawerOpen} direction="right">
        <DrawerContent className="bottom-0 right-0 top-0 w-[min(460px,calc(100vw-1rem))] border-l border-border shadow-2xl">
          <DrawerHeader>
            <div className="min-w-0">
              <DrawerTitle>设置分数</DrawerTitle>
              <DrawerDescription>
                按顺序或题型调整分值，点击题号可回到题目位置。
              </DrawerDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setScoreDrawerOpen(false)}
            >
              关闭
            </Button>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <PaperScorePanel
              items={previewItems}
              questionItems={scoreItems}
              mode={scoreMode}
              onModeChange={setScoreMode}
              onQuestionScoreChange={updateQuestionScore}
              questionTypeSummaries={questionTypeSummaries}
              typeScoreDrafts={typeScoreDrafts}
              onTypeDraftChange={(type, value) =>
                setTypeScoreDrafts((prev) => ({
                  ...prev,
                  [type]: value,
                }))
              }
              onApplyTypeScore={handleApplyTypeScore}
              totalScore={scoreTotal}
              dirty={scoreDirty}
              saving={scoreSaving}
              onSave={handleSaveScores}
              title={`总题量 ${currentPaper.question_count} 题`}
              description="两个视角都只显示题号；改分后记得保存。"
              saveLabel="保存试卷分数"
              compact
              onJumpToQuestion={jumpToQuestion}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
