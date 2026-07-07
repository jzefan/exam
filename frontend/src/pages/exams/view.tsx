import { useEffect, useMemo, useRef, useState } from "react";
import { useGetIdentity, useList, useOne, useUpdate } from "@refinedev/core";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown,
  Edit3,
  Layers,
  ListOrdered,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";

import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import type {
  IExam,
  IExamQuestion,
  IExamStudent,
  IKnowledgePoint,
  IQuestion,
  IQuestionBank,
  ITag,
  QuestionType,
} from "@/types";

import { ExamStatusBadge } from "./components/ExamStatusBadge";
import {
  calculateDurationMinutes,
  getErrorMessage,
  toSubmitDateTime,
  type ExamQuestionFormItem,
} from "./components/exam-form-utils";
import {
  ExamSettingsPanel,
  type ViewSettingsValues,
} from "./components/ExamSettingsPanel";
import { PaperPreview } from "./components/PaperPreview";
import type { ScoreViewMode } from "./components/PaperScorePanel";
import { PaperSummarySidebar } from "./components/PaperSummarySidebar";
import { InvitationManagement } from "./components/InvitationManagement";
import { PositionSelector } from "./components/PositionSelector";
import { QuestionSelector } from "./components/QuestionSelector";
import {
  buildEvenScoreAllocation,
  buildQuestionJumpGroups,
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
  getPaperQuestionAnchorId,
  questionTypeLabels,
  type QuestionTypeSummary,
} from "./components/paper-view-utils";
import { getEffectiveExamStatus } from "./utils";
import {
  QuestionEditFormContent,
  type QuestionEditSubmitValues,
} from "@/pages/questions/edit";
import {
  getDifficultyStrategyLabel,
  type PaperDifficultyStrategy,
} from "@/pages/papers/api";

type ExamViewDetail = IExam & {
  questions: IExamQuestion[];
  students: IExamStudent[];
};

type ExamMockGenerateResponse = {
  exam_id: string;
  generated_question_count: number;
  reused_source_question_count: number;
  reused_bank_question_count: number;
};

type BasicInfoDraft = {
  title: string;
  description: string;
  position_id: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
};

type ManualQuestionType = QuestionType | "single_choice" | "multi_choice";

type GeneratedQuestion = {
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: Record<string, unknown>;
  analysis: string | null;
  difficulty: number;
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

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateTimeValue(value: Date | undefined): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function toPickerDate(value: string): Date | undefined {
  if (!value) return undefined;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? undefined : next;
}

function addMinutesToLocalDateTime(value: string, minutes: number): string {
  const start = toPickerDate(value);
  if (!start || !Number.isFinite(minutes) || minutes <= 0) return "";
  return toLocalDateTimeValue(new Date(start.getTime() + minutes * 60_000));
}

function toBasicInfoDraft(exam: ExamViewDetail): BasicInfoDraft {
  return {
    title: exam.title,
    description: exam.description ?? "",
    position_id: exam.position_id ?? null,
    start_time: toLocalDateTimeValue(exam.start_time ? new Date(exam.start_time) : undefined),
    end_time: toLocalDateTimeValue(exam.end_time ? new Date(exam.end_time) : undefined),
    duration_minutes: exam.duration_minutes,
  };
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
    created_by: "",
    created_by_name: "",
    created_at: now,
    updated_at: now,
  };
}

function getReadableErrorMessage(error: unknown, fallback: string) {
  const raw = getErrorMessage(error, fallback);
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // apiRequest may throw plain text or JSON text depending on backend error shape.
  }
  return raw;
}

function toSettingsValues(exam: ExamViewDetail): ViewSettingsValues {
  return {
    max_switch_count: exam.max_switch_count ?? 0,
    show_result: exam.show_result ?? true,
    allow_retake: exam.allow_retake ?? false,
  };
}

function toQuestionItems(exam: ExamViewDetail): ExamQuestionFormItem[] {
  return exam.questions.map((item, index) => ({
    question_id: item.question_id,
    order: item.order ?? index,
    score_override: item.score_override ?? item.question_score ?? null,
    source_exam_id: item.source_exam_id ?? null,
    source_question_id: item.source_question_id ?? null,
  }));
}

function areQuestionItemsEqual(
  left: ExamQuestionFormItem[],
  right: ExamQuestionFormItem[],
) {
  return (
    JSON.stringify(
      [...left]
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          question_id: item.question_id,
          order: item.order,
          score_override: item.score_override,
        })),
    ) ===
    JSON.stringify(
      [...right]
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          question_id: item.question_id,
          order: item.order,
          score_override: item.score_override,
        })),
    )
  );
}

