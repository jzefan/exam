import { useEffect, useState, type ReactNode } from "react";
import { useGetIdentity, useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  BookCopy,
  CheckCircle2,
  CircleAlert,
  FileText,
  ListChecks,
  Settings2,
  Sparkles,
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
import { StudentSelector } from "./StudentSelector";
import type { IKnowledgePoint, IQuestion, IQuestionBank } from "@/types";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  DEFAULT_NOTES,
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
type QuestionMode = "manual" | "auto";
type KnowledgePointAllocation = {
  knowledgePointId: string;
  count: number;
};

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
  const [questionMode, setQuestionMode] = useState<QuestionMode>("manual");
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
  const [pendingQuestionMode, setPendingQuestionMode] = useState<QuestionMode | null>(null);

  useEffect(() => {
    setForm(initialValues);
  }, [initialValues]);

  const now = new Date();
  const startTimeValue = toPickerDate(form.start_time);
  const endTimeValue = toPickerDate(form.end_time);
  const validationErrors = validateExamForm(form, now, {
    allowPastStartTime: mode === "edit",
  });
  const fieldErrors = showValidationErrors ? validationErrors : {};
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
  const selectedQuestions = Array.from(
    new Map((selectedQuestionQuery.data?.data ?? []).map((question) => [question.id, question])).values(),
  );
  const selectedQuestionMap = new Map(selectedQuestions.map((question) => [question.id, question]));
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

  const markStepVisited = (stepIndex: number) => {
    setCurrentStep(stepIndex);
    setMaxVisitedStep((prev) => Math.max(prev, stepIndex));
  };

  const goNext = () => {
    setFlowError(null);

    if (currentStep === 0) {
      setShowValidationErrors(true);
      if (Object.keys(validationErrors).length > 0) {
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

  const applyQuestionModeChange = (nextMode: QuestionMode) => {
    if (nextMode === questionMode) {
      return;
    }

    if (questionMode === "manual") {
      resetManualSelection();
    } else {
      resetAutoSelection();
    }

    setQuestionMode(nextMode);
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

    if (hasManualSelection || hasAutoSelection) {
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

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setShowValidationErrors(true);
    setFlowError(null);

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

    onSubmit(form);
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

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="返回考试列表"
          onClick={() => navigate("/exams")}
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-foreground tracking-tight">
            {mode === "create" ? "创建考试" : "编辑考试"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "create"
              ? "按步骤完成信息填写、组卷、选人和设置，最后一次性创建考试。"
              : "按步骤修改考试基本信息、题目、考生与设置。"}
          </p>
        </div>
      </div>

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
                          ? "border-primary/70 bg-primary text-primary-foreground shadow-sm"
                          : isDone
                            ? "border-emerald-500/25 bg-emerald-500/5"
                            : "border-border bg-background"
                      } ${isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={`flex items-center justify-center rounded-full border font-semibold transition-all ${
                            isActive
                              ? "h-7 w-7 text-sm border-2 border-white bg-white text-primary shadow-md ring-2 ring-white/60"
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
                            isActive ? "text-primary-foreground/90" : "text-muted-foreground"
                          }
                        />
                      </div>
                      <p
                        className={`text-sm font-semibold ${
                          isActive ? "text-primary-foreground" : "text-foreground"
                        }`}
                      >
                        {step.title}
                      </p>
                      <p
                        className={`mt-0.5 text-xs leading-tight line-clamp-1 ${
                          isActive ? "text-primary-foreground/80" : "text-muted-foreground"
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
              <CardHeader>
                <CardTitle>第 2 步：选择题目 / 自动出卷</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      requestQuestionModeChange("manual");
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors bg-background ${
                      questionMode === "manual"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <BookCopy
                        size={14}
                        className={questionMode === "manual" ? "text-primary" : "text-muted-foreground"}
                      />
                      <p className="text-sm font-semibold text-foreground">手动选题</p>
                      <span className="ml-auto text-xs text-muted-foreground line-clamp-1">
                        精确控制题目内容、题型和顺序
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      requestQuestionModeChange("auto");
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors bg-background ${
                      questionMode === "auto"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Wand2
                        size={14}
                        className={questionMode === "auto" ? "text-primary" : "text-muted-foreground"}
                      />
                      <p className="text-sm font-semibold text-foreground">自动出卷</p>
                      <span className="ml-auto text-xs text-muted-foreground line-clamp-1">
                        按题库与难度随机抽题
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
                    }}
                  />
                ) : (
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
                )}
              </CardContent>
            </Card>
          )}

          {currentStepId === "students" && (
            <Card>
              <CardHeader>
                <CardTitle>第 3 步：选择考试考生</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
                  当前已选 <span className="font-semibold text-foreground">{form.student_ids.length}</span> 名考生。
                  如果暂时不选，后续在编辑考试时仍可继续添加。
                </div>
                <StudentSelector
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
                <div className="grid gap-3 rounded-xl border border-border/80 bg-muted/30 p-4 md:grid-cols-4">
                  {summaryItems.map((item) => (
                    <div key={item.label}>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <FieldHint label="允许切屏次数" enabled={form.max_switch_count > 0}>
                      <Input
                        id="exam-max-switch-count"
                        type="number"
                        min={0}
                        placeholder="允许切屏次数（0 表示不限制）"
                        aria-label="允许切屏次数"
                        value={form.max_switch_count}
                        onChange={(e) =>
                          updateField("max_switch_count", parseInt(e.target.value, 10) || 0)
                        }
                        aria-invalid={Boolean(fieldErrors.max_switch_count)}
                        aria-describedby="exam-max-switch-count-help"
                      />
                    </FieldHint>
                    <p id="exam-max-switch-count-help" className="text-xs text-muted-foreground">
                      设为 0 表示不限制切屏次数。
                    </p>
                    {fieldErrors.max_switch_count && (
                      <p className="text-xs text-destructive">{fieldErrors.max_switch_count}</p>
                    )}
                  </div>

                  <div className="flex min-h-10 items-center justify-between rounded-lg border px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">允许查看考试结果</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
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

                <div className="space-y-1.5">
                  <div className="space-y-4 rounded-xl bg-background p-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ListChecks size={18} className="text-primary" />
                        <p className="text-sm font-semibold text-foreground">试卷预览与考试分数</p>
                      </div>
                      <Badge variant="secondary">卷面总分 {form.total_score} 分</Badge>
                    </div>

                    {form.question_items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-sm text-muted-foreground">
                        还没有题目，请先返回上一步选择题目。
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-2xl bg-muted/10">
                        {form.question_items
                          .slice()
                          .sort((left, right) => left.order - right.order)
                          .map((item, index) => {
                            const question = selectedQuestionMap.get(item.question_id);
                            const invalidScore =
                              !Number.isFinite(item.score_override) || (item.score_override ?? 0) <= 0;

                            return (
                              <div
                                key={item.question_id}
                                className={`grid gap-4 px-4 py-5 md:grid-cols-[minmax(0,1fr)_160px] md:items-start ${
                                  index > 0 ? "border-t border-border/50" : ""
                                }`}
                              >
                                <div className="min-w-0 space-y-2">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <Badge variant="outline">第 {index + 1} 题</Badge>
                                    <span className="text-sm font-medium text-foreground/80">
                                      {questionTypeLabels[question?.type ?? ""] ?? "题目"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      题库原始分数：{question?.score ?? "未设置"} 分
                                    </span>
                                  </div>

                                  {question ? (
                                    <QuestionPreviewCard
                                      question={question}
                                      mode="detailed"
                                      hideTypeBadge
                                      hideAnswer
                                      expandOnHover
                                      className="border-0 bg-white/80 p-4 shadow-sm ring-1 ring-border/50 transition-all hover:bg-white hover:shadow-md hover:ring-primary/20"
                                    />
                                  ) : (
                                    <p className="text-sm font-medium text-foreground">题目 {index + 1}</p>
                                  )}
                                  {invalidScore && (
                                    <p className="text-xs text-destructive">考试分数必须大于 0。</p>
                                  )}
                                </div>

                                <div className="space-y-1 md:pt-1">
                                  <Label
                                    htmlFor={`exam-question-score-${item.question_id}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    考试分数
                                  </Label>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      id={`exam-question-score-${item.question_id}`}
                                      type="number"
                                      min={0.5}
                                      step={0.5}
                                      value={item.score_override ?? ""}
                                      onChange={(e) => updateQuestionScore(item.question_id, e.target.value)}
                                      className={cn(
                                        "h-9 w-3/4 min-w-[88px] bg-white shadow-sm",
                                        invalidScore && "border-destructive/50 text-destructive focus-visible:ring-destructive/30",
                                      )}
                                    />
                                    <span className="text-sm text-muted-foreground">分</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

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
                <Button type="button" className="w-full sm:w-auto" onClick={goNext}>
                  {currentStepId === "students" && form.student_ids.length === 0 ? "跳过并继续" : "下一步"}
                  <ArrowRight size={16} className="ml-1" />
                </Button>
              ) : mode === "create" ? (
                <Button
                  type="submit"
                  className="w-full sm:w-auto"
                  disabled={!form.title.trim() || isPending}
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      创建中...
                    </span>
                  ) : (
                    "创建考试"
                  )}
                </Button>
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
                    {questionMode === "manual" ? "手动选题" : "自动出卷"}
                  </Badge>
                  {questionMode === "auto" && autoGeneratedMeta && (
                    <Badge variant="outline">
                      已自动生成 {autoGeneratedMeta.count} 题
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
            </CardContent>
          </Card>
        </div>
      </div>

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
