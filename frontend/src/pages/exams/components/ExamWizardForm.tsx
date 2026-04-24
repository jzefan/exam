import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGetIdentity, useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  getGeneratedQuestionPersistKey,
  useUnsavedGeneratedQuestionsGuard,
} from "@/hooks/use-unsaved-generated-questions-guard";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookCopy,
  CheckCircle2,
  CircleAlert,
  FileText,
  ListChecks,
  Loader2,
  Maximize2,
  Settings2,
  Sparkles,
  StopCircle,
  Users,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
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
import { DatePicker } from "@/components/ui/date-picker";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PositionSelector } from "./PositionSelector";
import { QuestionSelector } from "./QuestionSelector";
import { ClassStudentSelector } from "./ClassStudentSelector";
import { apiRequest } from "@/pages/grading/api";
import { validateTypeAllocation } from "@/pages/questions/ai-generate-utils";
import type { IKnowledgePoint, IQuestion, IQuestionBank, QuestionType } from "@/types";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { AIQuestionConfigPanel } from "@/components/questions/ai-question-config-panel";
import { AIGeneratedQuestionCard } from "@/components/questions/ai-generated-question-card";
import {
  AI_MODEL_OPTIONS,
  type AIModelProvider,
} from "@/components/questions/ai-question-config-constants";
import type { SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { AIGenerateLoadingOverlay } from "@/pages/questions/components/ai-generate-loading-overlay";
import {
  DEFAULT_NOTES,
  getPublishedExamStatus,
  type ExamFormValues as ExamForm,
  validateExamForm,
} from "./exam-form-utils";

export type ExamFormMode = "create" | "edit";

export interface ExamWizardFormProps {
  mode: ExamFormMode;
  initialValues: ExamForm;
  isPending: boolean;
  submitError: string | null;
  onSubmit: (values: ExamForm) => void;
  banner?: ReactNode;
}

type StepId = "basic" | "questions" | "students" | "settings";
type QuestionMode = "manual" | "auto" | "ai";
type KnowledgePointAllocation = {
  knowledgePointId: string;
  count: number;
};
type GeneratedQuestion = {
  index: number;
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string | boolean };
  analysis: string | null;
  difficulty: number;
  selected: boolean;
};
type QuestionTypeSummary = {
  type: QuestionType;
  count: number;
  totalScore: number;
  questionIds: string[];
};
type PreviewMode = "order" | "type";
type CreateSubmitIntent = "draft" | "publish";

const stepItems: {
  id: StepId;
  title: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    id: "basic",
    title: "基本信息",
    description: "先确定考试名称、时间与基础属性",
    icon: FileText,
  },
  {
    id: "questions",
    title: "选择题目",
    description: "支持手动选题或按条件自动出卷",
    icon: BookCopy,
  },
  {
    id: "students",
    title: "选择考生",
    description: "这一步可跳过，后续仍可补充考生",
    icon: Users,
  },
  {
    id: "settings",
    title: "考试设置",
    description: "最后确认切屏、结果展示与注意事项",
    icon: Settings2,
  },
];

const difficultyOptions = [
  { value: 1, label: "容易" },
  { value: 2, label: "较易" },
  { value: 3, label: "一般" },
  { value: 4, label: "较难" },
  { value: 5, label: "很难" },
];

const questionTypeLabels: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

const ALL_BANKS = "__all_banks__";