export function ExamPaperViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // 从课程详情等来源跳转时带 backTo/backLabel，返回应回到来源页（默认回考试列表）。
  const backState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
    courseName?: string;
    defaultBankName?: string;
    courseOrigin?: boolean;
  };
  const backTo = backState.backTo ?? "/exams";
  const backLabel = backState.backLabel ?? "返回考试列表";
  const { toast } = useToast();
  const { mutate: update, mutation } = useUpdate();
  const { data: identity } = useGetIdentity<{
    primary_org?: { org_type?: string } | null;
  }>();

  const { result: exam, query } = useOne<ExamViewDetail>({
    resource: "exams",
    id: id!,
  });

  const [settings, setSettings] = useState<ViewSettingsValues | null>(null);
  const [initialSettings, setInitialSettings] =
    useState<ViewSettingsValues | null>(null);
  const [basicInfoOpen, setBasicInfoOpen] = useState(false);
  const [basicInfoDraft, setBasicInfoDraft] = useState<BasicInfoDraft | null>(null);
  const [questionItems, setQuestionItems] = useState<ExamQuestionFormItem[]>(
    [],
  );
  const [initialQuestionItems, setInitialQuestionItems] = useState<
    ExamQuestionFormItem[]
  >([]);
  const [questionOverrides, setQuestionOverrides] = useState<Record<string, IQuestion>>({});
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("order");
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<string, string>>
  >({});
  const [savingTarget, setSavingTarget] = useState<
    "basic" | "settings" | "scores" | null
  >(null);
  const [hydrated, setHydrated] = useState(false);
  const [mockDialogOpen, setMockDialogOpen] = useState(false);
  const [mockQuestionCount, setMockQuestionCount] = useState("");
  const [mockReuseRate, setMockReuseRate] = useState("80");
  const [mockTitle, setMockTitle] = useState("");
  const [mockSubmitting, setMockSubmitting] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [addQuestionsOpen, setAddQuestionsOpen] = useState(false);
  const [addQuestionIds, setAddQuestionIds] = useState<string[]>([]);
  const [bankAddSaving, setBankAddSaving] = useState(false);
  const [isAddQuestionFullscreen, setIsAddQuestionFullscreen] = useState(false);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualQuestionType, setManualQuestionType] =
    useState<ManualQuestionType>("single_choice");
  const [manualKnowledgePointId, setManualKnowledgePointId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] =
    useState<PaperDifficultyStrategy>("similar");
  const [aiAppending, setAiAppending] = useState(false);
  const typeScoreDraftDefaultsRef = useRef<
    Partial<Record<string, string>>
  >({});

  const questionIds = useMemo(
    () => questionItems.map((item) => item.question_id),
    [questionItems],
  );
  const questionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters:
      questionIds.length > 0
        ? [{ field: "id", operator: "in" as const, value: questionIds }]
        : [],
    queryOptions: { enabled: questionIds.length > 0 },
  });
  const examQuestionQuery = useList<IQuestion>({
    resource: `exams/${id}/question-details`,
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    queryOptions: { enabled: Boolean(id && exam && questionIds.length > 0) },
  });
  const addQuestionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters:
      addQuestionIds.length > 0
        ? [{ field: "id", operator: "in" as const, value: addQuestionIds }]
        : [],
    queryOptions: { enabled: addQuestionIds.length > 0 },
  });
  const banksQuery = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const banks = banksQuery.query.data?.data ?? [];
  const tagsQuery = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const allTags = tagsQuery.query.data?.data ?? [];
  const knowledgePointsQuery = useList<IKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 1000 },
  });
  const knowledgePoints = knowledgePointsQuery.query.data?.data ?? [];
  const [ensuredCourseBank, setEnsuredCourseBank] = useState<IQuestionBank | null>(null);

  useEffect(() => {
    if (!exam) return;
    const nextSettings = toSettingsValues(exam);
    const nextQuestionItems = toQuestionItems(exam);
    setSettings(nextSettings);
    setInitialSettings(nextSettings);
    setBasicInfoDraft(toBasicInfoDraft(exam));
    setQuestionItems(nextQuestionItems);
    setInitialQuestionItems(nextQuestionItems);
    setQuestionOverrides({});
    setMockQuestionCount(String(nextQuestionItems.length));
    setMockReuseRate("80");
    setMockTitle(`${exam.title} - 模拟试卷`);
    setHydrated(true);
  }, [exam]);

  const availableQuestions = useMemo(() => {
    const questionMap = new Map<string, IQuestion>();
    for (const question of examQuestionQuery.query.data?.data ?? []) {
      questionMap.set(question.id, question);
    }
    for (const question of questionQuery.query.data?.data ?? []) {
      questionMap.set(question.id, question);
    }
    for (const question of Object.values(questionOverrides)) {
      questionMap.set(question.id, question);
    }
    return Array.from(questionMap.values());
  }, [
    examQuestionQuery.query.data?.data,
    questionOverrides,
    questionQuery.query.data?.data,
  ]);

  const previewItems = useMemo(
    () => buildPaperPreviewItems(questionItems, availableQuestions),
    [availableQuestions, questionItems],
  );
  const questionTypeSummaries = useMemo(
    () => buildQuestionTypeSummaries(previewItems, { splitChoice: true }),
    [previewItems],
  );
  const questionJumpGroups = useMemo(
    () => buildQuestionJumpGroups(previewItems, questionTypeSummaries),
    [previewItems, questionTypeSummaries],
  );

  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<string, string>>>(
        (acc, summary) => {
          const key = summary.key ?? summary.type;
          acc[key] =
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

  const effectiveStatus = exam ? getEffectiveExamStatus(exam) : "draft";
  const categoryLabel = exam?.category === "practice" ? "练习" : "考试";
  const courseQuestionBankName =
    backState.defaultBankName ??
    (backState.courseName ? `${backState.courseName.trim()}-题库` : null) ??
    (exam?.knowledge_points?.[0]?.name
      ? `${exam.knowledge_points[0].name.trim()}-题库`
      : null);
  const courseBank =
    ensuredCourseBank ??
    (courseQuestionBankName
      ? banks.find((bank) => bank.name === courseQuestionBankName)
      : null) ??
    null;
  const showInvitations =
    identity?.primary_org?.org_type === "enterprise" &&
    exam?.category === "exam";
  const selectedKnowledgePoints = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...(exam?.knowledge_points ?? []),
            ...availableQuestions.flatMap(
              (question) => question.knowledge_points ?? [],
            ),
          ]
            .map((knowledgePoint) => [
              knowledgePoint.id,
              {
                id: knowledgePoint.id,
                name: knowledgePoint.name,
                path: knowledgePoint.name,
              },
            ]),
        ).values(),
      ),
    [availableQuestions, exam?.knowledge_points],
  );

  const totalScore = useMemo(
    () =>
      questionItems.reduce(
        (sum, item) => sum + (Number(item.score_override) || 0),
        0,
      ),
    [questionItems],
  );
  const manualQuestionDraft = useMemo(() => {
    if (!exam) return null;
    const selectedKnowledgePoint =
      knowledgePoints.find((item) => item.id === manualKnowledgePointId) ??
      knowledgePoints.find((item) => item.id === exam.course_kp_id) ??
      null;
    return createManualQuestionDraft({
      type: manualQuestionType,
      bank: courseBank,
      knowledgePoint: selectedKnowledgePoint,
    });
  }, [courseBank, exam, knowledgePoints, manualKnowledgePointId, manualQuestionType]);
  const canAIAppend = Boolean(exam && previewItems.length > 0);
  const aiNumericDifficulty = useMemo(() => {
    const difficulties = previewItems
      .map((item) => item.question.difficulty)
      .filter((value) => Number.isFinite(value));
    const average =
      difficulties.length > 0
        ? Math.round(
            difficulties.reduce((sum, value) => sum + value, 0) /
              difficulties.length,
          )
        : 3;
    if (aiDifficulty === "easier") return Math.max(1, average - 1);
    if (aiDifficulty === "harder") return Math.min(5, average + 1);
    return average;
  }, [aiDifficulty, previewItems]);
  const aiTypeDistribution = useMemo(() => {
    if (questionTypeSummaries.length === 0 || aiCount <= 0) return {};
    const total = questionTypeSummaries.reduce(
      (sum, summary) => sum + summary.count,
      0,
    );
    if (total <= 0) return {};

    const entries = questionTypeSummaries.map((summary) => {
      const key = summary.key ?? summary.type;
      const exact = (summary.count / total) * aiCount;
      return {
        key,
        count: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      };
    });
    let allocated = entries.reduce((sum, item) => sum + item.count, 0);
    entries
      .slice()
      .sort((left, right) => right.remainder - left.remainder)
      .forEach((item) => {
        if (allocated >= aiCount) return;
        item.count += 1;
        allocated += 1;
      });

    return Object.fromEntries(
      entries.filter((item) => item.count > 0).map((item) => [item.key, item.count]),
    );
  }, [aiCount, questionTypeSummaries]);

  const isSettingsDirty =
    settings !== null &&
    initialSettings !== null &&
    JSON.stringify(settings) !== JSON.stringify(initialSettings);
  const isScoresDirty = !areQuestionItemsEqual(
    questionItems,
    initialQuestionItems,
  );
  const originalQuestionCount = questionItems.length;
  const sourceStartDate = exam?.start_time ? new Date(exam.start_time) : null;
  const mockEndDate =
    sourceStartDate && Number.isFinite(sourceStartDate.getTime())
      ? new Date(sourceStartDate.getTime() - 60_000)
      : null;

  useEffect(() => {
    if (previewItems.length === 0) {
      setActiveQuestionId(null);
      return;
    }

    setActiveQuestionId((current) =>
      current && previewItems.some((item) => item.question.id === current)
        ? current
        : previewItems[0]?.question.id ?? null,
    );

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const closestEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              Math.abs(left.boundingClientRect.top) -
              Math.abs(right.boundingClientRect.top),
          )[0];
        const nextId =
          closestEntry?.target instanceof HTMLElement
            ? closestEntry.target.dataset.paperQuestionId
            : null;
        if (nextId) {
          setActiveQuestionId(nextId);
        }
      },
      {
        rootMargin: "-20% 0px -62% 0px",
        threshold: [0, 0.15, 0.3],
      },
    );

    previewItems.forEach((item) => {
      const node = document.getElementById(
        getPaperQuestionAnchorId(item.question.id),
      );
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [previewItems]);

  const scrollToQuestion = (questionId: string) => {
    setActiveQuestionId(questionId);
    document
      .getElementById(getPaperQuestionAnchorId(questionId))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openBasicInfoDialog = () => {
    if (!exam) return;
    setBasicInfoDraft(toBasicInfoDraft(exam));
    setBasicInfoOpen(true);
  };

  const updateBasicStartTime = (value: string) => {
    setBasicInfoDraft((prev) => {
      if (!prev) return prev;
      const durationFromRange = calculateDurationMinutes(value, prev.end_time);
      return {
        ...prev,
        start_time: value,
        duration_minutes: durationFromRange ?? prev.duration_minutes,
        end_time:
          durationFromRange !== null || !value || prev.end_time
            ? prev.end_time
            : addMinutesToLocalDateTime(value, prev.duration_minutes),
      };
    });
  };

  const updateBasicEndTime = (value: string) => {
    setBasicInfoDraft((prev) => {
      if (!prev) return prev;
      const durationFromRange = calculateDurationMinutes(prev.start_time, value);
      return {
        ...prev,
        end_time: value,
        duration_minutes: durationFromRange ?? prev.duration_minutes,
      };
    });
  };

  const updateBasicDuration = (value: number) => {
    const nextDuration = Number.isFinite(value) && value > 0 ? value : 1;
    setBasicInfoDraft((prev) =>
      prev
        ? {
            ...prev,
            duration_minutes: nextDuration,
            end_time: prev.start_time
              ? addMinutesToLocalDateTime(prev.start_time, nextDuration)
              : prev.end_time,
          }
        : prev,
    );
  };

  const handleSaveBasicInfo = () => {
    if (!id || !basicInfoDraft) return;
    const title = basicInfoDraft.title.trim();
    if (!title) {
      toast({
        title: "名称不能为空",
        description: `请输入${categoryLabel}名称。`,
        variant: "destructive",
      });
      return;
    }
    setSavingTarget("basic");
    update(
      {
        resource: "exams",
        id,
        values: {
          title,
          description: basicInfoDraft.description.trim() || null,
          position_id: basicInfoDraft.position_id || null,
          start_time: toSubmitDateTime(basicInfoDraft.start_time),
          end_time: toSubmitDateTime(basicInfoDraft.end_time),
          duration_minutes: basicInfoDraft.duration_minutes,
        },
      },
      {
        onSuccess: () => {
          setSavingTarget(null);
          setBasicInfoOpen(false);
          void query.refetch();
          toast({
            title: "保存成功",
            description: `${categoryLabel}基本信息已更新。`,
          });
        },
        onError: (error) => {
          setSavingTarget(null);
          toast({
            title: "保存失败",
            description: getErrorMessage(error, "保存基本信息失败，请稍后重试。"),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleOpenAddQuestions = () => {
    setAddQuestionIds([]);
    setAddQuestionsOpen(true);
  };

  const handleAddQuestionsOpenChange = (open: boolean) => {
    setAddQuestionsOpen(open);
    if (!open) {
      setAddQuestionIds([]);
      setIsAddQuestionFullscreen(false);
      setBankAddSaving(false);
    }
  };

  const handleConfirmAddQuestions = () => {
    setBankAddSaving(true);
    const existingSet = new Set(questionItems.map((item) => item.question_id));
    const nextIds = addQuestionIds.filter((questionId) => !existingSet.has(questionId));
    if (nextIds.length === 0) {
      setBankAddSaving(false);
      toast({
        title: "没有新增题目",
        description: "请选择当前考试中尚未包含的题目。",
      });
      return;
    }

    const questionMap = new Map(
      (addQuestionQuery.query.data?.data ?? []).map((question) => [
        question.id,
        question,
      ]),
    );
    setQuestionOverrides((prev) => {
      const next = { ...prev };
      for (const questionId of nextIds) {
        const question = questionMap.get(questionId);
        if (question) {
          next[questionId] = question;
        }
      }
      return next;
    });
    setQuestionItems((prev) => {
      const seen = new Set(prev.map((item) => item.question_id));
      const additions = nextIds
        .filter((questionId) => !seen.has(questionId))
        .map((questionId, index) => ({
          question_id: questionId,
          order: prev.length + index,
          score_override: questionMap.get(questionId)?.score ?? 0,
        }));
      return [...prev, ...additions].map((item, index) => ({
        ...item,
        order: index,
      }));
    });
    setAddQuestionsOpen(false);
    setAddQuestionIds([]);
    setBankAddSaving(false);
    toast({
      title: "题目已添加",
      description: `已追加 ${nextIds.length} 道题，系统会自动保存到当前考试。`,
    });
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
    const created = await apiRequest<IQuestionBank>("/question-banks", {
      method: "POST",
      body: JSON.stringify({
        name: bankName,
        description: "课程对应题库",
      }),
    });
    await banksQuery.query.refetch();
    setEnsuredCourseBank(created);
    return created;
  };

  const appendCreatedQuestions = (questions: IQuestion[]) => {
    if (questions.length === 0) return;
    setQuestionOverrides((prev) => {
      const next = { ...prev };
      for (const question of questions) {
        next[question.id] = question;
      }
      return next;
    });
    setQuestionItems((prev) => {
      const existing = new Set(prev.map((item) => item.question_id));
      const additions = questions
        .filter((question) => !existing.has(question.id))
        .map((question, index) => ({
          question_id: question.id,
          order: prev.length + index,
          score_override: question.score ?? 10,
        }));
      return [...prev, ...additions].map((item, index) => ({
        ...item,
        order: index,
      }));
    });
  };

  const handleManualQuestionSubmit = async (values: QuestionEditSubmitValues) => {
    if (!exam) return;
    setManualSaving(true);
    try {
      const bank = await ensureCourseQuestionBank();
      const knowledgePointIds =
        manualKnowledgePointId
          ? [manualKnowledgePointId]
          : values.knowledge_point_ids.length > 0
            ? values.knowledge_point_ids
            : exam.course_kp_id
              ? [exam.course_kp_id]
              : [];
      const created = await apiRequest<IQuestion>("/questions", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          question_bank_id: bank.id,
          knowledge_point_ids: knowledgePointIds,
          source: "manual",
        }),
      });
      appendCreatedQuestions([created]);
      setManualAddOpen(false);
      setManualQuestionType("single_choice");
      setManualKnowledgePointId("");
      toast({
        title: "题目已添加",
        description: `已保存到「${bank.name}」，并加入当前${categoryLabel}。`,
      });
      void questionQuery.query.refetch();
    } catch (error) {
      toast({
        title: "添加题目失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        variant: "destructive",
      });
    } finally {
      setManualSaving(false);
    }
  };

  const handleAIAppend = async () => {
    if (!exam || !canAIAppend || aiAppending) return;
    setAiAppending(true);
    try {
      const bank = await ensureCourseQuestionBank();
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          total_count: aiCount,
          difficulty: aiNumericDifficulty,
          type_distribution:
            Object.keys(aiTypeDistribution).length > 0
              ? aiTypeDistribution
              : undefined,
          knowledge_point_ids:
            selectedKnowledgePoints.length > 0
              ? selectedKnowledgePoints.map((item) => item.id)
              : exam.course_kp_id
                ? [exam.course_kp_id]
                : undefined,
          course_name: backState.courseName ?? exam.knowledge_points?.[0]?.name ?? "",
          exam_title: exam.title,
          model: "deepseek",
        }),
      });

      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail ?? `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const generated: GeneratedQuestion[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            generated.push({
              type: event.data.type ?? "choice",
              title: event.data.title ?? "",
              content: {
                text: event.data.content?.text ?? event.data.title ?? "",
              },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? aiNumericDifficulty,
            });
          } else if (event.type === "error") {
            throw new Error(event.message ?? "AI 生成失败");
          }
        }
      }

      const knowledgePointIds =
        selectedKnowledgePoints.length > 0
          ? selectedKnowledgePoints.map((item) => item.id)
          : exam.course_kp_id
            ? [exam.course_kp_id]
            : [];
      const createdQuestions = await Promise.all(
        generated.map((question) =>
          apiRequest<IQuestion>("/questions", {
            method: "POST",
            body: JSON.stringify({
              type: question.type,
              title: question.title || question.content.text.slice(0, 120),
              content: question.content,
              options: question.options,
              answer: question.answer,
              analysis: question.analysis,
              difficulty: question.difficulty,
              score: 10,
              source: "ai_generated",
              tag_ids: [],
              knowledge_point_ids: knowledgePointIds,
              question_bank_id: bank.id,
            }),
          }),
        ),
      );
      appendCreatedQuestions(createdQuestions);
      setAiPanelOpen(false);
      toast({
        title: "AI 题目已加入",
        description: `新增 ${createdQuestions.length} 道题。`,
      });
      void questionQuery.query.refetch();
    } catch (error) {
      toast({
        title: "AI 添加失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        variant: "destructive",
      });
    } finally {
      setAiAppending(false);
    }
  };

  const handleRemoveQuestion = (questionId: string) => {
    const confirmed = window.confirm(
      "确认从当前考试中移除这道题吗？题库中的题目不会被删除。",
    );
    if (!confirmed) return;

    setQuestionItems((prev) =>
      prev
        .filter((item) => item.question_id !== questionId)
        .map((item, index) => ({ ...item, order: index })),
    );
    setQuestionOverrides((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    toast({
      title: "题目已移除",
      description: "系统会自动保存当前考试题目列表。",
    });
  };

  const normalizeMockNumber = (
    value: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  };

  const handleOpenMockDialog = () => {
    if (!exam) return;
    setMockQuestionCount(String(originalQuestionCount));
    setMockReuseRate("80");
    setMockTitle(`${exam.title} - 模拟试卷`);
    setMockDialogOpen(true);
  };

  const handleGenerateMockExam = async () => {
    if (!exam) return;
    const questionCount = normalizeMockNumber(
      mockQuestionCount,
      originalQuestionCount,
      originalQuestionCount,
      500,
    );
    const sourceReuseRate = normalizeMockNumber(mockReuseRate, 80, 0, 100);
    setMockQuestionCount(String(questionCount));
    setMockReuseRate(String(sourceReuseRate));
    setMockSubmitting(true);
    try {
      const result = await apiRequest<ExamMockGenerateResponse>(
        `/exams/${exam.id}/mock-generate`,
        {
          method: "POST",
          body: JSON.stringify({
            question_count: questionCount,
            source_reuse_rate: sourceReuseRate,
            title: mockTitle.trim() || undefined,
          }),
        },
      );
      toast({
        title: "模拟试卷已生成",
        description: `复用原题 ${result.reused_source_question_count} 道，题库抽取 ${result.reused_bank_question_count} 道，AI 生成 ${result.generated_question_count} 道。`,
      });
      setMockDialogOpen(false);
      navigate(`/exams/${result.exam_id}`);
    } catch (error) {
      toast({
        title: "生成失败",
        description: getReadableErrorMessage(
          error,
          "生成模拟试卷失败，请稍后重试。",
        ),
        variant: "destructive",
      });
    } finally {
      setMockSubmitting(false);
    }
  };

  useEffect(() => {
    const hasUnsavedChanges = isSettingsDirty || isScoresDirty;
    if (!hasUnsavedChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isScoresDirty, isSettingsDirty]);

  const updateQuestionScore = (questionId: string, value: string) => {
    const parsed = Number(value);
    setQuestionItems((prev) =>
      prev.map((item) =>
        item.question_id === questionId
          ? {
              ...item,
              score_override: Number.isFinite(parsed) ? parsed : 0,
            }
          : item,
      ),
    );
  };

  const replaceQuestion = (oldId: string, newId: string) => {
    setQuestionItems((prev) =>
      prev.map((item) =>
        item.question_id === oldId
          ? {
              ...item,
              question_id: newId,
              source_exam_id: null,
              source_question_id: null,
            }
          : item,
      ),
    );
  };

  const handleQuestionUpdated = (updatedQuestion: IQuestion) => {
    setQuestionOverrides((prev) => ({
      ...prev,
      [updatedQuestion.id]: updatedQuestion,
    }));
    void questionQuery.query.refetch();
  };

  const applyTypeScoreAllocationToItems = (
    items: ExamQuestionFormItem[],
    summary: QuestionTypeSummary,
    totalScoreValue: number,
  ) => {
    const draftValue = totalScoreValue;
    const nextScores = buildEvenScoreAllocation(draftValue, summary.count);
    let matched = 0;
    return items.map((item) => {
      if (!summary.questionIds.includes(item.question_id)) {
        return item;
      }
      const scoreOverride = nextScores[matched] ?? item.score_override;
      matched += 1;
      return {
        ...item,
        score_override: scoreOverride,
      };
    });
  };

  const handleSaveSettings = () => {
    if (!id || !settings || !exam) return;
    setSavingTarget("settings");

    update(
      {
        resource: "exams",
        id,
        values:
          exam.category === "practice"
            ? { show_result: settings.show_result }
            : {
                max_switch_count: settings.max_switch_count,
                show_result: settings.show_result,
                allow_retake: settings.allow_retake,
              },
      },
      {
        onSuccess: () => {
          setInitialSettings(settings);
          setSavingTarget(null);
          toast({
            title: "保存成功",
            description: "考试设置已更新。",
          });
        },
        onError: (error) => {
          setSavingTarget(null);
          toast({
            title: "保存失败",
            description: getErrorMessage(
              error,
              "保存考试设置失败，请稍后重试。",
            ),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSaveScores = () => {
    if (!id) return;
    setSavingTarget("scores");
    update(
      {
        resource: "exams",
        id,
        values: {
          total_score: totalScore,
          question_items: questionItems,
        },
      },
      {
        onSuccess: () => {
          setInitialQuestionItems(questionItems);
          setSavingTarget(null);
          toast({
            title: "保存成功",
            description: "考试分数已更新。",
          });
        },
        onError: (error) => {
          setSavingTarget(null);
          toast({
            title: "保存失败",
            description: getErrorMessage(
              error,
              "保存考试分数失败，请稍后重试。",
            ),
            variant: "destructive",
          });
        },
      },
    );
  };

  useEffect(() => {
    if (
      !hydrated ||
      !isScoresDirty ||
      (savingTarget === "scores" && mutation.isPending)
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      handleSaveScores();
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    hydrated,
    isScoresDirty,
    mutation.isPending,
    questionItems,
    savingTarget,
  ]);

  if (
    query.isLoading ||
    !exam ||
    !hydrated ||
    questionQuery.query.isLoading ||
    examQuestionQuery.query.isLoading
  ) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title={exam.title}
        description={`${categoryLabel}修改 · 左侧按标准试卷格式查看完整内容，右侧适合做分数与设置的轻量调整。`}
        onBack={() => navigate(backTo)}
        backLabel={backLabel}
        fullBleed
        actions={
          <div className="flex items-center gap-2">
            {exam.category === "exam" ? (
              <Button variant="default" onClick={handleOpenMockDialog}>
                <Sparkles className="h-4 w-4" />
                生成模拟卷
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={aiAppending || manualSaving}>
                  <Plus className="h-4 w-4" />
                  添加题目
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={handleOpenAddQuestions}>
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
        }
      />

      <Dialog
        open={basicInfoOpen}
        onOpenChange={(open) => {
          if (!open && savingTarget === "basic" && mutation.isPending) return;
          setBasicInfoOpen(open);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>修改{categoryLabel}基本信息</DialogTitle>
            <DialogDescription>
              修改名称、岗位、开始结束时间与时长，保存后立即更新当前{categoryLabel}。
            </DialogDescription>
          </DialogHeader>
          {basicInfoDraft ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="exam-view-basic-title">{categoryLabel}名称</Label>
                <Input
                  id="exam-view-basic-title"
                  value={basicInfoDraft.title}
                  onChange={(event) =>
                    setBasicInfoDraft((prev) =>
                      prev ? { ...prev, title: event.target.value } : prev,
                    )
                  }
                  maxLength={200}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="exam-view-basic-description">描述</Label>
                <Input
                  id="exam-view-basic-description"
                  value={basicInfoDraft.description}
                  onChange={(event) =>
                    setBasicInfoDraft((prev) =>
                      prev ? { ...prev, description: event.target.value } : prev,
                    )
                  }
                  placeholder="可选"
                />
              </div>
              {exam.category === "exam" ? (
                <div className="flex flex-col gap-2">
                  <Label>岗位</Label>
                  <PositionSelector
                    id="exam-view-basic-position"
                    value={basicInfoDraft.position_id}
                    onChange={(positionId) =>
                      setBasicInfoDraft((prev) =>
                        prev ? { ...prev, position_id: positionId } : prev,
                      )
                    }
                  />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>开始时间</Label>
                  <DatePicker
                    value={toPickerDate(basicInfoDraft.start_time)}
                    onChange={(date) =>
                      updateBasicStartTime(toLocalDateTimeValue(date))
                    }
                    includeTime
                    placeholder="开始时间"
                    className="h-9 w-full"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>结束时间</Label>
                  <DatePicker
                    value={toPickerDate(basicInfoDraft.end_time)}
                    onChange={(date) =>
                      updateBasicEndTime(toLocalDateTimeValue(date))
                    }
                    includeTime
                    placeholder="结束时间"
                    minDateTime={toPickerDate(basicInfoDraft.start_time)}
                    className="h-9 w-full"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="exam-view-basic-duration">{categoryLabel}时长</Label>
                <div className="relative">
                  <Input
                    id="exam-view-basic-duration"
                    type="number"
                    min={1}
                    value={basicInfoDraft.duration_minutes}
                    onChange={(event) =>
                      updateBasicDuration(parseInt(event.target.value, 10) || 1)
                    }
                    className="pr-12"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    分钟
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingTarget === "basic" && mutation.isPending}
              onClick={() => setBasicInfoOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={savingTarget === "basic" && mutation.isPending}
              onClick={handleSaveBasicInfo}
            >
              {savingTarget === "basic" && mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mockDialogOpen} onOpenChange={setMockDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>生成模拟试卷</DialogTitle>
            <DialogDescription>
              系统会按原考试的题型比例和知识点分布组卷，优先从题库抽取，不足部分再由
              AI 自动生成。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
              <div>原考试题目：{originalQuestionCount} 题</div>
              <div>模拟卷开始时间：不设置，生成后可直接开始</div>
              <div>
                模拟卷结束时间：
                {mockEndDate && mockEndDate.getTime() > Date.now()
                  ? formatDateTime(mockEndDate.toISOString())
                  : "不限制结束时间，生成后可按需调整"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mock-title">模拟卷名称</Label>
              <Input
                id="mock-title"
                value={mockTitle}
                maxLength={200}
                onChange={(event) => setMockTitle(event.target.value)}
                placeholder={`${exam.title} - 模拟试卷`}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mock-question-count">题目数</Label>
                <Input
                  id="mock-question-count"
                  type="number"
                  min={originalQuestionCount}
                  max={500}
                  value={mockQuestionCount}
                  onChange={(event) => setMockQuestionCount(event.target.value)}
                  onBlur={() =>
                    setMockQuestionCount(
                      String(
                        normalizeMockNumber(
                          mockQuestionCount,
                          originalQuestionCount,
                          originalQuestionCount,
                          500,
                        ),
                      ),
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  不能少于原考试的 {originalQuestionCount} 题。
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mock-reuse-rate">与原考试重复率</Label>
                <div className="relative">
                  <Input
                    id="mock-reuse-rate"
                    type="number"
                    min={0}
                    max={100}
                    value={mockReuseRate}
                    onChange={(event) => setMockReuseRate(event.target.value)}
                    onBlur={() =>
                      setMockReuseRate(
                        String(normalizeMockNumber(mockReuseRate, 80, 0, 100)),
                      )
                    }
                    className="pr-10"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    %
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  默认 80%，其余题目优先从题库抽取。
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMockDialogOpen(false)}
              disabled={mockSubmitting}
            >
              取消
            </Button>
            <Button
              onClick={handleGenerateMockExam}
              disabled={mockSubmitting}
            >
              {mockSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              生成模拟卷
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addQuestionsOpen} onOpenChange={handleAddQuestionsOpenChange}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1300px] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>从题库中添加</DialogTitle>
            <DialogDescription>
              默认从当前课程题库筛选；保存后只会把新选择的题目追加到当前{categoryLabel}。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <QuestionSelector
              selectedIds={addQuestionIds}
              onChange={setAddQuestionIds}
              knowledgePointOptions={selectedKnowledgePoints}
              showSummary
              renderSummary={({ total, currentBankTotal, onOpenFullscreen }) => (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      选择要加入{categoryLabel}的题目
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      新增已选 {addQuestionIds.length} 题
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
              isFullscreen={isAddQuestionFullscreen}
              onFullscreenChange={setIsAddQuestionFullscreen}
              initialBankName={courseQuestionBankName ?? undefined}
              initialBankId={courseBank?.id}
              initialBankQuestionCount={courseBank?.question_count}
              lockInitialBank={false}
              restrictKnowledgePointsToOptions={selectedKnowledgePoints.length > 0}
              fillAvailableHeight
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              disabled={bankAddSaving}
              onClick={() => handleAddQuestionsOpenChange(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmAddQuestions}
              disabled={
                bankAddSaving ||
                addQuestionIds.length === 0 ||
                addQuestionQuery.query.isLoading
              }
            >
              {bankAddSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              加入{categoryLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加题目</DialogTitle>
            <DialogDescription>
              题目会保存到「{courseQuestionBankName ?? courseBank?.name ?? "题库"}」，并立即加入当前{categoryLabel}。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <Label htmlFor="exam-view-manual-question-type">题型</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  选择题型后填写题干、答案和解析。
                </p>
              </div>
              <Select
                value={manualQuestionType}
                onValueChange={(value) =>
                  setManualQuestionType(value as ManualQuestionType)
                }
                disabled={manualSaving}
              >
                <SelectTrigger id="exam-view-manual-question-type" className="min-w-36">
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
                <Label htmlFor="exam-view-manual-question-knowledge">知识点（可选）</Label>
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
                <SelectTrigger id="exam-view-manual-question-knowledge" className="min-w-52">
                  <SelectValue placeholder="选择知识点" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__default__">默认：当前课程知识点</SelectItem>
                    {selectedKnowledgePoints.map((item) => (
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
                key={`${manualQuestionType}-${manualQuestionDraft.question_bank_id ?? "no-bank"}-${manualKnowledgePointId || "default-kp"}`}
                question={manualQuestionDraft}
                banks={courseBank ? [courseBank] : banks}
                allTags={allTags}
                knowledgePoints={knowledgePoints}
                isSubmitting={manualSaving}
                submitLabel={`保存并加入${categoryLabel}`}
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

      <Dialog open={aiPanelOpen} onOpenChange={setAiPanelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI 添加题目</DialogTitle>
            <DialogDescription>
              基于当前{categoryLabel}题型、难度和课程知识点生成新题，生成后立即加入当前{categoryLabel}。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exam-view-ai-count">数量</Label>
                <Input
                  id="exam-view-ai-count"
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
                <Label htmlFor="exam-view-ai-difficulty">难度</Label>
                <Select
                  value={aiDifficulty}
                  onValueChange={(value) =>
                    setAiDifficulty(value as PaperDifficultyStrategy)
                  }
                >
                  <SelectTrigger id="exam-view-ai-difficulty" className="h-10 w-full">
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
                当前{categoryLabel}没有源题，暂不能基于{categoryLabel} AI 添加。
              </p>
            ) : null}
            <Button
              type="button"
              className="w-full"
              disabled={!canAIAppend || aiAppending}
              onClick={handleAIAppend}
            >
              {aiAppending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              生成并加入
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <PaperPreview
            title={exam.title}
            categoryLabel={categoryLabel}
            items={previewItems}
            scoreMode={scoreMode}
            onScoreModeChange={setScoreMode}
            questionTypeSummaries={questionTypeSummaries}
            typeScoreDrafts={typeScoreDrafts}
            onTypeScoreChange={(summary, value) => {
              const key = summary.key ?? summary.type;
              setTypeScoreDrafts((prev) => ({
                ...prev,
                [key]: value,
              }));

              const parsed = Number(value);
              if (!Number.isFinite(parsed) || parsed <= 0) {
                return;
              }

              setQuestionItems((prev) =>
                applyTypeScoreAllocationToItems(prev, summary, parsed),
              );
            }}
            onQuestionScoreChange={updateQuestionScore}
            onReplaceQuestion={replaceQuestion}
            onRemoveQuestion={handleRemoveQuestion}
            onQuestionUpdated={handleQuestionUpdated}
            courseKnowledgePointId={exam.course_kp_id}
          />

          <PaperSummarySidebar
            title={`${categoryLabel}摘要`}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={openBasicInfoDialog}
                aria-label={`修改${categoryLabel}基本信息`}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            }
          >
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{categoryLabel}</Badge>
                <ExamStatusBadge status={effectiveStatus} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">名称</span>
                  <span className="text-right font-medium text-foreground">
                    {exam.title}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">时间</span>
                  <span className="text-right font-medium text-foreground">
                    {formatDateTime(exam.start_time)} 到{" "}
                    {formatDateTime(exam.end_time)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">题目</span>
                  <span className="font-medium text-foreground">
                    {previewItems.length} 题
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">卷面总分</span>
                  <span className="font-medium text-foreground">
                    {Number(totalScore.toFixed(2)).toString()} 分
                  </span>
                </div>
                {exam.category === "exam" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">考生人数</span>
                      <span className="font-medium text-foreground">
                        {exam.total_students} 人
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">已提交</span>
                      <span className="font-medium text-foreground">
                        {exam.submitted_count} 人
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            {previewItems.length > 0 ? (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ListOrdered className="h-4 w-4 text-muted-foreground" />
                    题目序号
                  </h3>
                  <span className="font-sans text-xs lining-nums tabular-nums text-muted-foreground">
                    共 {previewItems.length} 题
                  </span>
                </div>
                <div className="space-y-1.5">
                  {questionJumpGroups.map((group) => (
                    <div
                      key={group.summary.key ?? group.summary.type}
                      className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-0"
                    >
                      <span className="pt-1 text-xs font-medium text-muted-foreground">
                        {group.summary.label ?? questionTypeLabels[group.summary.type]}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map(({ previewItem, displayIndex }) => {
                          const active =
                            activeQuestionId === previewItem.question.id;
                          return (
                            <button
                              key={previewItem.question.id}
                              type="button"
                              aria-label={`跳转到第 ${displayIndex} 题`}
                              aria-current={active ? "true" : undefined}
                              onClick={() =>
                                scrollToQuestion(previewItem.question.id)
                              }
                              className={cn(
                                "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border px-0 text-xs font-semibold lining-nums tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                active
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : previewItem.isSourceReused
                                    ? "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/8 hover:text-primary",
                              )}
                            >
                              {displayIndex}
                              {previewItem.isSourceReused ? (
                                <span
                                  className={cn(
                                    "absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full border px-0.5 text-[8px] leading-none",
                                    active
                                      ? "border-primary-foreground/70 bg-amber-300 text-amber-950"
                                      : "border-amber-200 bg-amber-100 text-amber-700",
                                  )}
                                >
                                  原
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {exam.category === "practice" &&
            selectedKnowledgePoints.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  知识点
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedKnowledgePoints.slice(0, 8).map((knowledgePoint) => (
                    <Badge key={knowledgePoint.id} variant="outline">
                      {knowledgePoint.name}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            {settings ? (
              <ExamSettingsPanel
                category={exam.category}
                values={settings}
                onChange={setSettings}
                onSave={handleSaveSettings}
                dirty={isSettingsDirty}
                saving={savingTarget === "settings" && mutation.isPending}
              />
            ) : null}

            {showInvitations ? <InvitationManagement examId={exam.id} /> : null}
          </PaperSummarySidebar>
        </div>
      </div>
    </div>
  );
}