function toPickerDate(value: string): Date | undefined {
  if (!value) return undefined;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? undefined : next;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(value: Date | undefined): string {
  if (!value) return "";
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}T${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

function FieldHint({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  // Keep the wrapper structure stable across enabled toggles to avoid
  // remounting the input (which would steal focus on the first keystroke).
  // Show tooltip only when enabled, hovered, and not focused.
  const open = enabled && hovered && !focused;

  return (
    <TooltipProvider delayDuration={420} skipDelayDuration={120}>
      <Tooltip open={open}>
        <TooltipTrigger
          asChild
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={() => setFocused(false)}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function shuffleQuestionIds(questions: IQuestion[], count: number): IQuestion[] {
  const next = [...questions];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next.slice(0, count);
}

export function ExamWizardForm({
  mode,
  initialValues,
  isPending,
  submitError,
  onSubmit,
  banner,
}: ExamWizardFormProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<ExamForm>(initialValues);
  const [currentStep, setCurrentStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [questionMode, setQuestionMode] = useState<QuestionMode>(initialValues.question_mode ?? "manual");
  const [flowError, setFlowError] = useState<string | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [autoQuestionBankId, setAutoQuestionBankId] = useState<string | null>(null);
  const [autoQuestionCount, setAutoQuestionCount] = useState(10);
  const [autoDifficulties, setAutoDifficulties] = useState<number[]>([2, 3, 4]);
  const [autoKnowledgeAllocations, setAutoKnowledgeAllocations] = useState<KnowledgePointAllocation[]>([]);
  const [autoGeneratedMeta, setAutoGeneratedMeta] = useState<{
    count: number;
    totalScore: number;
  } | null>(null);
  const [aiQuestionCount, setAIQuestionCount] = useState(10);
  const [aiDifficulty, setAIDifficulty] = useState(3);
  const [aiTypeAlloc, setAITypeAlloc] = useState<Record<QuestionType, number>>({
    choice: 0,
    true_false: 0,
    fill_in: 0,
    short_answer: 0,
    essay: 0,
    code: 0,
  });
  const [aiModel, setAIModel] = useState<AIModelProvider>("qwen");
  const [aiSelectedKnowledgePoints, setAISelectedKnowledgePoints] = useState<SelectedKnowledgePoint[]>([]);
  const [aiPrompt, setAIPrompt] = useState("");
  const [aiQuestions, setAIQuestions] = useState<GeneratedQuestion[]>([]);
  const [aiGenerating, setAIGenerating] = useState(false);
  const [aiApplying, setAIApplying] = useState(false);
  const [persistedAIQuestionKeys, setPersistedAIQuestionKeys] = useState<string[]>([]);
  const [aiGeneratedMeta, setAIGeneratedMeta] = useState<{
    count: number;
    totalScore: number;
  } | null>(null);
  const [aiHydratedFromExisting, setAIHydratedFromExisting] = useState(false);
  const [pendingQuestionMode, setPendingQuestionMode] = useState<QuestionMode | null>(null);
  const [questionStepFullscreenOpen, setQuestionStepFullscreenOpen] = useState(false);
  const [previewFullscreenOpen, setPreviewFullscreenOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("order");
  const [createSubmitIntent, setCreateSubmitIntent] = useState<CreateSubmitIntent>("publish");
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<Partial<Record<QuestionType, string>>>({});
  const typeScoreDraftDefaultsRef = useRef<Partial<Record<QuestionType, string>>>({});
  const aiAbortRef = useRef<AbortController | null>(null);
  const currentAIPersistKeys = useMemo(
    () => aiQuestions.map((question) => getGeneratedQuestionPersistKey(question)),
    [aiQuestions],
  );
  const hasUnsavedGeneratedQuestions =
    questionMode === "ai" &&
    aiQuestions.length > 0 &&
    !aiGenerating &&
    currentAIPersistKeys.some((key) => !persistedAIQuestionKeys.includes(key));
  const { dialog: unsavedGuardDialog } = useUnsavedGeneratedQuestionsGuard({
    when: hasUnsavedGeneratedQuestions,
    message: "当前生成的题目尚未加入考试，确定离开当前页面吗？",
  });

  useEffect(() => {
    setForm(initialValues);
    setQuestionMode(initialValues.question_mode ?? "manual");
    setAIHydratedFromExisting(false);
  }, [initialValues]);

  useEffect(() => {
    if (!questionStepFullscreenOpen && !previewFullscreenOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewFullscreenOpen, questionStepFullscreenOpen]);

  const now = new Date();
  const startTimeValue = toPickerDate(form.start_time);
  const endTimeValue = toPickerDate(form.end_time);
  const validationErrors = validateExamForm(form, now, {
    allowPastStartTime: mode === "edit",
    startTimeGraceMinutes: mode === "create" ? 10 : 0,
  });
  const basicInfoValidationErrors = Object.fromEntries(
    Object.entries(validationErrors).filter(([key]) => key !== "total_score"),
  );
  const fieldErrors = showValidationErrors
    ? currentStep === 0
      ? basicInfoValidationErrors
      : validationErrors
    : {};
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialValues);

  // Per-user title uniqueness check (create mode only).
  const { data: identity } = useGetIdentity<{ id?: string }>();
  const [debouncedTitle, setDebouncedTitle] = useState(form.title.trim());
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedTitle(form.title.trim()), 300);
    return () => window.clearTimeout(t);
  }, [form.title]);

  const titleCheckEnabled =
    mode === "create" && debouncedTitle.length > 0 && Boolean(identity?.id);
  const { query: titleCheckQuery } = useList({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 1, mode: "server" },
    filters: [
      { field: "title", operator: "eq", value: debouncedTitle },
      { field: "created_by", operator: "eq", value: identity?.id },
    ],
    queryOptions: { enabled: titleCheckEnabled },
  });
  const titleConflict =
    titleCheckEnabled &&
    !titleCheckQuery.isFetching &&
    (titleCheckQuery.data?.total ?? 0) > 0;

  const { query: questionBankQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 200 },
  });
  const questionBanks = questionBankQuery.data?.data ?? [];

  const { query: knowledgePointQuery } = useList<IKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 500 },
  });
  const knowledgePoints = knowledgePointQuery.data?.data ?? [];

  const { query: autoQuestionQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: [
      ...(autoQuestionBankId
        ? [{ field: "question_bank_id", operator: "eq" as const, value: autoQuestionBankId }]
        : []),
      ...(autoDifficulties.length > 0
        ? [{ field: "difficulty", operator: "in" as const, value: autoDifficulties }]
        : []),
    ],
    queryOptions: { enabled: questionMode === "auto" && currentStep === 1 },
  });
  const autoCandidates = autoQuestionQuery.data?.data ?? [];
  const { query: selectedQuestionQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters: form.question_ids.length > 0
      ? [{ field: "id", operator: "in" as const, value: form.question_ids }]
      : [],
    queryOptions: { enabled: form.question_ids.length > 0 },
  });
  const selectedQuestions = useMemo(
    () =>
      Array.from(
        new Map((selectedQuestionQuery.data?.data ?? []).map((question) => [question.id, question])).values(),
      ),
    [selectedQuestionQuery.data?.data],
  );
  const selectedQuestionMap = useMemo(
    () => new Map(selectedQuestions.map((question) => [question.id, question])),
    [selectedQuestions],
  );
  const inferredLegacyQuestionMode = useMemo<QuestionMode | null>(() => {
    if (initialValues.question_mode) {
      return null;
    }
    if (mode !== "edit" || form.question_ids.length === 0 || selectedQuestions.length !== form.question_ids.length) {
      return null;
    }
    const allFromAIBank = selectedQuestions.every((question) => question.question_bank_name === "AI题库");
    return allFromAIBank ? "ai" : null;
  }, [form.question_ids.length, initialValues.question_mode, mode, selectedQuestions]);

  useEffect(() => {
    if (!initialValues.question_mode && inferredLegacyQuestionMode === "ai") {
      setQuestionMode("ai");
    }
  }, [inferredLegacyQuestionMode, initialValues.question_mode]);
  const sortedQuestionItems = useMemo(
    () => form.question_items.slice().sort((left, right) => left.order - right.order),
    [form.question_items],
  );
  const existingAIQuestions = useMemo<GeneratedQuestion[]>(() => {
    return sortedQuestionItems
      .map((item, index) => {
        const question = selectedQuestionMap.get(item.question_id);
        if (!question) return null;

        return {
          index,
          type: question.type,
          title: question.title,
          content: question.content,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          difficulty: question.difficulty,
          selected: true,
        };
      })
      .filter((question): question is GeneratedQuestion => question !== null);
  }, [selectedQuestionMap, sortedQuestionItems]);
  useEffect(() => {
    if (mode !== "edit" || questionMode !== "ai" || aiHydratedFromExisting || aiGenerating) {
      return;
    }
    if (existingAIQuestions.length === 0) {
      setAIHydratedFromExisting(true);
      return;
    }

    setAIQuestions(existingAIQuestions);
    setPersistedAIQuestionKeys(existingAIQuestions.map((question) => getGeneratedQuestionPersistKey(question)));
    setAIGeneratedMeta({
      count: existingAIQuestions.length,
      totalScore: sortedQuestionItems.reduce((sum, item) => sum + (Number(item.score_override) || 0), 0),
    });
    setAIHydratedFromExisting(true);
  }, [
    aiGenerating,
    aiHydratedFromExisting,
    existingAIQuestions,
    mode,
    questionMode,
    sortedQuestionItems,
  ]);
  const questionTypeSummaries = useMemo<QuestionTypeSummary[]>(() => {
    const grouped = new Map<QuestionType, QuestionTypeSummary>();

    sortedQuestionItems.forEach((item) => {
      const type = selectedQuestionMap.get(item.question_id)?.type;
      if (!type) return;

      const existing = grouped.get(type);
      if (existing) {
        existing.count += 1;
        existing.totalScore = Number((existing.totalScore + (Number(item.score_override) || 0)).toFixed(2));
        existing.questionIds.push(item.question_id);
        return;
      }

      grouped.set(type, {
        type,
        count: 1,
        totalScore: Number((Number(item.score_override) || 0).toFixed(2)),
        questionIds: [item.question_id],
      });
    });

    return (Object.keys(questionTypeLabels) as QuestionType[])
      .map((type) => grouped.get(type))
      .filter((item): item is QuestionTypeSummary => Boolean(item));
  }, [selectedQuestionMap, sortedQuestionItems]);
  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<QuestionType, string>>>((acc, summary) => {
        acc[summary.type] = String(summary.totalScore);
        return acc;
      }, {}),
    [questionTypeSummaries],
  );
  const questionItemsByType = useMemo(
    () =>
      questionTypeSummaries.map((summary) => ({
        summary,
        items: sortedQuestionItems.filter((item) => {
          const questionType = selectedQuestionMap.get(item.question_id)?.type;
          return questionType === summary.type;
        }),
      })),
    [questionTypeSummaries, selectedQuestionMap, sortedQuestionItems],
  );

  const renderQuestionPreviewList = (variant: "embedded" | "fullscreen" = "embedded") => {
    if (sortedQuestionItems.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          还没有题目，请先返回上一步选择题目。
        </div>
      );
    }

    return (
        <div
          className={cn(
            "overflow-hidden rounded-2xl bg-muted/10",
            variant === "embedded" && "exam-paper-preview-scroll max-h-[42rem] overflow-y-scroll",
          )}
        >
        {previewMode === "order"
          ? sortedQuestionItems.map((item, index) => {
              const question = selectedQuestionMap.get(item.question_id);
              const invalidScore =
                !Number.isFinite(item.score_override) || (item.score_override ?? 0) <= 0;
              const scoreInputId = `${variant}-exam-question-score-${item.question_id}`;

              return (
                <div
                  key={item.question_id}
                  className="px-4 py-2"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <Badge variant="outline">第 {index + 1} 题</Badge>
                        <span className="text-sm font-medium text-foreground/80">
                          {questionTypeLabels[question?.type ?? ""] ?? "题目"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          题库原始分数：{question?.score ?? "未设置"} 分
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <Label
                          htmlFor={scoreInputId}
                          className="text-xs text-muted-foreground"
                        >
                          考试分数
                        </Label>
                        <Input
                          id={scoreInputId}
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={item.score_override ?? ""}
                          onChange={(e) => updateQuestionScore(item.question_id, e.target.value)}
                          className={cn(
                            "h-8 w-20 bg-white px-2 text-right text-xs shadow-sm",
                            invalidScore && "border-destructive/50 text-destructive focus-visible:ring-destructive/30",
                          )}
                        />
                        <span className="text-sm text-muted-foreground">分</span>
                      </div>
                    </div>

                    {question ? (
                      <QuestionPreviewCard
                        question={question}
                        mode="detailed"
                        hideTypeBadge
                        hideAnswer
                        defaultExpanded
                        className="w-full border-0 bg-transparent p-0 shadow-none"
                      />
                    ) : (
                      <p className="text-sm font-medium text-foreground">题目 {index + 1}</p>
                    )}
                    {invalidScore && (
                      <p className="text-xs text-destructive">考试分数必须大于 0。</p>
                    )}
                  </div>
                </div>
              );
            })
          : questionItemsByType.map(({ summary, items }, groupIndex) => (
              <div
                key={summary.type}
                className={cn(
                  "px-4 py-3",
                  groupIndex > 0 && "border-t border-dashed border-border/70",
                )}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <Badge variant="outline">{questionTypeLabels[summary.type]}</Badge>
                      <span className="text-xs text-muted-foreground">{summary.count} 题</span>
                      <span className="text-xs text-muted-foreground">
                        当前合计 {summary.totalScore} 分
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Label
                        htmlFor={`type-total-score-${summary.type}`}
                        className="text-xs text-muted-foreground"
                      >
                        题型总分
                      </Label>
                      <Input
                        id={`type-total-score-${summary.type}`}
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={typeScoreDrafts[summary.type] ?? ""}
                        onChange={(e) =>
                          setTypeScoreDrafts((prev) => ({
                            ...prev,
                            [summary.type]: e.target.value,
                          }))
                        }
                        className="h-8 w-20 bg-white px-2 text-right text-xs shadow-sm"
                      />
                      <span className="text-xs text-muted-foreground">分</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        aria-label={`将${questionTypeLabels[summary.type]}总分均分到每题`}
                        onClick={() => applyTypeScoreAllocation(summary)}
                      >
                        均分到每题
                      </Button>
                    </div>
                  </div>

                  {items.map((item, index) => {
                    const question = selectedQuestionMap.get(item.question_id);
                    const invalidScore =
                      !Number.isFinite(item.score_override) || (item.score_override ?? 0) <= 0;
                    const scoreInputId = `${variant}-exam-question-score-${item.question_id}`;

                    return (
                      <div key={item.question_id} className="space-y-1 rounded-xl bg-background/70 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <Badge variant="outline">{questionTypeLabels[summary.type]} 第 {index + 1} 题</Badge>
                            <span className="text-xs text-muted-foreground">
                              题库原始分数：{question?.score ?? "未设置"} 分
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Label
                              htmlFor={scoreInputId}
                              className="text-xs text-muted-foreground"
                            >
                              考试分数
                            </Label>
                            <Input
                              id={scoreInputId}
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={item.score_override ?? ""}
                              onChange={(e) => updateQuestionScore(item.question_id, e.target.value)}
                              className={cn(
                                "h-8 w-20 bg-white px-2 text-right text-xs shadow-sm",
                                invalidScore &&
                                  "border-destructive/50 text-destructive focus-visible:ring-destructive/30",
                              )}
                            />
                            <span className="text-sm text-muted-foreground">分</span>
                          </div>
                        </div>

                        {question ? (
                          <QuestionPreviewCard
                            question={question}
                            mode="detailed"
                            hideTypeBadge
                            hideAnswer
                            expandOnHover
                            className="w-full border-0 bg-transparent p-4 shadow-none transition-all"
                          />
                        ) : (
                          <p className="text-sm font-medium text-foreground">题目 {index + 1}</p>
                        )}
                        {invalidScore && (
                          <p className="text-xs text-destructive">考试分数必须大于 0。</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
      </div>
    );
  };
  const availableKnowledgePoints = knowledgePoints
    .map((knowledgePoint) => {
      const availableCount = autoCandidates.filter((question) =>
        question.knowledge_points.some((item) => item.id === knowledgePoint.id),
      ).length;

      return {
        ...knowledgePoint,
        availableCount,
      };
    })
    .filter((knowledgePoint) => knowledgePoint.availableCount > 0);

  const allocationMap = new Map(
    autoKnowledgeAllocations.map((allocation) => [allocation.knowledgePointId, allocation]),
  );
  const aiAllocationState = validateTypeAllocation(aiQuestionCount, aiTypeAlloc);
  const aiAllocMismatch = aiAllocationState.hasCustomAllocation && !aiAllocationState.isValid;
  const requestedKnowledgeQuestionCount = autoKnowledgeAllocations.reduce(
    (sum, allocation) => sum + allocation.count,
    0,
  );
  const hasKnowledgeAllocationShortage = autoKnowledgeAllocations.some((allocation) => {
    const knowledgePoint = availableKnowledgePoints.find((item) => item.id === allocation.knowledgePointId);
    return !knowledgePoint || allocation.count > knowledgePoint.availableCount;
  });
  const isKnowledgeAllocationMode = autoKnowledgeAllocations.length > 0;

  useEffect(() => {
    setForm((prev) => {
      const existingMap = new Map(prev.question_items.map((item) => [item.question_id, item]));
      const nextQuestionItems = prev.question_ids.map((questionId, index) => {
        const existing = existingMap.get(questionId);
        const question = selectedQuestionMap.get(questionId);
        return {
          question_id: questionId,
          order: index,
          score_override:
            existing?.score_override ??
            question?.score ??
            null,
        };
      });

      if (JSON.stringify(nextQuestionItems) === JSON.stringify(prev.question_items)) {
        return prev;
      }

      return {
        ...prev,
        question_items: nextQuestionItems,
      };
    });
  }, [form.question_ids, selectedQuestionMap]);

  useEffect(() => {
    const computedTotal = Number(
      form.question_items
        .reduce((sum, item) => sum + (Number(item.score_override) || 0), 0)
        .toFixed(2),
    );

    setForm((prev) => (prev.total_score === computedTotal ? prev : { ...prev, total_score: computedTotal }));
  }, [form.question_items]);

  useEffect(() => {
    const previousDefaults = typeScoreDraftDefaultsRef.current;

    setTypeScoreDrafts((prev) => {
      const next = questionTypeSummaries.reduce<Partial<Record<QuestionType, string>>>((acc, summary) => {
        const defaultValue = questionTypeDraftDefaults[summary.type] ?? "";
        const previousDefaultValue = previousDefaults[summary.type];
        const currentValue = prev[summary.type];

        acc[summary.type] =
          currentValue === undefined || currentValue === previousDefaultValue
            ? defaultValue
            : currentValue;
        return acc;
      }, {});

      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });

    typeScoreDraftDefaultsRef.current = questionTypeDraftDefaults;
  }, [questionTypeDraftDefaults, questionTypeSummaries]);

  const updateField = <K extends keyof ExamForm>(key: K, value: ExamForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateQuestionScore = (questionId: string, value: string) => {
    const parsed = Number(value);
    setForm((prev) => ({
      ...prev,
      question_items: prev.question_items.map((item) =>
        item.question_id === questionId
          ? {
              ...item,
              score_override: Number.isFinite(parsed) ? parsed : 0,
            }
          : item,
      ),
    }));
  };

  const applyTypeScoreAllocation = (summary: QuestionTypeSummary) => {
    const draftValue = Number(typeScoreDrafts[summary.type] ?? "");
    if (!Number.isFinite(draftValue) || draftValue <= 0) {
      toast({
        variant: "destructive",
        title: "题型总分无效",
        description: `${questionTypeLabels[summary.type]}的总分必须大于 0。`,
      });
      return;
    }

    const totalCents = Math.round(draftValue * 100);
    const baseCents = Math.floor(totalCents / summary.count);
    const remainder = totalCents - baseCents * summary.count;

    setForm((prev) => {
      let matched = 0;
      return {
        ...prev,
        question_items: prev.question_items.map((item) => {
          if (!summary.questionIds.includes(item.question_id)) {
            return item;
          }

          const cents = baseCents + (matched === summary.count - 1 ? remainder : 0);
          matched += 1;
          return {
            ...item,
            score_override: Number((cents / 100).toFixed(2)),
          };
        }),
      };
    });
  };

  const markStepVisited = (stepIndex: number) => {
    setCurrentStep(stepIndex);
    setMaxVisitedStep((prev) => Math.max(prev, stepIndex));
  };

  const goNext = () => {
    setFlowError(null);

    if (currentStep === 0) {
      setShowValidationErrors(true);
      if (Object.keys(basicInfoValidationErrors).length > 0) {
        setFlowError("请先补全基本信息中的必填项。");
        return;
      }
      if (titleConflict) {
        setFlowError("已存在同名考试，请更换名称。");
        return;
      }
    }

    if (currentStep === 1 && form.question_ids.length === 0) {
      setFlowError("请先手动选择题目，或使用自动出卷生成题单。");
      return;
    }

    if (currentStep < stepItems.length - 1) {
      markStepVisited(currentStep + 1);
    }
  };

  const goPrev = () => {
    setFlowError(null);
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleNextStepClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    goNext();
  };

  const handleAutoDifficultyChange = (level: number, checked: boolean) => {
    setAutoDifficulties((prev) => {
      if (checked) {
        return prev.includes(level) ? prev : [...prev, level].sort((a, b) => a - b);
      }
      return prev.filter((item) => item !== level);
    });
  };

  const resetManualSelection = () => {
    updateField("question_ids", []);
  };

  const resetAutoSelection = () => {
    setAutoQuestionBankId(null);
    setAutoQuestionCount(10);
    setAutoDifficulties([2, 3, 4]);
    setAutoKnowledgeAllocations([]);
    setAutoGeneratedMeta(null);
    updateField("question_ids", []);
  };

  const resetAISelection = () => {
    aiAbortRef.current?.abort();
    setAIQuestionCount(10);
    setAIDifficulty(3);
    setAITypeAlloc({
      choice: 0,
      true_false: 0,
      fill_in: 0,
      short_answer: 0,
      essay: 0,
      code: 0,
    });
    setAIModel("qwen");
    setAISelectedKnowledgePoints([]);
    setAIPrompt("");
    setAIQuestions([]);
    setAIGenerating(false);
    setAIApplying(false);
    setPersistedAIQuestionKeys([]);
    setAIGeneratedMeta(null);
    updateField("question_ids", []);
  };

  const applyQuestionModeChange = (nextMode: QuestionMode) => {
    if (nextMode === questionMode) {
      return;
    }

    if (questionMode === "manual") {
      resetManualSelection();
    } else if (questionMode === "auto") {
      resetAutoSelection();
    } else {
      resetAISelection();
    }

    setQuestionMode(nextMode);
    updateField("question_mode", nextMode);
    setFlowError(null);
    setPendingQuestionMode(null);
  };

  const requestQuestionModeChange = (nextMode: QuestionMode) => {
    if (nextMode === questionMode) {
      return;
    }

    const hasManualSelection = questionMode === "manual" && form.question_ids.length > 0;
    const hasAutoSelection =
      questionMode === "auto" &&
      (form.question_ids.length > 0 ||
        autoGeneratedMeta !== null ||
        autoQuestionBankId !== null ||
        autoKnowledgeAllocations.length > 0 ||
        autoQuestionCount !== 10 ||
        autoDifficulties.join(",") !== "2,3,4");
    const hasAISelection =
      questionMode === "ai" &&
      (form.question_ids.length > 0 ||
        aiQuestions.length > 0 ||
        aiGeneratedMeta !== null ||
        aiSelectedKnowledgePoints.length > 0 ||
        aiPrompt.trim().length > 0 ||
        aiQuestionCount !== 10 ||
        aiDifficulty !== 3 ||
        aiModel !== "qwen" ||
        Object.values(aiTypeAlloc).some((count) => count > 0));

    if (hasManualSelection || hasAutoSelection || hasAISelection) {
      setPendingQuestionMode(nextMode);
      return;
    }

    applyQuestionModeChange(nextMode);
  };

  const handleKnowledgeAllocationToggle = (knowledgePointId: string, checked: boolean) => {
    setAutoGeneratedMeta(null);
    setAutoKnowledgeAllocations((prev) => {
      if (checked) {
        if (prev.some((allocation) => allocation.knowledgePointId === knowledgePointId)) {
          return prev;
        }
        return [...prev, { knowledgePointId, count: 1 }];
      }

      return prev.filter((allocation) => allocation.knowledgePointId !== knowledgePointId);
    });
  };

  const handleKnowledgeAllocationCountChange = (knowledgePointId: string, value: string) => {
    const nextCount = Math.max(0, parseInt(value, 10) || 0);
    setAutoGeneratedMeta(null);
    setAutoKnowledgeAllocations((prev) =>
      prev
        .map((allocation) =>
          allocation.knowledgePointId === knowledgePointId
            ? { ...allocation, count: nextCount }
            : allocation,
        )
        .filter((allocation) => allocation.count > 0),
    );
  };

  const handleAutoGenerate = () => {
    setFlowError(null);
    setAutoGeneratedMeta(null);

    if (autoDifficulties.length === 0) {
      setFlowError("自动出卷至少需要选择一个难度范围。");
      return;
    }

    if (!isKnowledgeAllocationMode && (!Number.isFinite(autoQuestionCount) || autoQuestionCount <= 0)) {
      setFlowError("请填写有效的出题数量。");
      return;
    }

    if (isKnowledgeAllocationMode && requestedKnowledgeQuestionCount <= 0) {
      setFlowError("请至少为一个知识点设置大于 0 的题目数量。");
      return;
    }

    if (isKnowledgeAllocationMode && hasKnowledgeAllocationShortage) {
      setFlowError("所选知识点的可用题量不足，请调整每个知识点的题目数量。");
      return;
    }

    if (!isKnowledgeAllocationMode && autoCandidates.length < autoQuestionCount) {
      setFlowError(`当前条件下只有 ${autoCandidates.length} 道题，无法生成 ${autoQuestionCount} 道试题。`);
      return;
    }

    let picked: IQuestion[] = [];
    if (isKnowledgeAllocationMode) {
      let remainingPool = [...autoCandidates];

      for (const allocation of autoKnowledgeAllocations) {
        const candidatesForKnowledge = remainingPool.filter((question) =>
          question.knowledge_points.some((knowledgePoint) => knowledgePoint.id === allocation.knowledgePointId),
        );
        const selectedForKnowledge = shuffleQuestionIds(candidatesForKnowledge, allocation.count);
        picked = [...picked, ...selectedForKnowledge];
        const selectedIds = new Set(selectedForKnowledge.map((question) => question.id));
        remainingPool = remainingPool.filter((question) => !selectedIds.has(question.id));
      }
    } else {
      picked = shuffleQuestionIds(autoCandidates, autoQuestionCount);
    }

    updateField(
      "question_ids",
      picked.map((question) => question.id),
    );
    setAutoGeneratedMeta({
      count: picked.length,
      totalScore: picked.reduce((sum, question) => sum + question.score, 0),
    });
  };

  const handleAIGenerate = useCallback(async () => {
    if (aiAllocMismatch) {
      const message = `当前题型数量之和为 ${aiAllocationState.allocated}，必须与题目总数 ${aiQuestionCount} 一致。`;
      setFlowError(message);
      toast({
        title: "AI 出题失败",
        description: message,
        variant: "destructive",
      });
      return;
    }

    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAIGenerating(true);
    setAIQuestions([]);
    setPersistedAIQuestionKeys([]);
    setAIGeneratedMeta(null);
    setFlowError(null);

    const typeDistribution = Object.fromEntries(
      Object.entries(aiTypeAlloc).filter(([, value]) => value > 0),
    );

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          total_count: aiQuestionCount,
          difficulty: aiDifficulty,
          type_distribution: Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
          knowledge_point_ids:
            aiSelectedKnowledgePoints.length > 0
              ? aiSelectedKnowledgePoints.map((item) => item.id)
              : undefined,
          prompt: aiPrompt.trim() || undefined,
          model: aiModel,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail ?? `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let questionIndex = 0;
      let nextQuestions: GeneratedQuestion[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;

          const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            const nextQuestion: GeneratedQuestion = {
              index: questionIndex++,
              type: event.data.type ?? "choice",
              title: event.data.title ?? "",
              content: { text: event.data.content?.text ?? event.data.title ?? "" },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? aiDifficulty,
              selected: true,
            };
            nextQuestions = [...nextQuestions, nextQuestion];
            setAIQuestions(nextQuestions);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "AI 生成失败");
          }
        }
      }

      setAIGeneratedMeta({
        count: nextQuestions.length,
        totalScore: nextQuestions.length * 10,
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const message = error instanceof Error ? error.message : "AI 生成失败";
        setFlowError(message);
        toast({
          title: "AI 出题失败",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setAIGenerating(false);
      aiAbortRef.current = null;
    }
  }, [
    aiAllocMismatch,
    aiAllocationState.allocated,
    aiQuestionCount,
    aiDifficulty,
    aiTypeAlloc,
    aiSelectedKnowledgePoints,
    aiPrompt,
    aiModel,
    toast,
  ]);

  const handleApplyAIQuestions = useCallback(async () => {
    const selectedAIQuestions = aiQuestions.filter((question) => question.selected);
    if (selectedAIQuestions.length === 0) {
      toast({
        title: "请选择题目",
        description: "请至少选择一道 AI 生成的题目后再加入考试。",
        variant: "destructive",
      });
      return;
    }

    setAIApplying(true);
    setFlowError(null);
    try {
      const banks = await apiRequest<Array<{ id: string; name: string }>>("/question-banks");
      let bankId = banks.find((bank) => bank.name === "AI题库")?.id;
      if (!bankId) {
        const createdBank = await apiRequest<{ id: string }>("/question-banks", {
          method: "POST",
          body: JSON.stringify({ name: "AI题库", description: "AI 自动生成的考试题目" }),
        });
        bankId = createdBank.id;
      }

      const createdQuestions = await Promise.all(
        selectedAIQuestions.map((question) =>
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
              tag_ids: [],
              knowledge_point_ids: aiSelectedKnowledgePoints.map((item) => item.id),
              question_bank_id: bankId,
            }),
          }),
        ),
      );

      updateField(
        "question_ids",
        createdQuestions.map((question) => question.id),
      );
      setPersistedAIQuestionKeys((prev) =>
        Array.from(new Set([...prev, ...selectedAIQuestions.map((question) => getGeneratedQuestionPersistKey(question))])),
      );
      setAutoGeneratedMeta(null);
      setAIGeneratedMeta({
        count: createdQuestions.length,
        totalScore: createdQuestions.reduce((sum, question) => sum + question.score, 0),
      });
      toast({
        title: "AI 题目已加入考试",
        description: `已将 ${createdQuestions.length} 道 AI 题目加入当前考试。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 题目加入考试失败";
      setFlowError(message);
      toast({
        title: "加入考试失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAIApplying(false);
    }
  }, [aiQuestions, aiSelectedKnowledgePoints, toast]);

  const stopAIGeneration = () => {
    aiAbortRef.current?.abort();
  };

  const toggleAIQuestionSelection = (index: number) => {
    setAIQuestions((prev) =>
      prev.map((question) =>
        question.index === index ? { ...question, selected: !question.selected } : question,
      ),
    );
  };

  const toggleSelectAllAIQuestions = () => {
    const allSelected = aiQuestions.every((question) => question.selected);
    setAIQuestions((prev) =>
      prev.map((question) => ({ ...question, selected: !allSelected })),
    );
  };

  const removeAIQuestion = (index: number) => {
    setAIQuestions((prev) => prev.filter((question) => question.index !== index));
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setShowValidationErrors(true);
    setFlowError(null);

    if (mode === "create" && currentStep < stepItems.length - 1) {
      goNext();
      return;
    }

    if (Object.keys(validationErrors).length > 0) {
      const message =
        mode === "create"
          ? "请先修正表单中的错误信息后再创建考试。"
          : "请先修正表单中的错误信息后再保存。";
      setFlowError(message);
      toast({
        title: mode === "create" ? "创建失败" : "保存失败",
        description: message,
        variant: "destructive",
      });
      return;
    }

    if (titleConflict) {
      setCurrentStep(0);
      const message = "已存在同名考试，请更换名称。";
      setFlowError(message);
      toast({
        title: mode === "create" ? "创建失败" : "保存失败",
        description: message,
        variant: "destructive",
      });
      return;
    }

    if (form.question_ids.length === 0) {
      setCurrentStep(1);
      const message =
        mode === "create" ? "创建考试前必须先选择题目。" : "考试必须包含至少一道题目。";
      setFlowError(message);
      toast({
        title: mode === "create" ? "创建失败" : "保存失败",
        description: message,
        variant: "destructive",
      });
      return;
    }

    if (
      form.question_items.length !== form.question_ids.length ||
      form.question_items.some((item) => !Number.isFinite(item.score_override) || (item.score_override ?? 0) <= 0)
    ) {
      setCurrentStep(3);
      const message = "请先在试卷预览中为每道题设置有效的考试分数。";
      setFlowError(message);
      toast({
        title: mode === "create" ? "创建失败" : "保存失败",
        description: message,
        variant: "destructive",
      });
      return;
    }

    setCreateSubmitIntent("publish");
    onSubmit({
      ...form,
      status: mode === "create" ? getPublishedExamStatus(form, now) : form.status,
      question_mode: questionMode,
    });
  };

  const handleSaveDraft = () => {
    setFlowError(null);
    setCreateSubmitIntent("draft");
    onSubmit({
      ...form,
      status: "draft",
      question_mode: questionMode,
    });
  };

  const currentStepId = stepItems[currentStep].id;
  const selectedDifficultyLabels = difficultyOptions
    .filter((item) => autoDifficulties.includes(item.value))
    .map((item) => item.label);
  const summaryItems = [
    { label: "已选题目", value: `${form.question_ids.length} 题` },
    { label: "已选考生", value: `${form.student_ids.length} 人` },
    { label: "考试时长", value: `${form.duration_minutes} 分钟` },
    { label: "总分", value: `${form.total_score} 分` },
  ];
  const previewModeToggleGroup = (
    <div
      role="group"
      aria-label="试卷预览展示方式"
      className="inline-flex items-center rounded-lg border border-border/70 bg-background p-0.5 shadow-sm"
    >
      <button
        type="button"
        aria-pressed={previewMode === "order"}
        className={cn(
          "h-8 rounded-md px-3 text-xs font-medium transition-colors",
          previewMode === "order"
            ? "exam-primary-soft-active shadow-sm"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
        onClick={() => setPreviewMode("order")}
      >
        按顺序展示
      </button>
      <button
        type="button"
        aria-pressed={previewMode === "type"}
        className={cn(
          "h-8 rounded-md px-3 text-xs font-medium transition-colors",
          previewMode === "type"
            ? "exam-primary-soft-active shadow-sm"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
        onClick={() => setPreviewMode("type")}
      >
        按题型展示
      </button>
    </div>
  );

  const renderQuestionStepContent = (variant: "embedded" | "fullscreen" = "embedded") => (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() => {
            requestQuestionModeChange("manual");
          }}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            questionMode === "manual"
              ? "exam-primary-soft-active shadow-sm"
              : "border-border bg-background hover:border-primary/40"
          }`}
        >
          <div className="flex items-center gap-2">
            <BookCopy
              size={14}
              className={questionMode === "manual" ? "text-primary" : "text-muted-foreground"}
            />
            <p className={cn("text-sm font-semibold", questionMode === "manual" ? "text-primary" : "text-foreground")}>手动选题</p>
            <span className={cn("ml-auto text-xs line-clamp-1", questionMode === "manual" ? "text-primary/70" : "text-muted-foreground")}>
              精确控制题目内容、题型和顺序
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            requestQuestionModeChange("auto");
          }}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            questionMode === "auto"
              ? "exam-primary-soft-active shadow-sm"
              : "border-border bg-background hover:border-primary/40"
          }`}
        >
          <div className="flex items-center gap-2">
            <Wand2
              size={14}
              className={questionMode === "auto" ? "text-primary" : "text-muted-foreground"}
            />
            <p className={cn("text-sm font-semibold", questionMode === "auto" ? "text-primary" : "text-foreground")}>自动出卷</p>
            <span className={cn("ml-auto text-xs line-clamp-1", questionMode === "auto" ? "text-primary/70" : "text-muted-foreground")}>
              按题库与难度随机抽题
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            requestQuestionModeChange("ai");
          }}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            questionMode === "ai"
              ? "exam-primary-soft-active shadow-sm"
              : "border-border bg-background hover:border-primary/40"
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles
              size={14}
              className={questionMode === "ai" ? "text-primary" : "text-muted-foreground"}
            />
            <p className={cn("text-sm font-semibold", questionMode === "ai" ? "text-primary" : "text-foreground")}>AI出题</p>
            <span className={cn("ml-auto text-xs line-clamp-1", questionMode === "ai" ? "text-primary/70" : "text-muted-foreground")}>
              按配置生成新题并直接加入考试
            </span>
          </div>
        </button>
      </div>

      {questionMode === "manual" ? (
        <QuestionSelector
          selectedIds={form.question_ids}
          onChange={(ids) => {
            updateField("question_ids", ids);
            setAutoGeneratedMeta(null);
            setAIGeneratedMeta(null);
          }}
        />
      ) : questionMode === "auto" ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
            <div className="space-y-1.5">
              <FieldHint
                label="题库范围"
                enabled={Boolean(autoQuestionBankId && autoQuestionBankId !== ALL_BANKS)}
              >
                <div>
                  <Select
                    value={autoQuestionBankId ?? ALL_BANKS}
                    onValueChange={(value) =>
                      setAutoQuestionBankId(value === ALL_BANKS ? null : value)
                    }
                  >
                    <SelectTrigger id="auto-question-bank">
                      <SelectValue placeholder="题库范围：全部题库" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_BANKS}>全部题库</SelectItem>
                      {questionBanks.map((bank) => (
                        <SelectItem key={bank.id} value={bank.id}>
                          {bank.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </FieldHint>
            </div>
            <div className="space-y-1.5">
              <FieldHint label="出题数量" enabled={Boolean(autoQuestionCount)}>
                <Input
                  id="auto-question-count"
                  type="number"
                  min={1}
                  placeholder="出题数量"
                  aria-label="出题数量"
                  value={isKnowledgeAllocationMode ? requestedKnowledgeQuestionCount : autoQuestionCount}
                  onChange={(e) => setAutoQuestionCount(parseInt(e.target.value, 10) || 0)}
                  disabled={isKnowledgeAllocationMode}
                />
              </FieldHint>
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {difficultyOptions.map((item) => {
                const checked = autoDifficulties.includes(item.value);
                return (
                  <label
                    key={item.value}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      checked
                        ? "border-primary text-primary font-medium"
                        : "border-border bg-background text-foreground"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        handleAutoDifficultyChange(item.value, value === true)
                      }
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">技能知识点配额</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  为每个知识点单独设置抽题数量。系统会显示当前筛选条件下的可用题量，不足时不可生成。
                </p>
              </div>
              {isKnowledgeAllocationMode && (
                <Badge variant="secondary">合计 {requestedKnowledgeQuestionCount} 题</Badge>
              )}
            </div>

            {knowledgePointQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">知识点加载中...</div>
            ) : availableKnowledgePoints.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                当前题库与难度条件下暂无可用于自动出卷的知识点。
              </div>
            ) : (
              <div className="space-y-2">
                {availableKnowledgePoints.map((knowledgePoint) => {
                  const allocation = allocationMap.get(knowledgePoint.id);
                  const shortage = allocation ? allocation.count > knowledgePoint.availableCount : false;

                  return (
                    <div
                      key={knowledgePoint.id}
                      className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_120px] ${
                        allocation ? "border-primary/40 bg-background" : "border-border bg-background/70"
                      }`}
                    >
                      <label className="flex items-start gap-3">
                        <Checkbox
                          checked={Boolean(allocation)}
                          onCheckedChange={(value) =>
                            handleKnowledgeAllocationToggle(knowledgePoint.id, value === true)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {knowledgePoint.name}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            当前可用 {knowledgePoint.availableCount} 题
                          </span>
                          {shortage && (
                            <span className="mt-1 flex items-center gap-1 text-xs text-destructive">
                              <CircleAlert size={12} />
                              数量不足，最多可选 {knowledgePoint.availableCount} 题
                            </span>
                          )}
                        </span>
                      </label>

                      <Input
                        type="number"
                        min={1}
                        max={knowledgePoint.availableCount}
                        aria-label={`${knowledgePoint.name}题目数量`}
                        value={allocation?.count ?? ""}
                        placeholder="题目数"
                        disabled={!allocation}
                        onChange={(e) =>
                          handleKnowledgeAllocationCountChange(knowledgePoint.id, e.target.value)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                生成题单
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  已选 {form.question_ids.length} 题
                  {autoGeneratedMeta && (
                    <span className="ml-2">
                      · 最近生成 {autoGeneratedMeta.count} 题 / {autoGeneratedMeta.totalScore} 分
                    </span>
                  )}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                满足条件后会随机抽题，并直接覆盖当前已选题目。
              </p>
            </div>
            <Button
              type="button"
              onClick={handleAutoGenerate}
              disabled={
                autoQuestionQuery.isLoading ||
                knowledgePointQuery.isLoading ||
                (isKnowledgeAllocationMode
                  ? requestedKnowledgeQuestionCount <= 0 || hasKnowledgeAllocationShortage
                  : autoQuestionCount <= 0)
              }
            >
              <Sparkles size={16} className="mr-1" />
              {autoGeneratedMeta ? "重新生成" : "生成题单"}
            </Button>
          </div>
        </div>
      ) : (
        <div className={`grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:[&>*]:self-stretch ${variant === "fullscreen" ? "2xl:grid-cols-[400px_minmax(0,1fr)]" : ""}`}>
          <AIQuestionConfigPanel
            title="AI出题设置"
            fetcher={apiRequest}
            storageKey="exam-ai-generate-recent-keywords"
            className="space-y-5"
            totalCount={aiQuestionCount}
            onTotalCountChange={setAIQuestionCount}
            difficulty={aiDifficulty}
            onDifficultyChange={setAIDifficulty}
            typeAlloc={aiTypeAlloc}
            onTypeAllocChange={setAITypeAlloc}
            model={aiModel}
            onModelChange={setAIModel}
            selectedKnowledgePoints={aiSelectedKnowledgePoints}
            onSelectedKnowledgePointsChange={setAISelectedKnowledgePoints}
            customPrompt={aiPrompt}
            onCustomPromptChange={setAIPrompt}
            allocationError={
              aiAllocMismatch
                ? `题型数量之和 (${aiAllocationState.allocated}) 与题目总数 (${aiQuestionCount}) 不一致`
                : null
            }
            footer={
              <>
                <div className="flex gap-2">
                  {!aiGenerating ? (
                    <Button type="button" className="flex-1" onClick={() => void handleAIGenerate()} disabled={aiApplying || aiAllocMismatch}>
                      <Sparkles size={16} className="mr-1" />
                      开始生成
                    </Button>
                  ) : (
                    <Button type="button" variant="destructive" className="flex-1" onClick={stopAIGeneration}>
                      <StopCircle size={16} className="mr-1" />
                      停止生成
                    </Button>
                  )}
                </div>

                {aiGenerating ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    生成中... 已生成 {aiQuestions.length} 道
                  </div>
                ) : null}
              </>
            }
          />

          <div className="relative flex min-w-0 flex-col">
            {aiQuestions.length === 0 && !aiGenerating ? (
              <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 text-muted-foreground">
                <Sparkles size={40} className="opacity-50" />
                <p className="text-sm">配置参数后点击开始生成</p>
              </div>
            ) : (
              <div className="flex min-h-full max-h-[72vh] flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-background">
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-background px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">
                    生成结果
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      已选择 {aiQuestions.filter((question) => question.selected).length}/{aiQuestions.length} 道题目
                      {aiGeneratedMeta && <span className="ml-2">· 最近生成 {aiGeneratedMeta.count} 题 / {aiGeneratedMeta.totalScore} 分</span>}
                    </span>
                  </p>
                  <div className="ml-auto flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={toggleSelectAllAIQuestions} disabled={aiQuestions.length === 0}>
                      {aiQuestions.every((question) => question.selected) ? "取消全选" : "全选"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleApplyAIQuestions()} disabled={aiApplying || aiGenerating || aiQuestions.filter((question) => question.selected).length === 0}>
                      {aiApplying && <Loader2 size={14} className="mr-1 animate-spin" />}
                      加入当前考试
                    </Button>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {aiQuestions.map((question) => (
                    <AIGeneratedQuestionCard
                      key={question.index}
                      question={question}
                      onToggleSelected={() => toggleAIQuestionSelection(question.index)}
                      onRemove={() => removeAIQuestion(question.index)}
                    />
                  ))}
                </div>
              </div>
            )}
            {aiGenerating && <AIGenerateLoadingOverlay generatedCount={aiQuestions.length} />}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {unsavedGuardDialog}
      <PageIntroHeader
        title={mode === "create" ? "创建考试" : "编辑考试"}
        description={
          mode === "create"
            ? "按步骤完成基本信息、组卷、选人和设置，最后一次性生成考试。"
            : "按步骤修改考试信息、题目、考生与考试设置。"
        }
        onBack={() => navigate("/exams")}
        backLabel="返回考试列表"
        fullBleed
      />

      {banner}

      {(submitError || flowError) && (
        <div
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {submitError ?? flowError}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="grid gap-3 md:grid-cols-4">
                {stepItems.map((step, index) => {
                  const Icon = step.icon;
                  const isActive = index === currentStep;
                  const isDone = index < currentStep;
                  // Edit mode lets users jump to any step freely; create mode
                  // still gates forward navigation behind validation.
                  const isClickable = mode === "edit" || index <= maxVisitedStep;

                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={!isClickable}
                      onClick={() => {
                        if (isClickable) {
                          setFlowError(null);
                          setCurrentStep(index);
                        }
                      }}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? "exam-primary-soft-active shadow-sm"
                          : isDone
                            ? "border-emerald-500/25 bg-emerald-500/5"
                            : "border-border bg-background"
                      } ${isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={`flex items-center justify-center rounded-full border font-semibold transition-all ${
                            isActive
                              ? "h-7 w-7 text-sm border-2 border-primary-foreground/60 bg-primary-foreground text-primary shadow-md ring-2 ring-primary-foreground/40"
                              : isDone
                                ? "h-6 w-6 text-xs border-emerald-600 bg-emerald-600 text-white"
                                : "h-6 w-6 text-xs border-border bg-muted text-muted-foreground"
                          }`}
                        >
                          {isDone ? <CheckCircle2 size={12} /> : index + 1}
                        </span>
                        <Icon
                          size={14}
                          className={
                            isActive ? "text-primary" : "text-muted-foreground"
                          }
                        />
                      </div>
                      <p
                        className={`text-sm font-semibold ${
                          isActive ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {step.title}
                      </p>
                      <p
                        className={`mt-0.5 text-xs leading-tight line-clamp-1 ${
                          isActive ? "text-primary/70" : "text-muted-foreground"
                        }`}
                      >
                        {step.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {currentStepId === "basic" && (
            <Card>
              <CardHeader>
                <CardTitle>第 1 步：填写基本信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <FieldHint label="考试名称" enabled={Boolean(form.title)}>
                    <Input
                      id="exam-title"
                      placeholder="考试名称，例如：Java 后端岗位笔试 *"
                      aria-label="考试名称"
                      value={form.title}
                      onChange={(e) => updateField("title", e.target.value)}
                      aria-invalid={Boolean(fieldErrors.title)}
                      aria-describedby={fieldErrors.title ? "exam-title-error" : undefined}
                      autoFocus
                    />
                  </FieldHint>
                  {fieldErrors.title && (
                    <p id="exam-title-error" className="text-xs text-destructive">
                      {fieldErrors.title}
                    </p>
                  )}
                  {!fieldErrors.title && titleConflict && (
                    <p className="text-xs text-destructive">
                      你已创建过同名考试，请更换名称。
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <FieldHint label="考试描述" enabled={Boolean(form.description)}>
                    <Textarea
                      id="exam-description"
                      placeholder="考试描述，给教师或考生补充一些背景说明（可选）"
                      aria-label="考试描述"
                      value={form.description}
                      onChange={(e) => updateField("description", e.target.value)}
                      rows={3}
                    />
                  </FieldHint>
                </div>

                <div className="space-y-1.5">
                  <FieldHint label="岗位" enabled={Boolean(form.position_id)}>
                    <div>
                      <PositionSelector
                        id="exam-position"
                        value={form.position_id}
                        onChange={(id) => updateField("position_id", id)}
                      />
                    </div>
                  </FieldHint>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldHint label="开始时间" enabled={Boolean(form.start_time)}>
                      <div>
                        <DatePicker
                          value={startTimeValue}
                          onChange={(date) => updateField("start_time", toLocalDateTimeValue(date))}
                          placeholder="开始时间"
                          includeTime
                          minDateTime={mode === "create" ? now : undefined}
                          className="h-9 w-full"
                        />
                      </div>
                    </FieldHint>
                    {fieldErrors.start_time && (
                      <p id="exam-start-time-error" className="text-xs text-destructive">
                        {fieldErrors.start_time}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <FieldHint label="结束时间" enabled={Boolean(form.end_time)}>
                      <div>
                        <DatePicker
                          value={endTimeValue}
                          onChange={(date) => updateField("end_time", toLocalDateTimeValue(date))}
                          placeholder="结束时间"
                          includeTime
                          minDateTime={startTimeValue ?? (mode === "create" ? now : undefined)}
                          className="h-9 w-full"
                        />
                      </div>
                    </FieldHint>
                    {fieldErrors.end_time && (
                      <p id="exam-end-time-error" className="text-xs text-destructive">
                        {fieldErrors.end_time}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldHint label="考试时长" enabled={Boolean(form.duration_minutes)}>
                      <div className="relative">
                        <Input
                          id="exam-duration"
                          type="number"
                          min={1}
                          placeholder="考试时长"
                          aria-label="考试时长（分钟）"
                          value={form.duration_minutes}
                          onChange={(e) =>
                            updateField("duration_minutes", parseInt(e.target.value, 10) || 60)
                          }
                          aria-invalid={Boolean(fieldErrors.duration_minutes)}
                          aria-describedby={fieldErrors.duration_minutes ? "exam-duration-error" : undefined}
                          className="pr-12"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                          分钟
                        </span>
                      </div>
                    </FieldHint>
                    {fieldErrors.duration_minutes && (
                      <p id="exam-duration-error" className="text-xs text-destructive">
                        {fieldErrors.duration_minutes}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <FieldHint label="总分" enabled={Boolean(form.total_score)}>
                      <div className="relative">
                        <Input
                          id="exam-total-score"
                          type="number"
                          readOnly
                          placeholder="总分自动汇总"
                          aria-label="总分"
                          value={form.total_score}
                          aria-invalid={Boolean(fieldErrors.total_score)}
                          aria-describedby={fieldErrors.total_score ? "exam-total-score-error" : undefined}
                          className="pr-8"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                          分
                        </span>
                      </div>
                    </FieldHint>
                    {fieldErrors.total_score && (
                      <p id="exam-total-score-error" className="text-xs text-destructive">
                        {fieldErrors.total_score}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      卷面总分会根据试卷预览中的考试分数自动汇总。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {currentStepId === "questions" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>第 2 步：选择题目 / 自动出卷</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setQuestionStepFullscreenOpen(true)}
                  aria-label="全屏展示第2步内容"
                >
                  <Maximize2 size={14} />
                </Button>
              </CardHeader>
              <CardContent>{renderQuestionStepContent()}</CardContent>
            </Card>
          )}

          {currentStepId === "students" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>第 3 步：选择考试考生</CardTitle>
                <p className="text-sm font-normal text-muted-foreground">
                  如果暂时不选，后续在编辑考试时仍可继续添加。
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ClassStudentSelector
                  selectedIds={form.student_ids}
                  onChange={(ids) => updateField("student_ids", ids)}
                />
              </CardContent>
            </Card>
          )}

          {currentStepId === "settings" && (
            <Card>
              <CardHeader>
                <CardTitle>第 4 步：考试设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">其它设置</p>
                    <p className="text-xs text-muted-foreground">先设置考试规则，再继续核对试卷内容与分数。</p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/40 px-4">
                    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">允许切屏次数</p>
                        <p id="exam-max-switch-count-help" className="text-xs text-muted-foreground">
                          设为 0 表示不限制切屏次数。
                        </p>
                        {fieldErrors.max_switch_count && (
                          <p className="text-xs text-destructive">{fieldErrors.max_switch_count}</p>
                        )}
                      </div>
                      <Input
                        id="exam-max-switch-count"
                        type="number"
                        min={0}
                        placeholder="0"
                        aria-label="允许切屏次数"
                        value={form.max_switch_count}
                        onChange={(e) =>
                          updateField("max_switch_count", parseInt(e.target.value, 10) || 0)
                        }
                        aria-invalid={Boolean(fieldErrors.max_switch_count)}
                        aria-describedby="exam-max-switch-count-help"
                        className="h-8 w-full md:w-28"
                      />
                    </div>

                    <div className="border-t border-border/40" />

                    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">允许已提交学生在考试期间重考</p>
                        <p className="text-xs text-muted-foreground">
                          开启后，学生提交后只要考试未结束，仍可重新开始一次新的作答。
                        </p>
                      </div>
                      <Switch
                        id="exam-allow-retake"
                        checked={form.allow_retake}
                        onCheckedChange={(checked) => updateField("allow_retake", checked)}
                      />
                    </div>

                    <div className="border-t border-border/40" />

                    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">允许查看考试结果</p>
                        <p className="text-xs text-muted-foreground">
                          考生提交后是否可以查看批改结果详情。
                        </p>
                      </div>
                      <Switch
                        id="exam-show-result"
                        checked={form.show_result}
                        onCheckedChange={(checked) => updateField("show_result", checked)}
                      />
                    </div>
                  </div>
                </div>

                {form.question_ids.length > 0 && (
                  <div className="space-y-2 border-t border-border/70 pt-7">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">试卷预览与考试分数</p>
                        <p className="text-xs text-muted-foreground">
                          点击查看试卷完整内容，并为每道题设置考试分数。
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPreviewFullscreenOpen(true)}
                      >
                        <ListChecks size={16} className="mr-2" />
                        预览与设置分数
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-4 border-t border-border/70 pt-7">
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => updateField("notes_template", DEFAULT_NOTES)}
                    >
                      使用默认模板
                    </Button>
                  </div>
                  <FieldHint label="考试注意事项" enabled={Boolean(form.notes_template)}>
                    <Textarea
                      id="exam-notes"
                      placeholder="考试注意事项，例如：请在规定时间内独立完成，不得切屏或复制外部内容"
                      aria-label="考试注意事项"
                      value={form.notes_template}
                      onChange={(e) => updateField("notes_template", e.target.value)}
                      rows={8}
                    />
                  </FieldHint>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full flex-col-reverse gap-3 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={goPrev}
                disabled={currentStep === 0}
              >
                上一步
              </Button>

              {mode === "edit" && (
                <Button
                  type="submit"
                  className="w-full sm:w-auto"
                  disabled={!isDirty || isPending}
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      保存中...
                    </span>
                  ) : (
                    "保存修改"
                  )}
                </Button>
              )}

              {currentStep < stepItems.length - 1 ? (
                <Button type="button" className="w-full sm:w-auto" onClick={handleNextStepClick}>
                  {currentStepId === "students" && form.student_ids.length === 0 ? "跳过并继续" : "下一步"}
                  <ArrowRight size={16} className="ml-1" />
                </Button>
              ) : mode === "create" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!form.title.trim() || isPending}
                    onClick={handleSaveDraft}
                  >
                    {isPending && createSubmitIntent === "draft" ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
                        保存中...
                      </span>
                    ) : (
                      "保存到草稿"
                    )}
                  </Button>
                  <Button
                    type="submit"
                    className="w-full sm:w-auto"
                    disabled={!form.title.trim() || isPending}
                  >
                    {isPending && createSubmitIntent === "publish" ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        发布中...
                      </span>
                    ) : (
                      "创建并发布"
                    )}
                  </Button>
                </>
              ) : null
              }
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-6">
            <CardHeader>
              <CardTitle className="text-base">摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">考试名称</p>
                <p className="text-sm font-semibold text-foreground">
                  {form.title.trim() || "未填写"}
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                {summaryItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">组卷方式</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={questionMode === "manual" ? "secondary" : "outline"}>
                    {questionMode === "manual" ? "手动选题" : questionMode === "auto" ? "自动出卷" : "AI出题"}
                  </Badge>
                  {questionMode === "auto" && autoGeneratedMeta && (
                    <Badge variant="outline">
                      已自动生成 {autoGeneratedMeta.count} 题
                    </Badge>
                  )}
                  {questionMode === "ai" && aiGeneratedMeta && (
                    <Badge variant="outline">
                      已生成 {aiGeneratedMeta.count} 题
                    </Badge>
                  )}
                </div>
              </div>

              {questionMode === "auto" && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">自动出卷条件</p>
                    <p className="text-sm text-foreground">
                      题库：{
                        autoQuestionBankId
                          ? questionBanks.find((bank) => bank.id === autoQuestionBankId)?.name ?? "已选题库"
                          : "全部题库"
                      }
                    </p>
                    <p className="text-sm text-foreground">数量：{autoQuestionCount} 题</p>
                    <p className="text-sm text-foreground">
                      难度：{selectedDifficultyLabels.length > 0 ? selectedDifficultyLabels.join(" / ") : "未选择"}
                    </p>
                  </div>
                </>
              )}
              {questionMode === "ai" && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">AI出题条件</p>
                    <p className="text-sm text-foreground">数量：{aiQuestionCount} 题</p>
                    <p className="text-sm text-foreground">
                      难度：{difficultyOptions.find((item) => item.value === aiDifficulty)?.label ?? aiDifficulty}
                    </p>
                    <p className="text-sm text-foreground">
                      模型：{AI_MODEL_OPTIONS.find((item) => item.value === aiModel)?.label ?? aiModel}
                    </p>
                    <p className="text-sm text-foreground">
                      知识点：{aiSelectedKnowledgePoints.length > 0 ? `${aiSelectedKnowledgePoints.length} 个` : "未限制"}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {previewFullscreenOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="flex h-full flex-col">
            <div className="border-b bg-background px-6 py-4">
              <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                    <ListChecks size={18} className="text-primary" />
                    <h2>试卷预览与考试分数</h2>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">卷面总分 {form.total_score} 分</Badge>
                  {previewModeToggleGroup}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewFullscreenOpen(false)}
                  >
                    退出全屏
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto w-full max-w-[1440px]">
                {renderQuestionPreviewList("fullscreen")}
              </div>
            </div>
          </div>
        </div>
      )}

      {questionStepFullscreenOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="flex h-full flex-col">
            <div className="border-b bg-background px-6 py-4">
              <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">第 2 步：选择题目 / 自动出卷</h2>
                  <p className="text-sm text-muted-foreground">全屏查看和操作当前选题内容</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuestionStepFullscreenOpen(false)}
                >
                  退出全屏
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto w-full max-w-[1440px]">
                {renderQuestionStepContent("fullscreen")}
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={pendingQuestionMode !== null} onOpenChange={(open) => !open && setPendingQuestionMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换选题方式</AlertDialogTitle>
            <AlertDialogDescription>
              切换后，当前选题方式下的已选题目和相关配置会被重置。确认继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingQuestionMode) {
                  applyQuestionModeChange(pendingQuestionMode);
                }
              }}
            >
              确认切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
