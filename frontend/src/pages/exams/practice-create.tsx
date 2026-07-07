import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCreate,
  useGetIdentity,
  useList,
  useOne,
  useUpdate,
} from "@refinedev/core";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  BookCopy,
  CheckCircle2,
  ChevronDown,
  Compass,
  CircleAlert,
  Loader2,
  Maximize2,
  Sparkles,
  StopCircle,
  Wand2,
} from "lucide-react";

import { AIQuestionConfigPanel } from "@/components/questions/ai-question-config-panel";
import {
  EMPTY_AI_TYPE_ALLOC,
  type AIModelProvider,
  type AIQuestionType,
} from "@/components/questions/ai-question-config-constants";
import { AIGeneratedQuestionCard } from "@/components/questions/ai-generated-question-card";
import {
  DIFFICULTY_LABELS,
  QuestionPreviewCard,
} from "@/components/questions/question-preview-card";
import { getQuestionDisplayType } from "@/components/questions/question-preview-utils";
import {
  KnowledgePointSelector,
  type SelectedKnowledgePoint,
} from "@/components/questions/knowledge-point-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { consumeExamSeed } from "@/lib/exam-seed";
import { formatQuestionBankLabel } from "@/lib/question-banks";
import {
  getGeneratedQuestionPersistKey,
  useUnsavedGeneratedQuestionsGuard,
} from "@/hooks/use-unsaved-generated-questions-guard";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import { getUserRole } from "@/types/rbac";
import { AIGenerateLoadingOverlay } from "@/pages/questions/components/ai-generate-loading-overlay";
import { validateTypeAllocation } from "@/pages/questions/ai-generate-utils";
import type {
  IExamQuestion,
  IExamStudent,
  IKnowledgePoint,
  IQuestion,
  IQuestionBank,
  QuestionDisplayType,
  QuestionType,
} from "@/types";

import { QuestionSelector } from "./components/QuestionSelector";
import { ClassStudentSelector } from "./components/ClassStudentSelector";
import { ExamQuestionActions } from "./components/ExamQuestionActions";
import {
  calculateDurationMinutes,
  getErrorMessage,
  getPublishedExamStatus,
  toSubmitDateTime,
} from "./components/exam-form-utils";
import {
  questionTypeLabels as baseQuestionTypeLabels,
} from "./components/paper-view-utils";

type PracticeStepId = "knowledge" | "questions" | "students" | "publish";
type QuestionMode = "manual" | "auto" | "ai";
type KnowledgePointAllocation = {
  knowledgePointId: string;
  count: number;
};
type TypeAllocation = { count: number; score: number };
type QuestionTypeSummary = {
  type: QuestionDisplayType;
  count: number;
  totalScore: number;
  questionIds: string[];
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
  persistedQuestionId?: string;
};

type PracticeDetail = {
  id: string;
  category: "practice" | "exam";
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  total_score: number;
  status: string;
  show_result: boolean;
  allow_retake: boolean;
  question_mode?: QuestionMode | null;
  questions: IExamQuestion[];
  students: IExamStudent[];
};

type PracticeQuestionItem = {
  question_id: string;
  order: number;
  score_override: number | null;
};

type PaperExamSeedResponse = {
  paper_id: string;
  title: string;
  description: string | null;
  total_score: number;
  question_items: PracticeQuestionItem[];
};

interface PublicLinkResponse {
  public_url: string;
}

const stepItems: Array<{
  id: PracticeStepId;
  title: string;
  description: string;
}> = [
  {
    id: "knowledge",
    title: "步骤 1：选择知识点",
    description: "知识点可选，也可以直接进入下一步手动选题。",
  },
  {
    id: "questions",
    title: "步骤 2：选择题目 / 自动出题 / AI出题",
    description: "可以手动选题，也可以从题库自动抽题或直接生成练习题。",
  },
  {
    id: "students",
    title: "步骤 3：选择班级 / 学生",
    description: "确定这套练习要发给哪些学生。",
  },
  {
    id: "publish",
    title: "步骤 4：发布设置",
    description: "设置开始时间、时长与查看结果规则，然后发布。",
  },
];

const practiceBadgeClass =
  "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
const ALL_BANKS = "__all_banks__";
const KNOWLEDGE_COVERAGE_TARGET = 0.8;
const difficultyOptions = [
  { value: 1, label: "容易" },
  { value: 2, label: "较易" },
  { value: 3, label: "中等" },
  { value: 4, label: "较难" },
  { value: 5, label: "很难" },
];
const AUTO_TYPE_DISTRIBUTION_OPTIONS: { type: QuestionDisplayType; label: string }[] =
  [
    { type: "single_choice", label: "单选题" },
    { type: "multi_choice", label: "多选题" },
    { type: "true_false", label: "判断题" },
    { type: "fill_in", label: "填空题" },
    { type: "short_answer", label: "简答题" },
    { type: "essay", label: "论述题" },
    { type: "code", label: "编程题" },
  ];
const AUTO_TYPE_DEFAULT_SCORES: Record<QuestionDisplayType, number> = {
  single_choice: 1,
  multi_choice: 2,
  true_false: 1,
  fill_in: 2,
  short_answer: 5,
  essay: 5,
  code: 10,
};
const questionTypeLabels: Record<QuestionDisplayType, string> = {
  single_choice: "单选题",
  multi_choice: "多选题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

function toLocalDateTimeValue(value: Date | undefined): string {
  if (!value) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function toPickerDate(value: string): Date | undefined {
  if (!value) return undefined;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? undefined : next;
}

function toLocalNowValue() {
  return toLocalDateTimeValue(new Date());
}

function getDefaultPracticeTitle(date = new Date()) {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}练习`;
}

function getNextPracticeTitle(existingTitles: string[], date = new Date()) {
  const baseTitle = getDefaultPracticeTitle(date);
  let maxSuffix = -1;

  for (const title of existingTitles) {
    if (title === baseTitle) {
      maxSuffix = Math.max(maxSuffix, 0);
      continue;
    }

    const match = title.match(new RegExp(`^${baseTitle}-(\\d+)$`));
    if (!match) continue;
    const suffix = Number.parseInt(match[1], 10);
    if (Number.isFinite(suffix)) {
      maxSuffix = Math.max(maxSuffix, suffix);
    }
  }

  return maxSuffix < 0 ? baseTitle : `${baseTitle}-${maxSuffix + 1}`;
}

function getPracticeQuestionTypeLabel(question: IQuestion): string {
  const displayType = getQuestionDisplayType(question);
  return displayType
    ? questionTypeLabels[displayType]
    : baseQuestionTypeLabels[question.type] ?? "题目";
}

function getNextCoursePracticeTitle(
  courseName: string | undefined,
  existingTitles: string[] = [],
) {
  const course = courseName?.trim() || "课程";
  const baseTitle = `${course}练习`;
  let maxSuffix = existingTitles.includes(baseTitle) ? 0 : -1;
  const escapedBase = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedBase}-(\\d+)$`);

  for (const title of existingTitles) {
    const match = title.match(pattern);
    if (match) {
      maxSuffix = Math.max(maxSuffix, Number(match[1]));
    }
  }

  return maxSuffix < 0 ? baseTitle : `${baseTitle}-${maxSuffix + 1}`;
}

function getDefaultAITypeAlloc(): Record<AIQuestionType, number> {
  return {
    ...EMPTY_AI_TYPE_ALLOC,
    single_choice: 10,
  };
}

function shuffleQuestions(questions: IQuestion[], count: number): IQuestion[] {
  const next = [...questions];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next.slice(0, count);
}

function getQuestionSimilarityText(question: IQuestion): string {
  const contentText =
    typeof question.content?.text === "string"
      ? question.content.text
      : JSON.stringify(question.content ?? {});
  const optionText = question.options
    ? Object.values(question.options).join(" ")
    : "";
  return `${question.title} ${contentText} ${optionText}`;
}

function normalizeQuestionSimilarityText(value: string): string {
  return (value.toLowerCase().match(/[\u4e00-\u9fffA-Za-z0-9]+/g) ?? []).join(
    "",
  );
}

function questionSimilarityScore(left: IQuestion, right: IQuestion): number {
  const leftText = normalizeQuestionSimilarityText(
    getQuestionSimilarityText(left),
  );
  const rightText = normalizeQuestionSimilarityText(
    getQuestionSimilarityText(right),
  );
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const [shorter, longer] =
    leftText.length <= rightText.length
      ? [leftText, rightText]
      : [rightText, leftText];
  if (
    shorter.length >= 18 &&
    longer.includes(shorter) &&
    shorter.length / Math.max(1, longer.length) >= 0.58
  ) {
    return 1;
  }
  const bigrams = (text: string) =>
    new Set(
      Array.from({ length: Math.max(0, text.length - 1) }, (_, index) =>
        text.slice(index, index + 2),
      ),
    );
  const leftBigrams = bigrams(leftText);
  const rightBigrams = bigrams(rightText);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
  const overlap = [...leftBigrams].filter((item) =>
    rightBigrams.has(item),
  ).length;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function areQuestionsTooSimilar(left: IQuestion, right: IQuestion): boolean {
  return questionSimilarityScore(left, right) >= 0.52;
}

function selectDistinctQuestions(
  questions: IQuestion[],
  count: number,
  existing: IQuestion[] = [],
): IQuestion[] {
  const selected: IQuestion[] = [];
  for (const candidate of shuffleQuestions(questions, questions.length)) {
    if (
      [...existing, ...selected].some((question) =>
        areQuestionsTooSimilar(candidate, question),
      )
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected;
}

export function PracticeCreate() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as {
    backTo?: string;
    backLabel?: string;
    successTo?: string;
    courseKpId?: string;
    courseSemesterId?: string;
    courseName?: string;
    knowledgePointId?: string;
    knowledgePointName?: string;
    knowledgePointPath?: string;
    mainKnowledgePointId?: string;
    mainKnowledgePointName?: string;
    defaultBankName?: string;
    initialStep?: number;
    courseOrigin?: boolean;
  };
  const { toast } = useToast();
  const { mutate: create, mutation } = useCreate();
  const { mutate: update, mutation: updateMutation } = useUpdate();
  const abortRef = useRef<AbortController | null>(null);
  const hydratedExamRef = useRef(false);
  const hydratedQuestionMetaRef = useRef(false);
  const hydratedPaperSeedRef = useRef<string | null>(null);
  const hydratedSeedKeyRef = useRef<string | null>(null);
  const isEditMode = Boolean(id);
  const seedPaperId = searchParams.get("paper_id");
  const seedKey = searchParams.get("seed_key");
  const { data: identity } = useGetIdentity<{
    primary_org?: { role_name: string } | null;
  }>();
  const role = identity ? getUserRole(identity) : "";
  const mainKPLabel =
    role === "evaluator" ? "主技能点（可选）" : "课程（可选）";
  const mainKPTrigger = role === "evaluator" ? "选择主技能点" : "选择课程";

  const { result: practice, query: practiceQuery } = useOne<PracticeDetail>({
    resource: "exams",
    id: id ?? "",
    queryOptions: { enabled: isEditMode },
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(() =>
    isEditMode ? stepItems.length - 1 : 0,
  );
  const [title, setTitle] = useState(() => {
    if (isEditMode) return "";
    if (navState.courseName)
      return getNextCoursePracticeTitle(navState.courseName);
    return getDefaultPracticeTitle();
  });
  const [isTitleManuallyEdited, setIsTitleManuallyEdited] = useState(false);
  const defaultTitle = useMemo(() => {
    if (navState.courseName)
      return getNextCoursePracticeTitle(navState.courseName);
    return getDefaultPracticeTitle();
  }, [navState.courseName]);
  const [description, setDescription] = useState("");
  const [mainKnowledgePoint, setMainKnowledgePoint] =
    useState<SelectedKnowledgePoint | null>(null);
  const [selectedKnowledgePoints, setSelectedKnowledgePoints] = useState<
    SelectedKnowledgePoint[]
  >([]);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("manual");
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [questionItems, setQuestionItems] = useState<PracticeQuestionItem[]>(
    [],
  );
  const [autoQuestionBankId, setAutoQuestionBankId] = useState<string | null>(
    null,
  );
  const [autoQuestionCount, setAutoQuestionCount] = useState(10);
  const [autoDifficulties, setAutoDifficulties] = useState<number[]>([2, 3, 4]);
  const [autoKnowledgeAllocations, setAutoKnowledgeAllocations] = useState<
    KnowledgePointAllocation[]
  >([]);
  const [autoTypeAllocations, setAutoTypeAllocations] = useState<
    Partial<Record<QuestionDisplayType, TypeAllocation>>
  >({});
  const [autoTypeCountDrafts, setAutoTypeCountDrafts] = useState<
    Partial<Record<QuestionDisplayType, string>>
  >({});
  const [autoTypeScoreDrafts, setAutoTypeScoreDrafts] = useState<
    Partial<Record<QuestionDisplayType, string>>
  >({});
  const [autoKnowledgeQuotaOpen, setAutoKnowledgeQuotaOpen] = useState(false);
  const [autoGeneratedMeta, setAutoGeneratedMeta] = useState<{
    count: number;
    totalScore: number;
  } | null>(null);
  const [scoreDialogOpen, setScoreDialogOpen] = useState(false);
  const [scorePreviewMode, setScorePreviewMode] = useState<"order" | "type">(
    "order",
  );
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<QuestionDisplayType, string>>
  >({});
  const typeScoreDraftDefaultsRef = useRef<
    Partial<Record<QuestionDisplayType, string>>
  >({});
  const [isManualQuestionFullscreen, setIsManualQuestionFullscreen] =
    useState(false);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [publicLinkEnabled, setPublicLinkEnabled] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [startImmediately, setStartImmediately] = useState(true);
  const [scheduledStartTime, setScheduledStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [showResult, setShowResult] = useState(true);
  const [allowRetake, setAllowRetake] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seedLoading, setSeedLoading] = useState(false);

  const [aiQuestionCount, setAIQuestionCount] = useState(10);
  const [aiDifficulty, setAIDifficulty] = useState(3);
  const [aiTypeAlloc, setAITypeAlloc] = useState<Record<AIQuestionType, number>>(
    getDefaultAITypeAlloc,
  );
  const [aiModel, setAIModel] = useState<AIModelProvider>("deepseek");
  const [aiPrompt, setAIPrompt] = useState("");
  const [aiQuestions, setAIQuestions] = useState<GeneratedQuestion[]>([]);
  const [aiGenerating, setAIGenerating] = useState(false);
  const [aiApplying, setAIApplying] = useState(false);
  const [persistedAIQuestionKeys, setPersistedAIQuestionKeys] = useState<
    string[]
  >([]);

  const currentStepId = stepItems[currentStep].id;
  const currentAIPersistKeys = useMemo(
    () =>
      aiQuestions.map((question) => getGeneratedQuestionPersistKey(question)),
    [aiQuestions],
  );
  const hasUnsavedGeneratedQuestions =
    questionMode === "ai" &&
    aiQuestions.length > 0 &&
    !aiGenerating &&
    currentAIPersistKeys.some((key) => !persistedAIQuestionKeys.includes(key));
  const showQuestionStepPreviewButton =
    currentStepId === "questions" &&
    questionMode === "ai" &&
    questionIds.length > 0;
  const { dialog: unsavedGuardDialog } = useUnsavedGeneratedQuestionsGuard({
    when: hasUnsavedGeneratedQuestions,
    message: "当前生成的题目尚未加入练习，确定离开当前页面吗？",
  });
  const publishStartTime = isEditMode
    ? scheduledStartTime
    : startImmediately
      ? toLocalNowValue()
      : scheduledStartTime;

  const updatePracticeEndTime = (value: string) => {
    setEndTime(value);
    const nextDuration = calculateDurationMinutes(publishStartTime, value);
    if (nextDuration !== null) {
      setDurationMinutes(nextDuration);
    }
  };

  const updatePracticeStartTime = (value: string) => {
    setScheduledStartTime(value);
    const nextDuration = calculateDurationMinutes(value, endTime);
    if (nextDuration !== null) {
      setDurationMinutes(nextDuration);
    }
  };

  const updateStartImmediately = (checked: boolean) => {
    setStartImmediately(checked);
    const nextStartTime = checked ? toLocalNowValue() : scheduledStartTime;
    const nextDuration = calculateDurationMinutes(nextStartTime, endTime);
    if (nextDuration !== null) {
      setDurationMinutes(nextDuration);
    }
  };

  const { query: questionBankQuery } = useList<IQuestionBank>({
    resource: "question-banks",
    pagination: { currentPage: 1, pageSize: 200 },
  });
  const questionBanks = questionBankQuery.data?.data ?? [];

  // 从课程详情进入时，默认选中课程题库（手动 + 自动出题共用）。
  const [wizardDefaultBankName] = useState<string | undefined>(
    navState.defaultBankName,
  );

  // 同步解析默认题库 ID，用于自动出题模式首次渲染即显示课程题库。
  const defaultAutoBankId = useMemo(() => {
    if (!wizardDefaultBankName || questionBanks.length === 0) return null;
    const match = questionBanks.find(
      (b) => b.name === wizardDefaultBankName,
    );
    return match?.id ?? null;
  }, [wizardDefaultBankName, questionBanks]);

  // 用户是否已手动更改过题库（切换自动/手动模式、点重置等场景会清除）。
  const [autoBankExplicit, setAutoBankExplicit] = useState(false);

  // 自动出题实际生效的题库 ID：用户手动选择优先，否则用默认值。
  const effectiveAutoBankId = useMemo(
    () => (autoBankExplicit ? autoQuestionBankId : defaultAutoBankId),
    [autoBankExplicit, autoQuestionBankId, defaultAutoBankId],
  );

  const { query: knowledgePointQuery } = useList<IKnowledgePoint>({
    resource: "knowledge-points",
    pagination: { currentPage: 1, pageSize: 500 },
  });
  const knowledgePoints = knowledgePointQuery.data?.data ?? [];

  const autoCandidateFilters = useMemo(
    () => [
      ...(effectiveAutoBankId
        ? [
            {
              field: "question_bank_id",
              operator: "eq" as const,
              value: effectiveAutoBankId,
            },
          ]
        : []),
      ...(autoDifficulties.length > 0
        ? [
            {
              field: "difficulty",
              operator: "in" as const,
              value: autoDifficulties,
            },
          ]
        : []),
    ],
    [effectiveAutoBankId, autoDifficulties],
  );
  const autoCandidatesEnabled =
    questionMode === "auto" && currentStepId === "questions";

  // 题型分布改用后端 GROUP BY 聚合：仅统计自己的题目 + 平台开放题库，随难度切换快速刷新，
  // 不必为了计数把全部题目序列化拉到前端。聚合同时给出候选总数（X-Total-Count），
  // 用于下方一次性拉取生成所需的完整候选行，避免固定 pageSize 截断导致并集少算。
  const { query: typeDistributionQuery } = useList<{
    type: QuestionType;
    count: number;
  }>({
    resource: "questions/type-distribution",
    pagination: { currentPage: 1, pageSize: 100, mode: "server" },
    filters: autoCandidateFilters,
    queryOptions: { enabled: autoCandidatesEnabled, staleTime: 0 },
  });
  const autoCandidateTotal = typeDistributionQuery.data?.total ?? 0;

  // 生成与知识点可用量需要完整候选行，按聚合得到的总数一次性拉全。
  const { query: autoQuestionQuery } = useList<IQuestion>({
    resource: "questions",
    pagination: {
      currentPage: 1,
      pageSize: Math.max(autoCandidateTotal, 1),
      mode: "server",
    },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: autoCandidateFilters,
    queryOptions: {
      enabled: autoCandidatesEnabled && autoCandidateTotal > 0,
      staleTime: 0,
    },
  });
  const autoCandidates = autoQuestionQuery.data?.data ?? [];

  // 题型分布就绪（聚合查询完成）→ 用于钳制题型配额；与重型候选拉取解耦，刷新更快。
  const typeDistributionReady =
    autoCandidatesEnabled && !typeDistributionQuery.isFetching;
  // 候选集就绪：聚合完成，且（无候选）或（候选请求完成且已有数据）→ 用于"生成"按钮可用性。
  const autoCandidatesReady =
    typeDistributionReady &&
    (autoCandidateTotal === 0 ||
      (!autoQuestionQuery.isFetching && autoCandidates.length > 0));
  const autoCandidatesLoading = autoCandidatesEnabled && !autoCandidatesReady;

  const selectedQuestionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters:
      questionIds.length > 0
        ? [{ field: "id", operator: "in" as const, value: questionIds }]
        : [],
    queryOptions: { enabled: questionIds.length > 0 },
  });

  const selectedQuestions = useMemo(
    () =>
      Array.from(
        new Map(
          (selectedQuestionQuery.query.data?.data ?? []).map((question) => [
            question.id,
            question,
          ]),
        ).values(),
      ),
    [selectedQuestionQuery.query.data?.data],
  );
  const selectedQuestionMap = useMemo(
    () => new Map(selectedQuestions.map((question) => [question.id, question])),
    [selectedQuestions],
  );
  const sortedQuestionItems = useMemo(
    () => [...questionItems].sort((left, right) => left.order - right.order),
    [questionItems],
  );
  const questionTypeSummaries = useMemo(() => {
    const grouped = new Map<QuestionDisplayType, QuestionTypeSummary>();
    for (const item of sortedQuestionItems) {
      const question = selectedQuestionMap.get(item.question_id);
      if (!question) continue;
      const type = getQuestionDisplayType(question);
      if (!type) continue;
      const existing = grouped.get(type);
      if (existing) {
        existing.count += 1;
        existing.totalScore = Number(
          (existing.totalScore + (Number(item.score_override) || 0)).toFixed(2),
        );
        existing.questionIds.push(item.question_id);
        continue;
      }
      grouped.set(type, {
        type,
        count: 1,
        totalScore: Number((Number(item.score_override) || 0).toFixed(2)),
        questionIds: [item.question_id],
      });
    }

    return (Object.keys(questionTypeLabels) as QuestionDisplayType[])
      .map((type) => grouped.get(type))
      .filter((item): item is QuestionTypeSummary => Boolean(item));
  }, [selectedQuestionMap, sortedQuestionItems]);
  const questionItemsByType = useMemo(
    () =>
      questionTypeSummaries.map((summary) => ({
        summary,
        items: sortedQuestionItems.filter((item) =>
          summary.questionIds.includes(item.question_id),
        ),
      })),
    [questionTypeSummaries, sortedQuestionItems],
  );
  const availableTypeCounts = useMemo(() => {
    const counts: Partial<Record<QuestionDisplayType, number>> = {};
    for (const option of AUTO_TYPE_DISTRIBUTION_OPTIONS) {
      counts[option.type] = 0;
    }
    for (const row of typeDistributionQuery.data?.data ?? []) {
      counts[row.type as QuestionDisplayType] = row.count;
    }
    return counts;
  }, [typeDistributionQuery.data?.data]);
  const typeAllocationEntries = useMemo(
    () =>
      (
        Object.entries(autoTypeAllocations) as [QuestionDisplayType, TypeAllocation][]
      ).filter(([, allocation]) => allocation.count > 0),
    [autoTypeAllocations],
  );
  const isTypeAllocationMode = typeAllocationEntries.length > 0;
  const requestedTypeQuestionCount = useMemo(
    () =>
      typeAllocationEntries.reduce(
        (sum, [, allocation]) => sum + allocation.count,
        0,
      ),
    [typeAllocationEntries],
  );
  const hasTypeAllocationShortage = useMemo(
    () =>
      typeAllocationEntries.some(
        ([type, allocation]) =>
          allocation.count > (availableTypeCounts[type] ?? 0),
      ),
    [availableTypeCounts, typeAllocationEntries],
  );
  const knowledgeQuotaTargetCount = isTypeAllocationMode
    ? requestedTypeQuestionCount
    : autoQuestionCount;
  const knowledgeQuotaCandidates = useMemo(
    () =>
      isTypeAllocationMode
        ? autoCandidates.filter(
            (question) => {
              const displayType = getQuestionDisplayType(question);
              return Boolean(displayType && (autoTypeAllocations[displayType]?.count ?? 0) > 0);
            },
          )
        : autoCandidates,
    [autoCandidates, autoTypeAllocations, isTypeAllocationMode],
  );
  const availableKnowledgePoints = useMemo(() => {
    const countByKnowledgeId = new Map<string, number>();
    for (const question of knowledgeQuotaCandidates) {
      for (const point of question.knowledge_points) {
        countByKnowledgeId.set(
          point.id,
          (countByKnowledgeId.get(point.id) ?? 0) + 1,
        );
      }
    }
    return knowledgePoints
      .map((knowledgePoint) => ({
        ...knowledgePoint,
        availableCount: countByKnowledgeId.get(knowledgePoint.id) ?? 0,
      }))
      .filter((knowledgePoint) => knowledgePoint.availableCount > 0);
  }, [knowledgePoints, knowledgeQuotaCandidates]);
  const availableKnowledgePointMap = useMemo(
    () =>
      new Map(
        availableKnowledgePoints.map((knowledgePoint) => [
          knowledgePoint.id,
          knowledgePoint,
        ]),
      ),
    [availableKnowledgePoints],
  );
  const autoAllocationMap = useMemo(
    () =>
      new Map(
        autoKnowledgeAllocations.map((allocation) => [
          allocation.knowledgePointId,
          allocation,
        ]),
      ),
    [autoKnowledgeAllocations],
  );
  const requestedKnowledgeQuestionCount = useMemo(
    () =>
      autoKnowledgeAllocations.reduce(
        (sum, allocation) => sum + allocation.count,
        0,
      ),
    [autoKnowledgeAllocations],
  );
  const hasKnowledgeAllocationShortage = useMemo(
    () =>
      autoKnowledgeAllocations.some((allocation) => {
        const knowledgePoint = availableKnowledgePointMap.get(
          allocation.knowledgePointId,
        );
        return (
          !knowledgePoint || allocation.count > knowledgePoint.availableCount
        );
      }),
    [autoKnowledgeAllocations, availableKnowledgePointMap],
  );
  const isKnowledgeAllocationMode = autoKnowledgeAllocations.length > 0;
  const hasKnowledgeAllocationMismatch =
    isKnowledgeAllocationMode &&
    Number.isFinite(knowledgeQuotaTargetCount) &&
    knowledgeQuotaTargetCount > 0 &&
    requestedKnowledgeQuestionCount !== knowledgeQuotaTargetCount;
  const buildEvenKnowledgeAllocations = useCallback(
    (target: number): KnowledgePointAllocation[] => {
      if (availableKnowledgePoints.length === 0) return [];
      const total =
        Number.isFinite(target) && target > 0
          ? target
          : availableKnowledgePoints.length;
      const buckets = availableKnowledgePoints.map((point) => ({
        knowledgePointId: point.id,
        count: 0,
        cap: point.availableCount,
      }));
      let remaining = total;
      let progressed = true;
      while (remaining > 0 && progressed) {
        progressed = false;
        for (const bucket of buckets) {
          if (remaining <= 0) break;
          if (bucket.count < bucket.cap) {
            bucket.count += 1;
            remaining -= 1;
            progressed = true;
          }
        }
      }
      return buckets
        .filter((bucket) => bucket.count > 0)
        .map(({ knowledgePointId, count }) => ({ knowledgePointId, count }));
    },
    [availableKnowledgePoints],
  );
  const effectiveKnowledgeAllocations = useMemo(
    () =>
      isKnowledgeAllocationMode
        ? autoKnowledgeAllocations
        : buildEvenKnowledgeAllocations(knowledgeQuotaTargetCount),
    [
      autoKnowledgeAllocations,
      buildEvenKnowledgeAllocations,
      isKnowledgeAllocationMode,
      knowledgeQuotaTargetCount,
    ],
  );
  const knowledgeCoverageTotal = availableKnowledgePoints.length;
  const knowledgeCoverageCovered = effectiveKnowledgeAllocations.filter(
    (allocation) => allocation.count > 0,
  ).length;
  const knowledgeCoveragePercent =
    knowledgeCoverageTotal > 0
      ? Math.round((knowledgeCoverageCovered / knowledgeCoverageTotal) * 100)
      : 0;
  const knowledgeCoverageMet =
    knowledgeCoverageTotal === 0 ||
    knowledgeCoverageCovered >=
      Math.ceil(knowledgeCoverageTotal * KNOWLEDGE_COVERAGE_TARGET);
  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<QuestionDisplayType, string>>>(
        (acc, summary) => {
          acc[summary.type] = String(summary.totalScore);
          return acc;
        },
        {},
      ),
    [questionTypeSummaries],
  );
  const todayPracticeTitlePrefix = useMemo(() => getDefaultPracticeTitle(), []);
  const practiceTitleSuggestionQuery = useList<PracticeDetail>({
    resource: "exams",
    pagination: { currentPage: 1, pageSize: 200, mode: "server" },
    filters: [
      { field: "category", operator: "eq" as const, value: "practice" },
      {
        field: "title",
        operator: "contains" as const,
        value: todayPracticeTitlePrefix,
      },
    ],
    queryOptions: { enabled: !isEditMode && !navState.courseName },
  });
  const suggestedPracticeTitle = useMemo(() => {
    const existingTitles = (
      practiceTitleSuggestionQuery.query.data?.data ?? []
    ).map((item) => item.title);
    return getNextPracticeTitle(existingTitles);
  }, [practiceTitleSuggestionQuery.query.data?.data]);

  useEffect(() => {
    if (!practice || hydratedExamRef.current) return;

    hydratedExamRef.current = true;
    setTitle(practice.title ?? "");
    setDescription(practice.description ?? "");
    setQuestionMode(
      practice.question_mode === "ai" || practice.question_mode === "auto"
        ? practice.question_mode
        : "manual",
    );
    const orderedItems = practice.questions
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((question, index) => ({
        question_id: question.question_id,
        order: index,
        score_override:
          question.score_override ?? question.question_score ?? null,
      }));
    setQuestionIds(orderedItems.map((item) => item.question_id));
    setQuestionItems(orderedItems);
    setStudentIds(practice.students.map((student) => student.student_id));
    setPublicLinkEnabled(false);
    setDurationMinutes(practice.duration_minutes ?? 60);
    setScheduledStartTime(
      practice.start_time
        ? toLocalDateTimeValue(new Date(practice.start_time))
        : "",
    );
    setEndTime(
      practice.end_time
        ? toLocalDateTimeValue(new Date(practice.end_time))
        : "",
    );
    setShowResult(practice.show_result ?? true);
    setAllowRetake(practice.allow_retake ?? false);
    setStartImmediately(false);
    setSubmitError(null);
  }, [practice]);

  useEffect(() => {
    if (
      !isEditMode ||
      !hydratedExamRef.current ||
      hydratedQuestionMetaRef.current ||
      selectedQuestions.length === 0
    ) {
      return;
    }

    hydratedQuestionMetaRef.current = true;
    const nextKnowledgePoints = Array.from(
      new Map(
        selectedQuestions
          .flatMap((question) => question.knowledge_points ?? [])
          .map((knowledgePoint) => [
            knowledgePoint.id,
            {
              id: knowledgePoint.id,
              name: knowledgePoint.name,
              path: knowledgePoint.name,
            },
          ]),
      ).values(),
    );
    setSelectedKnowledgePoints(nextKnowledgePoints);

    if ((practice?.question_mode ?? questionMode) === "ai") {
      const nextAIQuestions = selectedQuestions.map((question, index) => ({
        index,
        type: question.type,
        title: question.title ?? "",
        content:
          typeof question.content === "object" && question.content
            ? (question.content as { text: string })
            : { text: question.title ?? "" },
        options:
          question.options && typeof question.options === "object"
            ? (question.options as Record<string, string>)
            : null,
        answer:
          question.answer && typeof question.answer === "object"
            ? (question.answer as { text?: string; correct?: string | boolean })
            : {},
        analysis: question.analysis ?? null,
        difficulty: question.difficulty ?? 3,
        selected: true,
        persistedQuestionId: question.id,
      }));
      setAIQuestions(nextAIQuestions);
      setPersistedAIQuestionKeys(
        nextAIQuestions.map((question) =>
          getGeneratedQuestionPersistKey(question),
        ),
      );
    }
  }, [isEditMode, practice?.question_mode, questionMode, selectedQuestions]);

  useEffect(() => {
    setQuestionItems((prev) => {
      const existingMap = new Map(prev.map((item) => [item.question_id, item]));
      const next = questionIds.map((questionId, index) => {
        const existing = existingMap.get(questionId);
        const question = selectedQuestionMap.get(questionId);
        return {
          question_id: questionId,
          order: index,
          score_override: existing?.score_override ?? question?.score ?? null,
        };
      });
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [questionIds, selectedQuestionMap]);

  useEffect(() => {
    if (questionMode !== "auto" || !typeDistributionReady) return;
    setAutoTypeAllocations((prev) => {
      let changed = false;
      const next: Partial<Record<QuestionDisplayType, TypeAllocation>> = {};

      for (const [type, allocation] of Object.entries(prev) as [
        QuestionDisplayType,
        TypeAllocation,
      ][]) {
        const available = availableTypeCounts[type] ?? 0;
        if (allocation.count > available) {
          changed = true;
          continue;
        }
        next[type] = allocation;
      }

      return changed ? next : prev;
    });
  }, [typeDistributionReady, availableTypeCounts, questionMode]);

  const totalScore = useMemo(
    () =>
      questionItems.reduce(
        (sum, item) => sum + (Number(item.score_override) || 0),
        0,
      ),
    [questionItems],
  );

  useEffect(() => {
    const previousDefaults = typeScoreDraftDefaultsRef.current;
    setTypeScoreDrafts((prev) => {
      const next = questionTypeSummaries.reduce<
        Partial<Record<QuestionDisplayType, string>>
      >((acc, summary) => {
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

  useEffect(() => {
    abortRef.current?.abort();
    hydratedExamRef.current = false;
    hydratedQuestionMetaRef.current = false;
    hydratedPaperSeedRef.current = null;

    setCurrentStep(0);
    setMaxVisitedStep(isEditMode ? stepItems.length - 1 : 0);
    setIsManualQuestionFullscreen(false);
    setSubmitError(null);
    setAIQuestions([]);
    setAIGenerating(false);
    setAIApplying(false);
    setPersistedAIQuestionKeys([]);

    if (isEditMode) {
      return;
    }

    setTitle(defaultTitle);
    setIsTitleManuallyEdited(false);
    setDescription("");
    setMainKnowledgePoint(null);
    setSelectedKnowledgePoints([]);
    setQuestionMode("manual");
    setQuestionIds([]);
    setQuestionItems([]);
    setAutoQuestionBankId(null);
    setAutoBankExplicit(false);
    setAutoQuestionCount(10);
    setAutoDifficulties([2, 3, 4]);
    setAutoKnowledgeAllocations([]);
    setAutoTypeAllocations({});
    setAutoTypeCountDrafts({});
    setAutoTypeScoreDrafts({});
    setAutoGeneratedMeta(null);
    setAutoKnowledgeQuotaOpen(false);
    setStudentIds([]);
    setPublicLinkEnabled(false);
    setDurationMinutes(60);
    setStartImmediately(true);
    setScheduledStartTime("");
    setEndTime("");
    setShowResult(true);
    setAIQuestionCount(10);
    setAIDifficulty(3);
    setAITypeAlloc(getDefaultAITypeAlloc());
    setAIModel("deepseek");
    setAIPrompt("");
  }, [id, isEditMode]);

  useEffect(() => {
    let cancelled = false;
    if (isEditMode) {
      setSeedLoading(false);
      return () => {
        cancelled = true;
      };
    }
    // 当来自题目列表（seed_key）时，另起一个 effect 处理，paper 路径直接短路。
    if (seedKey) {
      setSeedLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (!seedPaperId) {
      setSeedLoading(false);
      if (hydratedPaperSeedRef.current) {
        hydratedPaperSeedRef.current = null;
        setTitle(defaultTitle);
        setIsTitleManuallyEdited(false);
        setDescription("");
        setSelectedKnowledgePoints([]);
        setQuestionMode("manual");
        setQuestionIds([]);
        setQuestionItems([]);
        setSubmitError(null);
      }
      return () => {
        cancelled = true;
      };
    }
    if (hydratedPaperSeedRef.current === seedPaperId) {
      setSeedLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setSeedLoading(true);
    setSubmitError(null);
    apiClient
      .get<PaperExamSeedResponse>(`/api/papers/${seedPaperId}/exam-seed`)
      .then((response) => {
        if (cancelled) return;
        const orderedItems = response.data.question_items
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((item, index) => ({
            question_id: item.question_id,
            order: index,
            score_override: item.score_override,
          }));
        setQuestionMode("manual");
        setQuestionIds(orderedItems.map((item) => item.question_id));
        setQuestionItems(orderedItems);
        setTitle(response.data.title || getDefaultPracticeTitle());
        setIsTitleManuallyEdited(true);
        setDescription(response.data.description ?? "");
        hydratedPaperSeedRef.current = seedPaperId;
      })
      .catch((error) => {
        if (cancelled) return;
        setSubmitError(
          getErrorMessage(error, "无法读取试卷题目，请返回试卷列表重试。"),
        );
        toast({
          title: "试卷加载失败",
          description: getErrorMessage(
            error,
            "无法读取试卷题目，请返回试卷列表重试。",
          ),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) {
          setSeedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isEditMode, seedPaperId, seedKey, toast]);

  // 从题目列表跳过来的 seed_key 分支：一次性从 sessionStorage 取出 payload，
  // 写入题目/标题/描述，然后路由以 category=practice 为准。
  useEffect(() => {
    if (isEditMode || !seedKey) return;
    if (hydratedSeedKeyRef.current === seedKey) return;
    hydratedSeedKeyRef.current = seedKey;
    const payload = consumeExamSeed(seedKey);
    if (!payload) {
      toast({
        title: "预填数据已过期",
        description: "请回到题目列表重新选择后再进入。",
        variant: "destructive",
      });
      return;
    }
    const orderedItems = payload.question_items
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((item, index) => ({
        question_id: item.question_id,
        order: index,
        score_override: item.score_override,
      }));
    setQuestionMode("manual");
    setQuestionIds(orderedItems.map((item) => item.question_id));
    setQuestionItems(orderedItems);
    if (payload.title) {
      setTitle(payload.title);
      setIsTitleManuallyEdited(true);
    }
    if (typeof payload.description === "string") {
      setDescription(payload.description);
    }
    setSubmitError(null);
  }, [isEditMode, seedKey, toast]);

  useEffect(() => {
    if (isEditMode || isTitleManuallyEdited || navState.courseName) return;
    setTitle(suggestedPracticeTitle);
  }, [isEditMode, isTitleManuallyEdited, suggestedPracticeTitle, navState.courseName]);

  const courseNavAppliedRef = useRef(false);
  useEffect(() => {
    if (isEditMode || courseNavAppliedRef.current) return;
    const {
      knowledgePointId,
      knowledgePointName,
      knowledgePointPath,
      mainKnowledgePointId,
      mainKnowledgePointName,
    } = navState;
    if (knowledgePointId && knowledgePointName) {
      courseNavAppliedRef.current = true;
      const kp: SelectedKnowledgePoint = {
        id: knowledgePointId,
        name: knowledgePointName,
        path: knowledgePointPath ?? knowledgePointName,
      };
      // 第一步的"课程"字段带上课程根节点，"知识点"字段带上具体的章节/知识点。
      // 课程信息缺省时回退到知识点本身，保持旧行为。
      const mainKp: SelectedKnowledgePoint =
        mainKnowledgePointId && mainKnowledgePointName
          ? {
              id: mainKnowledgePointId,
              name: mainKnowledgePointName,
              path: mainKnowledgePointName,
            }
          : kp;
      setMainKnowledgePoint(mainKp);
      setSelectedKnowledgePoints([kp]);
      if (navState.initialStep !== undefined) {
        setCurrentStep(navState.initialStep);
        setMaxVisitedStep((prev) => Math.max(prev, navState.initialStep!));
      }
    } else if (navState.courseName && navState.courseKpId) {
      // 从课程详情 tab 头部直接进入，只带课程信息不指定具体知识点时，
      // 自动选中"课程（可选）"字段。
      courseNavAppliedRef.current = true;
      setMainKnowledgePoint({
        id: navState.courseKpId,
        name: navState.courseName,
        path: navState.courseName,
      });
      if (navState.initialStep !== undefined) {
        setCurrentStep(navState.initialStep);
        setMaxVisitedStep((prev) => Math.max(prev, navState.initialStep!));
      }
    }
  }, [isEditMode, navState]);

  const allocationState = validateTypeAllocation(aiQuestionCount, aiTypeAlloc);
  const aiAllocationError =
    allocationState.hasCustomAllocation && !allocationState.isValid
      ? `题型数量之和 (${allocationState.allocated}) 与题目总数 (${aiQuestionCount}) 不一致`
      : null;

  const validateStep = (stepId: PracticeStepId): string | null => {
    if (stepId === "knowledge") {
      if (!title.trim()) return "请填写练习名称。";
    }

    if (stepId === "questions") {
      if (questionIds.length === 0) {
        if (questionMode === "manual") return "请先选择题目。";
        if (questionMode === "auto") return "请先自动生成题单。";
        return "请先生成练习题目。";
      }
    }

    if (stepId === "students") {
      if (studentIds.length === 0 && !publicLinkEnabled)
        return "请选择班级/学生，或开启公开链接。";
    }

    if (stepId === "publish") {
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return "练习时长必须大于 0。";
      }

      if (!startImmediately) {
        const startMs = new Date(scheduledStartTime).getTime();
        if (!scheduledStartTime || Number.isNaN(startMs)) {
          return "请填写有效的开始时间。";
        }
      }

      if (endTime) {
        const startMs = new Date(publishStartTime).getTime();
        const endMs = new Date(endTime).getTime();
        if (Number.isNaN(endMs)) return "请填写有效的结束时间。";
        if (!Number.isNaN(startMs) && endMs <= startMs) {
          return "结束时间必须晚于开始时间。";
        }
      }
    }

    return null;
  };

  const getStepStatus = (stepId: PracticeStepId) => {
    if (stepId === "knowledge") {
      if (selectedKnowledgePoints.length === 0) return "可跳过";
      return `已选 ${selectedKnowledgePoints.length} 个知识点`;
    }
    if (stepId === "questions") return `已选 ${questionIds.length} 题`;
    if (stepId === "students") {
      if (studentIds.length === 0 && publicLinkEnabled) return "公开链接";
      return `已选 ${studentIds.length} 人`;
    }
    return startImmediately ? "发布后立即开始" : "定时开始";
  };

  const findFirstInvalidStep = () => {
    for (let index = 0; index < stepItems.length; index += 1) {
      const message = validateStep(stepItems[index].id);
      if (message) return { index, message };
    }
    return null;
  };

  const submitValidation = findFirstInvalidStep();

  const goToStep = (index: number) => {
    if (index > maxVisitedStep) return;
    setSubmitError(null);
    setCurrentStep(index);
  };

  const goNext = () => {
    const error = validateStep(currentStepId);
    if (error) {
      setSubmitError(error);
      return;
    }

    setSubmitError(null);
    const next = Math.min(currentStep + 1, stepItems.length - 1);
    setCurrentStep(next);
    setMaxVisitedStep((prev) => Math.max(prev, next));
  };

  const goPrev = () => {
    setSubmitError(null);
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const persistAIQuestions = useCallback(
    async (
      questions: GeneratedQuestion[],
      options: { append?: boolean; showToast?: boolean } = {},
    ): Promise<number> => {
      if (questions.length === 0) {
        setSubmitError("请至少生成一道 AI 题目。");
        return 0;
      }

      setAIApplying(true);
      setSubmitError(null);
      try {
        const banks =
          await apiRequest<Array<{ id: string; name: string }>>(
            "/question-banks",
          );
        let bankId = banks.find((bank) => bank.name === "AI题库")?.id;
        if (!bankId) {
          const createdBank = await apiRequest<{ id: string }>(
            "/question-banks",
            {
              method: "POST",
              body: JSON.stringify({
                name: "AI题库",
                description: "AI 自动生成的练习题目",
              }),
            },
          );
          bankId = createdBank.id;
        }

        const createdQuestions = await Promise.all(
          questions.map((question) =>
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
                knowledge_point_ids: selectedKnowledgePoints.map(
                  (item) => item.id,
                ),
                question_bank_id: bankId,
              }),
            }),
          ),
        );

        const nextQuestionIds = createdQuestions.map((question) => question.id);
        setQuestionIds((prev) =>
          options.append
            ? Array.from(new Set([...prev, ...nextQuestionIds]))
            : nextQuestionIds,
        );
        setAIQuestions((prev) =>
          prev.map((question) => {
            const createdQuestion =
              createdQuestions[
                questions.findIndex((item) => item.index === question.index)
              ];
            return createdQuestion
              ? {
                  ...question,
                  persistedQuestionId: createdQuestion.id,
                  selected: true,
                }
              : question;
          }),
        );
        setPersistedAIQuestionKeys((prev) =>
          Array.from(
            new Set([
              ...prev,
              ...questions.map((question) =>
                getGeneratedQuestionPersistKey(question),
              ),
            ]),
          ),
        );
        if (options.showToast !== false) {
          toast({
            title: "AI 题目已加入练习",
            description: `已加入 ${createdQuestions.length} 道题目。`,
          });
        }
        return createdQuestions.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : "加入练习失败";
        setSubmitError(message);
        toast({
          title: "加入练习失败",
          description: message,
          variant: "destructive",
        });
        return 0;
      } finally {
        setAIApplying(false);
      }
    },
    [selectedKnowledgePoints, toast],
  );

  const handleAIGenerate = useCallback(async () => {
    if (aiAllocationError) {
      setSubmitError(aiAllocationError);
      return;
    }

    if (selectedKnowledgePoints.length === 0) {
      setSubmitError("请先选择知识点，再进行 AI 出题。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setAIQuestions([]);
    setPersistedAIQuestionKeys([]);
    setAIGenerating(true);
    setSubmitError(null);

    try {
      const token = localStorage.getItem("access_token");
      const typeDistribution = Object.fromEntries(
        Object.entries(aiTypeAlloc).filter(([, value]) => value > 0),
      );
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          total_count: aiQuestionCount,
          difficulty: aiDifficulty,
          type_distribution:
            Object.keys(typeDistribution).length > 0
              ? typeDistribution
              : undefined,
          knowledge_point_ids: selectedKnowledgePoints.map((item) => item.id),
          course_name:
            mainKnowledgePoint?.name ?? navState.mainKnowledgePointName ?? "",
          exam_title: title.trim() || undefined,
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
      const persistPromises: Array<Promise<number>> = [];

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
            const nextQuestion: GeneratedQuestion = {
              index: questionIndex++,
              type: event.data.type ?? "choice",
              title: event.data.title ?? "",
              content: {
                text: event.data.content?.text ?? event.data.title ?? "",
              },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? aiDifficulty,
              selected: true,
            };
            nextQuestions = [...nextQuestions, nextQuestion];
            setAIQuestions(nextQuestions);
            persistPromises.push(
              persistAIQuestions([nextQuestion], {
                append: true,
                showToast: false,
              }),
            );
          } else if (event.type === "error") {
            throw new Error(event.message ?? "AI 出题失败");
          }
        }
      }

      const persistedCount = (await Promise.all(persistPromises)).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (persistedCount > 0) {
        toast({
          title: "AI 题目已加入练习",
          description: `已自动加入 ${persistedCount} 道题目。`,
        });
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const message = error instanceof Error ? error.message : "AI 出题失败";
        setSubmitError(message);
        toast({
          title: "AI 出题失败",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setAIGenerating(false);
      abortRef.current = null;
    }
  }, [
    aiAllocationError,
    aiDifficulty,
    aiModel,
    aiPrompt,
    aiQuestionCount,
    aiTypeAlloc,
    persistAIQuestions,
    selectedKnowledgePoints,
    toast,
  ]);

  const stopAIGeneration = () => {
    abortRef.current?.abort();
  };

  const resetAutoSelection = ({
    clearQuestions = true,
  }: {
    clearQuestions?: boolean;
  } = {}) => {
    setAutoQuestionBankId(null);
    setAutoBankExplicit(false);
    setAutoQuestionCount(10);
    setAutoDifficulties([2, 3, 4]);
    setAutoKnowledgeAllocations([]);
    setAutoTypeAllocations({});
    setAutoTypeCountDrafts({});
    setAutoTypeScoreDrafts({});
    setAutoGeneratedMeta(null);
    setAutoKnowledgeQuotaOpen(false);
    if (clearQuestions) {
      setQuestionIds([]);
      setQuestionItems([]);
    }
  };

  const handleAutoDifficultyChange = (level: number, checked: boolean) => {
    setAutoGeneratedMeta(null);
    setAutoDifficulties((prev) => {
      if (checked) {
        return prev.includes(level)
          ? prev
          : [...prev, level].sort((left, right) => left - right);
      }
      return prev.filter((item) => item !== level);
    });
  };

  const changeQuestionMode = (nextMode: QuestionMode) => {
    if (nextMode === questionMode) return;

    if (questionMode === "manual" && nextMode !== "manual") {
      setQuestionIds([]);
      setQuestionItems([]);
      setAIQuestions([]);
      setAIApplying(false);
      setPersistedAIQuestionKeys([]);
    }
    if (questionMode === "auto" && nextMode !== "auto") {
      resetAutoSelection({ clearQuestions: true });
    }
    if (questionMode === "ai" && nextMode !== "ai") {
      abortRef.current?.abort();
      setAIGenerating(false);
      setAIApplying(false);
      setQuestionIds([]);
      setQuestionItems([]);
    }

    setQuestionMode(nextMode);
  };

  const handleKnowledgeAllocationToggle = (
    knowledgePointId: string,
    checked: boolean,
  ) => {
    setAutoGeneratedMeta(null);
    setAutoKnowledgeAllocations((prev) => {
      if (checked) {
        if (
          prev.some(
            (allocation) => allocation.knowledgePointId === knowledgePointId,
          )
        ) {
          return prev;
        }
        return [...prev, { knowledgePointId, count: 1 }];
      }

      return prev.filter(
        (allocation) => allocation.knowledgePointId !== knowledgePointId,
      );
    });
  };

  const handleKnowledgeAllocationCountChange = (
    knowledgePointId: string,
    value: string,
  ) => {
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

  const handleTypeAllocationCountChange = (
    type: QuestionDisplayType,
    value: string,
  ) => {
    const nextCount = Math.max(0, parseInt(value, 10) || 0);
    setAutoGeneratedMeta(null);
    setAutoKnowledgeAllocations([]);
    setAutoTypeAllocations((prev) => ({
      ...prev,
      [type]: {
        count: nextCount,
        score: prev[type]?.score ?? AUTO_TYPE_DEFAULT_SCORES[type],
      },
    }));
  };

  const handleTypeAllocationScoreChange = (
    type: QuestionDisplayType,
    value: string,
  ) => {
    const nextScore = Math.max(0, Number(value) || 0);
    setAutoGeneratedMeta(null);
    setAutoTypeAllocations((prev) =>
      prev[type]
        ? { ...prev, [type]: { ...prev[type], score: nextScore } }
        : prev,
    );
  };

  const commitTypeAllocationCount = (type: QuestionDisplayType, value: string) => {
    handleTypeAllocationCountChange(type, value);
    setAutoTypeCountDrafts((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  };

  const commitTypeAllocationScore = (type: QuestionDisplayType, value: string) => {
    handleTypeAllocationScoreChange(type, value);
    setAutoTypeScoreDrafts((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  };

  const applyEvenKnowledgeCoverage = () => {
    setAutoGeneratedMeta(null);
    setSubmitError(null);
    const targetCount = isTypeAllocationMode
      ? requestedTypeQuestionCount
      : autoQuestionCount;
    if (!Number.isFinite(targetCount) || targetCount <= 0) {
      setSubmitError("请先设置题型数量或出题数量，再进行知识点配额。");
      return;
    }
    const allocations = buildEvenKnowledgeAllocations(targetCount);
    if (allocations.length === 0) {
      setSubmitError("当前题库与难度条件下暂无可用知识点，无法均匀覆盖。");
      return;
    }
    setAutoKnowledgeAllocations(allocations);
  };

  const handleAutoGenerate = () => {
    setSubmitError(null);
    setAutoGeneratedMeta(null);

    if (autoDifficulties.length === 0) {
      setSubmitError("自动出题至少需要选择一个难度范围。");
      return;
    }

    if (isTypeAllocationMode) {
      if (hasTypeAllocationShortage) {
        setSubmitError("所选题型的可用题量不足，请调整每种题型的题目数量。");
        return;
      }
      if (hasKnowledgeAllocationShortage) {
        setSubmitError("所选知识点的可用题量不足，请调整每个知识点的题目数量。");
        return;
      }
      if (hasKnowledgeAllocationMismatch) {
        setSubmitError(
          `知识点配额合计为 ${requestedKnowledgeQuestionCount} 题，必须等于当前题型计划的 ${requestedTypeQuestionCount} 题。`,
        );
        return;
      }
      if (
        typeAllocationEntries.some(([, allocation]) => allocation.score <= 0)
      ) {
        setSubmitError("请为每种已启用的题型设置大于 0 的分值。");
        return;
      }

      const typePicked: IQuestion[] = [];
      const scoreByQuestionId = new Map<string, number>();
      const pickedIds = new Set<string>();

      if (isKnowledgeAllocationMode) {
        const remainingByType = new Map<QuestionDisplayType, number>(
          typeAllocationEntries.map(([type, allocation]) => [
            type,
            allocation.count,
          ]),
        );
        const remainingByKnowledge = new Map<string, number>(
          autoKnowledgeAllocations.map((allocation) => [
            allocation.knowledgePointId,
            allocation.count,
          ]),
        );
        const candidatesByKnowledgeAndType = new Map<
          string,
          Partial<Record<QuestionDisplayType, IQuestion[]>>
        >();
        for (const question of autoCandidates) {
          const displayType = getQuestionDisplayType(question);
          if (!displayType || !autoTypeAllocations[displayType]?.count) continue;
          for (const knowledgePoint of question.knowledge_points) {
            const typeMap =
              candidatesByKnowledgeAndType.get(knowledgePoint.id) ?? {};
            const candidates = typeMap[displayType] ?? [];
            candidates.push(question);
            typeMap[displayType] = candidates;
            candidatesByKnowledgeAndType.set(knowledgePoint.id, typeMap);
          }
        }
        for (const [type, allocation] of typeAllocationEntries) {
          let remainingForType = allocation.count;

          while (remainingForType > 0) {
            const knowledgeCandidates = autoKnowledgeAllocations
              .map((knowledgeAllocation) => {
                const knowledgeRemaining =
                  remainingByKnowledge.get(
                    knowledgeAllocation.knowledgePointId,
                  ) ?? 0;
                const candidates = (
                  candidatesByKnowledgeAndType.get(
                    knowledgeAllocation.knowledgePointId,
                  )?.[type] ?? []
                ).filter((question) => !pickedIds.has(question.id));
                return {
                  knowledgePointId: knowledgeAllocation.knowledgePointId,
                  knowledgeRemaining,
                  candidates,
                };
              })
              .filter(
                (item) =>
                  item.knowledgeRemaining > 0 && item.candidates.length > 0,
              )
              .sort((left, right) => {
                const leftPressure =
                  left.candidates.length - left.knowledgeRemaining;
                const rightPressure =
                  right.candidates.length - right.knowledgeRemaining;
                return (
                  leftPressure - rightPressure ||
                  right.knowledgeRemaining - left.knowledgeRemaining
                );
              });

            const selectedKnowledge = knowledgeCandidates[0];
            if (!selectedKnowledge) break;

            const selected = selectDistinctQuestions(
              selectedKnowledge.candidates,
              1,
              typePicked,
            )[0];
            if (!selected) break;

            typePicked.push(selected);
            pickedIds.add(selected.id);
            scoreByQuestionId.set(selected.id, allocation.score);
            remainingForType -= 1;
            remainingByType.set(type, remainingForType);
            remainingByKnowledge.set(
              selectedKnowledge.knowledgePointId,
              selectedKnowledge.knowledgeRemaining - 1,
            );
          }
        }

        const remainingTypeCount = Array.from(remainingByType.values()).reduce(
          (sum, count) => sum + Math.max(0, count),
          0,
        );
        const remainingKnowledgeCount = Array.from(
          remainingByKnowledge.values(),
        ).reduce((sum, count) => sum + Math.max(0, count), 0);

        if (remainingTypeCount > 0 || remainingKnowledgeCount > 0) {
          setSubmitError(
            "当前知识点配额无法同时满足题型分布，请减少某些知识点数量或重新按章节均匀覆盖。",
          );
          return;
        }
      } else {
        const candidatesByType = new Map<QuestionDisplayType, IQuestion[]>();
        for (const question of autoCandidates) {
          const displayType = getQuestionDisplayType(question);
          if (!displayType) continue;
          const candidates = candidatesByType.get(displayType) ?? [];
          candidates.push(question);
          candidatesByType.set(displayType, candidates);
        }
        for (const [type, allocation] of typeAllocationEntries) {
          const candidatesForType = (candidatesByType.get(type) ?? []).filter(
            (question) => !pickedIds.has(question.id),
          );
          const selectedForType = selectDistinctQuestions(
            candidatesForType,
            allocation.count,
            typePicked,
          );
          typePicked.push(...selectedForType);
          selectedForType.forEach((question) => {
            pickedIds.add(question.id);
            scoreByQuestionId.set(question.id, allocation.score);
          });
        }
      }

      if (typePicked.length !== requestedTypeQuestionCount) {
        setSubmitError(
          `去除重复或相似题后，只能生成 ${typePicked.length} 道题，请减少题量或扩大题库/知识点范围。`,
        );
        return;
      }

      setQuestionIds(typePicked.map((question) => question.id));
      setQuestionItems(
        typePicked.map((question, index) => ({
          question_id: question.id,
          order: index,
          score_override:
            scoreByQuestionId.get(question.id) ?? question.score ?? null,
        })),
      );
      setAutoGeneratedMeta({
        count: typePicked.length,
        totalScore: Number(
          typePicked
            .reduce(
              (sum, question) =>
                sum + (scoreByQuestionId.get(question.id) ?? question.score),
              0,
            )
            .toFixed(2),
          ),
      });
      return;
    }

    if (
      !isKnowledgeAllocationMode &&
      (!Number.isFinite(autoQuestionCount) || autoQuestionCount <= 0)
    ) {
      setSubmitError("请填写有效的出题数量。");
      return;
    }

    if (isKnowledgeAllocationMode && requestedKnowledgeQuestionCount <= 0) {
      setSubmitError("请至少为一个知识点设置大于 0 的题目数量。");
      return;
    }

    if (isKnowledgeAllocationMode && hasKnowledgeAllocationShortage) {
      setSubmitError("所选知识点的可用题量不足，请调整每个知识点的题目数量。");
      return;
    }

    if (
      !isKnowledgeAllocationMode &&
      autoCandidates.length < autoQuestionCount
    ) {
      setSubmitError(
        `当前条件下只有 ${autoCandidates.length} 道题，无法生成 ${autoQuestionCount} 道试题。`,
      );
      return;
    }

    let picked: IQuestion[] = [];
    let remainingPool = [...autoCandidates];
    const allocations = isKnowledgeAllocationMode
      ? autoKnowledgeAllocations
      : buildEvenKnowledgeAllocations(knowledgeQuotaTargetCount);

    for (const allocation of allocations) {
      const candidatesForKnowledge = remainingPool.filter((question) =>
        question.knowledge_points.some(
          (knowledgePoint) => knowledgePoint.id === allocation.knowledgePointId,
        ),
      );
      const selectedForKnowledge = selectDistinctQuestions(
        candidatesForKnowledge,
        allocation.count,
        picked,
      );
      picked = [...picked, ...selectedForKnowledge];
      const selectedIds = new Set(
        selectedForKnowledge.map((question) => question.id),
      );
      remainingPool = remainingPool.filter(
        (question) => !selectedIds.has(question.id),
      );
    }

    if (!isKnowledgeAllocationMode && picked.length < autoQuestionCount) {
      picked = [
        ...picked,
        ...selectDistinctQuestions(
          remainingPool,
          autoQuestionCount - picked.length,
          picked,
        ),
      ];
    }

    const expectedAutoCount = isKnowledgeAllocationMode
      ? requestedKnowledgeQuestionCount
      : autoQuestionCount;
    if (picked.length < expectedAutoCount) {
      setSubmitError(
        `去除重复或相似题后，只能生成 ${picked.length} 道题，请减少题量或扩大题库/知识点范围。`,
      );
      return;
    }

    setQuestionIds(picked.map((question) => question.id));
    setAutoGeneratedMeta({
      count: picked.length,
      totalScore: picked.reduce((sum, question) => sum + question.score, 0),
    });
  };

  const removeAIQuestion = (index: number) => {
    const target = aiQuestions.find((question) => question.index === index);
    setAIQuestions((prev) =>
      prev.filter((question) => question.index !== index),
    );
    if (target?.persistedQuestionId) {
      setQuestionIds((prev) =>
        prev.filter((questionId) => questionId !== target.persistedQuestionId),
      );
    }
  };

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

  const replaceQuestion = useCallback((oldId: string, newId: string) => {
    setQuestionIds((prev) =>
      prev.map((questionId) => (questionId === oldId ? newId : questionId)),
    );
    setQuestionItems((prev) =>
      prev.map((item) =>
        item.question_id === oldId ? { ...item, question_id: newId } : item,
      ),
    );
  }, []);

  const applyTypeScoreAllocation = (summary: QuestionTypeSummary) => {
    const draftValue = Number(typeScoreDrafts[summary.type] ?? "");
    if (!Number.isFinite(draftValue) || draftValue <= 0) {
      toast({
        title: "题型总分无效",
        description: `${questionTypeLabels[summary.type]}的总分必须大于 0。`,
        variant: "destructive",
      });
      return;
    }

    const totalCents = Math.round(draftValue * 100);
    const baseCents = Math.floor(totalCents / summary.count);
    const remainder = totalCents - baseCents * summary.count;

    setQuestionItems((prev) => {
      let matched = 0;
      return prev.map((item) => {
        if (!summary.questionIds.includes(item.question_id)) {
          return item;
        }

        const cents =
          baseCents + (matched === summary.count - 1 ? remainder : 0);
        matched += 1;
        return {
          ...item,
          score_override: Number((cents / 100).toFixed(2)),
        };
      });
    });
  };

  const handleSubmit = () => {
    const invalidStep = findFirstInvalidStep();
    if (invalidStep) {
      setCurrentStep(invalidStep.index);
      setMaxVisitedStep((prev) => Math.max(prev, invalidStep.index));
      setSubmitError(invalidStep.message);
      return;
    }

    setSubmitError(null);
    const values = {
      category: "practice" as const,
      title: title.trim(),
      description: description.trim() || null,
      start_time: toSubmitDateTime(publishStartTime),
      end_time: toSubmitDateTime(endTime),
      duration_minutes: durationMinutes,
      total_score: totalScore,
      status: getPublishedExamStatus(
        { start_time: publishStartTime, end_time: endTime },
        new Date(),
      ),
      position_id: null,
      max_switch_count: 0,
      show_result: showResult,
      allow_retake: allowRetake,
      notes_template: null,
      question_mode: questionMode,
      question_ids: [],
      question_items: questionItems.map((item, index) => ({
        question_id: item.question_id,
        order: index,
        score_override: item.score_override,
      })),
      student_ids: studentIds,
    };

    const onError = (error: unknown) => {
      const message = getErrorMessage(
        error,
        isEditMode
          ? "保存练习失败，请稍后重试。"
          : "发布练习失败，请稍后重试。",
      );
      setSubmitError(message);
      toast({
        title: isEditMode ? "保存失败" : "发布失败",
        description: message,
        variant: "destructive",
      });
    };

    const createPublicLink = async (
      examId: string,
      fallbackMessage: string,
    ) => {
      if (!publicLinkEnabled) return;
      try {
        const link = await apiClient.post<PublicLinkResponse>(
          `/api/exams/${examId}/public-link`,
        );
        await navigator.clipboard
          ?.writeText(link.data.public_url)
          .catch(() => undefined);
        toast({
          title: "公开链接已生成",
          description: "公开链接已复制，外部考生填写姓名和手机号后即可进入。",
        });
      } catch (error) {
        toast({
          title: "公开链接生成失败",
          description: getErrorMessage(error, fallbackMessage),
          variant: "destructive",
        });
      }
    };

    if (isEditMode && id) {
      update(
        {
          resource: "exams",
          id,
          values,
        },
        {
          onSuccess: async () => {
            await createPublicLink(id, "练习已保存，但公开链接生成失败。");
            toast({
              title: "保存成功",
              description: "练习修改已保存。",
            });
          },
          onError,
        },
      );
      return;
    }

    create(
      {
        resource: "exams",
        values: {
          ...values,
          ...(navState.courseKpId ? { course_kp_id: navState.courseKpId } : {}),
          ...(navState.courseSemesterId
            ? { course_semester_id: navState.courseSemesterId }
            : {}),
        },
      },
      {
        onSuccess: async (response) => {
          const createdId = response.data?.id ? String(response.data.id) : "";
          if (createdId) {
            await createPublicLink(
              createdId,
              "练习已发布，但公开链接生成失败。",
            );
          }
          toast({
            title: "发布成功",
            description: "练习已发布，正在返回列表。",
          });
          navigate(navState.successTo ?? "/exams");
        },
        onError,
      },
    );
  };

  if (isEditMode && (practiceQuery.isLoading || !practice)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!isEditMode && seedPaperId && seedLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        正在加载试卷题目...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {unsavedGuardDialog}
      <PageIntroHeader
        title={isEditMode ? "编辑练习" : "发布练习"}
        description={
          isEditMode
            ? "调整知识点、题目、发布对象与时间设置，让练习安排更贴合当前教学。"
            : "按步骤选择知识点、题目与学生，快速发布一场可追踪的课堂练习。"
        }
        onBack={() =>
          navigate(navState.backTo ?? "/exams", {
            state: { courseOrigin: navState.courseOrigin },
          })
        }
        backLabel={navState.backLabel ?? "返回考试与练习"}
      />

      <Dialog open={scoreDialogOpen} onOpenChange={setScoreDialogOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>预览与设置分数</DialogTitle>
            <DialogDescription>
              查看练习题目内容，并按题型或逐题设置每道题的练习分数。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
            <div className="text-sm text-muted-foreground">
              已选{" "}
              <span className="font-semibold text-foreground">
                {sortedQuestionItems.length}
              </span>{" "}
              题，合计{" "}
              <span className="font-semibold text-foreground">
                {totalScore}
              </span>{" "}
              分
            </div>
            <div className="flex rounded-lg border border-border bg-muted/30 p-1">
              <Button
                type="button"
                variant={scorePreviewMode === "order" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setScorePreviewMode("order")}
              >
                按顺序
              </Button>
              <Button
                type="button"
                variant={scorePreviewMode === "type" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setScorePreviewMode("type")}
              >
                按题型
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto rounded-2xl bg-muted/10">
            {sortedQuestionItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                还没有题目，请先返回第 2 步选择题目。
              </div>
            ) : scorePreviewMode === "order" ? (
              <div className="divide-y divide-border/70">
                {sortedQuestionItems.map((item, index) => {
                  const question = selectedQuestionMap.get(item.question_id);
                  const invalidScore =
                    !Number.isFinite(item.score_override) ||
                    (item.score_override ?? 0) <= 0;
                  const scoreInputId = `practice-question-score-${item.question_id}`;

                  return (
                    <div key={item.question_id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                          <Badge variant="outline">第 {index + 1} 题</Badge>
                          <span className="text-sm font-medium text-foreground/80">
                            {question ? getPracticeQuestionTypeLabel(question) : "题目"}
                          </span>
                          {question ? (
                            <span className="text-xs text-muted-foreground">
                              {DIFFICULTY_LABELS[question.difficulty] ??
                                question.difficulty}
                            </span>
                          ) : null}
                          {question &&
                          question.knowledge_points.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {question.knowledge_points
                                .map((kp) => kp.name)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {question ? (
                            <ExamQuestionActions
                              question={question}
                              currentExamQuestionIds={questionIds}
                              onReplaceQuestion={replaceQuestion}
                              courseKnowledgePointId={
                                mainKnowledgePoint?.id ?? navState.courseKpId
                              }
                              examTitle={title}
                            />
                          ) : null}
                          <Label
                            htmlFor={scoreInputId}
                            className="text-xs text-muted-foreground"
                          >
                            练习分数
                          </Label>
                          <Input
                            id={scoreInputId}
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={item.score_override ?? ""}
                            onChange={(event) =>
                              updateQuestionScore(
                                item.question_id,
                                event.target.value,
                              )
                            }
                            className={cn(
                              "h-8 w-20 bg-background px-2 text-right text-xs shadow-sm",
                              invalidScore &&
                                "border-destructive/50 text-destructive focus-visible:ring-destructive/30",
                            )}
                          />
                          <span className="text-sm text-muted-foreground">
                            分
                          </span>
                        </div>
                      </div>
                      {question ? (
                        <QuestionPreviewCard
                          question={question}
                          mode="detailed"
                          defaultExpanded
                          hideHeader
                          hideMeta
                          markChoiceAnswer
                          className="mt-2 w-full border-0 bg-transparent p-0 shadow-none"
                        />
                      ) : (
                        <p className="mt-2 text-sm font-medium text-foreground">
                          题目 {index + 1}
                        </p>
                      )}
                      {invalidScore ? (
                        <p className="mt-1 text-xs text-destructive">
                          练习分数必须大于 0。
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {questionItemsByType.map(({ summary, items }) => (
                  <section key={summary.type} className="px-4 py-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <Badge variant="outline">
                          {questionTypeLabels[summary.type]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {summary.count} 题
                        </span>
                        <span className="text-xs text-muted-foreground">
                          当前合计 {summary.totalScore} 分
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Label
                          htmlFor={`practice-type-total-score-${summary.type}`}
                          className="text-xs text-muted-foreground"
                        >
                          题型总分
                        </Label>
                        <Input
                          id={`practice-type-total-score-${summary.type}`}
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={typeScoreDrafts[summary.type] ?? ""}
                          onChange={(event) =>
                            setTypeScoreDrafts((prev) => ({
                              ...prev,
                              [summary.type]: event.target.value,
                            }))
                          }
                          className="h-8 w-20 bg-background px-2 text-right text-xs shadow-sm"
                        />
                        <span className="text-xs text-muted-foreground">
                          分
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => applyTypeScoreAllocation(summary)}
                        >
                          均分到每题
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {items.map((item, index) => {
                        const question = selectedQuestionMap.get(
                          item.question_id,
                        );
                        const invalidScore =
                          !Number.isFinite(item.score_override) ||
                          (item.score_override ?? 0) <= 0;
                        const scoreInputId = `practice-type-question-score-${item.question_id}`;

                        return (
                          <div
                            key={item.question_id}
                            className="space-y-2 rounded-xl bg-background/70 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex min-w-0 flex-wrap items-center gap-3">
                                <Badge variant="outline">
                                  {questionTypeLabels[summary.type]} 第{" "}
                                  {index + 1} 题
                                </Badge>
                                {question ? (
                                  <span className="text-xs text-muted-foreground">
                                    {DIFFICULTY_LABELS[question.difficulty] ??
                                      question.difficulty}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {question ? (
                                  <ExamQuestionActions
                                    question={question}
                                    currentExamQuestionIds={questionIds}
                                    onReplaceQuestion={replaceQuestion}
                                    courseKnowledgePointId={
                                      mainKnowledgePoint?.id ?? navState.courseKpId
                                    }
                                    examTitle={title}
                                  />
                                ) : null}
                                <Label
                                  htmlFor={scoreInputId}
                                  className="text-xs text-muted-foreground"
                                >
                                  练习分数
                                </Label>
                                <Input
                                  id={scoreInputId}
                                  type="number"
                                  min={0.5}
                                  step={0.5}
                                  value={item.score_override ?? ""}
                                  onChange={(event) =>
                                    updateQuestionScore(
                                      item.question_id,
                                      event.target.value,
                                    )
                                  }
                                  className={cn(
                                    "h-8 w-20 bg-background px-2 text-right text-xs shadow-sm",
                                    invalidScore &&
                                      "border-destructive/50 text-destructive focus-visible:ring-destructive/30",
                                  )}
                                />
                                <span className="text-sm text-muted-foreground">
                                  分
                                </span>
                              </div>
                            </div>
                            {question ? (
                              <QuestionPreviewCard
                                question={question}
                                mode="detailed"
                                defaultExpanded
                                hideHeader
                                hideMeta
                                markChoiceAnswer
                                className="w-full border-0 bg-transparent p-0 shadow-none"
                              />
                            ) : (
                              <p className="text-sm font-medium text-foreground">
                                题目 {index + 1}
                              </p>
                            )}
                            {invalidScore ? (
                              <p className="text-xs text-destructive">
                                练习分数必须大于 0。
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {submitError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-1 bg-gradient-to-br from-amber-50 via-background to-slate-50 pb-3 dark:from-amber-950/20 dark:via-background dark:to-slate-900">
              <CardTitle className="flex items-center gap-3 text-[15px]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-700 shadow-sm dark:text-amber-300">
                  <Compass size={18} />
                </span>
                操作指南
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-3">
              <div className="relative space-y-6">
                <div className="absolute left-5 top-4 bottom-4 w-px bg-border" />
                {stepItems.map((step, index) => {
                  const isActive = index === currentStep;
                  const isDone = index < currentStep;
                  const isClickable = index <= maxVisitedStep;

                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={!isClickable}
                      onClick={() => goToStep(index)}
                      className={cn(
                        "group relative flex w-full gap-3 rounded-md p-1 pr-2 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        !isClickable && "cursor-not-allowed opacity-70",
                      )}
                    >
                      <span
                        className={cn(
                          "relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background transition-colors",
                          isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : isDone
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground group-hover:border-primary/40 group-hover:text-foreground",
                        )}
                      >
                        {isDone ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <span className="h-2.5 w-2.5 rounded-full bg-current/80" />
                        )}
                      </span>
                      <span className="min-w-0 space-y-1.5 pt-0.5">
                        <span className="block text-sm font-semibold tracking-tight text-foreground">
                          {step.title}
                        </span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          {step.description}
                        </span>
                        <span
                          className={cn(
                            "inline-flex min-h-6 items-center rounded-md px-2 text-[11px] font-medium",
                            isActive
                              ? practiceBadgeClass
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {getStepStatus(step.id)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-6">
          {currentStepId === "knowledge" && (
            <Card>
              <CardHeader>
                <CardTitle>步骤 1：选择知识点</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <KnowledgePointSelector
                  fetcher={apiRequest}
                  selectedKnowledgePoints={
                    mainKnowledgePoint ? [mainKnowledgePoint] : []
                  }
                  onSelectedKnowledgePointsChange={(points) => {
                    const next = points[points.length - 1] ?? null;
                    setMainKnowledgePoint(next);
                    if (next?.id !== mainKnowledgePoint?.id) {
                      setSelectedKnowledgePoints([]);
                    }
                  }}
                  storageKey="practice-main-knowledge-point"
                  label={mainKPLabel}
                  triggerLabel={mainKPTrigger}
                  selectionTarget="root"
                  selectionMode="single"
                  showUsageShortcuts={false}
                  popoverSide="bottom"
                />

                <KnowledgePointSelector
                  fetcher={apiRequest}
                  selectedKnowledgePoints={selectedKnowledgePoints}
                  onSelectedKnowledgePointsChange={setSelectedKnowledgePoints}
                  storageKey="practice-publish-recent-keywords"
                  label="知识点（可选）"
                  triggerLabel="选择知识点"
                  popoverSide="bottom"
                  filterRootNodeId={mainKnowledgePoint?.id}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="practice-title">练习名称</Label>
                  <Input
                    id="practice-title"
                    value={title}
                    onChange={(event) => {
                      setIsTitleManuallyEdited(true);
                      setTitle(event.target.value);
                    }}
                    placeholder={suggestedPracticeTitle}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practice-description">
                    练习说明（可不填）
                  </Label>
                  <Textarea
                    id="practice-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="补充说明这次练习的范围或目标"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {currentStepId === "questions" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>步骤 2：选择题目 / 自动出题 / AI出题</CardTitle>
                {questionMode === "manual" && (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      已选{" "}
                      <span className="font-semibold text-foreground">
                        {questionIds.length}
                      </span>{" "}
                      题
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsManualQuestionFullscreen(true)}
                    >
                      <Maximize2 size={14} />
                      全屏展示
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => changeQuestionMode("manual")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      questionMode === "manual"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <BookCopy
                        size={16}
                        className={
                          questionMode === "manual"
                            ? "text-primary"
                            : "text-muted-foreground"
                        }
                      />
                      <p className="text-sm font-semibold text-foreground">
                        手动选题
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => changeQuestionMode("auto")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      questionMode === "auto"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles
                        size={16}
                        className={
                          questionMode === "auto"
                            ? "text-primary"
                            : "text-muted-foreground"
                        }
                      />
                      <p className="text-sm font-semibold text-foreground">
                        自动出题
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => changeQuestionMode("ai")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      questionMode === "ai"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Wand2
                        size={16}
                        className={
                          questionMode === "ai"
                            ? "text-primary"
                            : "text-muted-foreground"
                        }
                      />
                      <p className="text-sm font-semibold text-foreground">
                        AI出题
                      </p>
                    </div>
                  </button>
                </div>

                {questionMode === "manual" ? (
                  <QuestionSelector
                    selectedIds={questionIds}
                    onChange={setQuestionIds}
                    knowledgePointOptions={selectedKnowledgePoints}
                    showSummary={false}
                    isFullscreen={isManualQuestionFullscreen}
                    onFullscreenChange={setIsManualQuestionFullscreen}
                    initialBankName={wizardDefaultBankName}
                    initialKnowledgePointId={
                      navState.knowledgePointId
                    }
                    autoSelectAll={
                      !isEditMode && Boolean(navState.knowledgePointId)
                    }
                  />
                ) : questionMode === "auto" ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                      <Select
                        value={effectiveAutoBankId ?? ALL_BANKS}
                        onValueChange={(value) => {
                          setAutoBankExplicit(true);
                          setAutoQuestionBankId(
                            value === ALL_BANKS ? null : value,
                          );
                          setAutoGeneratedMeta(null);
                        }}
                      >
                        <SelectTrigger id="practice-auto-question-bank">
                          <SelectValue placeholder="题库范围：全部题库" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_BANKS}>全部题库</SelectItem>
                          {questionBanks.map((bank) => (
                            <SelectItem key={bank.id} value={bank.id}>
                              {formatQuestionBankLabel(bank, {
                                showOwner: role === "platform_admin",
                              })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                          抽取
                        </span>
                        <Input
                          id="practice-auto-question-count"
                          type="number"
                          min={1}
                          placeholder="出题数量"
                          aria-label="出题数量"
                          value={
                            isTypeAllocationMode
                              ? requestedTypeQuestionCount
                              : isKnowledgeAllocationMode
                                ? requestedKnowledgeQuestionCount
                                : autoQuestionCount
                          }
                          onChange={(event) => {
                            setAutoQuestionCount(
                              parseInt(event.target.value, 10) || 0,
                            );
                            setAutoGeneratedMeta(null);
                          }}
                          disabled={
                            isTypeAllocationMode || isKnowledgeAllocationMode
                          }
                          className="px-11 text-center"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                          题
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {difficultyOptions.map((item) => {
                        const checked = autoDifficulties.includes(item.value);
                        return (
                          <label
                            key={item.value}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                              checked
                                ? "border-primary font-medium text-primary"
                                : "border-border bg-background text-foreground",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                handleAutoDifficultyChange(
                                  item.value,
                                  value === true,
                                )
                              }
                            />
                            <span>{item.label}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            题型分布
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            设置题型数量与每题分值后，系统会按题型从题库自动抽题。
                          </p>
                        </div>
                        {isTypeAllocationMode ? (
                          <Badge variant="secondary">
                            合计 {requestedTypeQuestionCount} 题
                          </Badge>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        {AUTO_TYPE_DISTRIBUTION_OPTIONS.map(
                          ({ type, label }) => {
                            const allocation = autoTypeAllocations[type];
                            const available = availableTypeCounts[type] ?? 0;
                            const disabled = available <= 0;
                            const shortage = allocation
                              ? allocation.count > available
                              : false;
                            const countValue =
                              autoTypeCountDrafts[type] ??
                              allocation?.count ??
                              "";
                            const scoreValue =
                              autoTypeScoreDrafts[type] ??
                              allocation?.score ??
                              "";

                            return (
                              <div
                                key={type}
                                className={cn(
                                  "grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_110px_120px]",
                                  allocation && allocation.count > 0
                                    ? "border-primary/40 bg-background"
                                    : "border-border bg-background/70",
                                  disabled && "opacity-60",
                                )}
                              >
                                <div className="min-w-0">
                                  <span className="block text-sm font-medium text-foreground">
                                    {label}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    {disabled
                                      ? "当前无可用题目"
                                      : `当前可用 ${available} 题`}
                                  </span>
                                  {shortage ? (
                                    <span className="mt-1 flex items-center gap-1 text-xs text-destructive">
                                      <CircleAlert size={12} />
                                      数量不足，最多可选 {available} 题
                                    </span>
                                  ) : null}
                                </div>

                                <Input
                                  type="number"
                                  min={0}
                                  max={available}
                                  aria-label={`${label}数量`}
                                  placeholder="数量"
                                  value={countValue}
                                  disabled={disabled}
                                  onFocus={() =>
                                    setAutoTypeCountDrafts((prev) => ({
                                      ...prev,
                                      [type]:
                                        allocation?.count != null
                                          ? String(allocation.count)
                                          : "",
                                    }))
                                  }
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setAutoTypeCountDrafts((prev) => ({
                                      ...prev,
                                      [type]: nextValue,
                                    }));
                                    if (nextValue !== "") {
                                      handleTypeAllocationCountChange(
                                        type,
                                        nextValue,
                                      );
                                    }
                                  }}
                                  onBlur={(event) =>
                                    commitTypeAllocationCount(
                                      type,
                                      event.currentTarget.value,
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.currentTarget.blur();
                                    }
                                  }}
                                />

                                <div className="relative">
                                  <Input
                                    type="number"
                                    min={0.5}
                                    step={0.5}
                                    aria-label={`${label}每题分值`}
                                    placeholder="每题分值"
                                    value={scoreValue}
                                    disabled={
                                      disabled ||
                                      !allocation ||
                                      allocation.count <= 0
                                    }
                                    onFocus={() =>
                                      setAutoTypeScoreDrafts((prev) => ({
                                        ...prev,
                                        [type]:
                                          allocation?.score != null
                                            ? String(allocation.score)
                                            : "",
                                      }))
                                    }
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setAutoTypeScoreDrafts((prev) => ({
                                        ...prev,
                                        [type]: nextValue,
                                      }));
                                      if (nextValue !== "") {
                                        handleTypeAllocationScoreChange(
                                          type,
                                          nextValue,
                                        );
                                      }
                                    }}
                                    onBlur={(event) =>
                                      commitTypeAllocationScore(
                                        type,
                                        event.currentTarget.value,
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    className="pr-8"
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                                    分
                                  </span>
                                </div>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() =>
                          setAutoKnowledgeQuotaOpen((prev) => !prev)
                        }
                        aria-expanded={autoKnowledgeQuotaOpen}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            技能知识点配额
                            <Badge variant="outline" className="font-normal">
                              高级
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            先确定题型数量，再把这批题分配到知识点；配额合计必须等于当前计划的{" "}
                            {knowledgeQuotaTargetCount || 0} 题。
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-2">
                          {isKnowledgeAllocationMode ? (
                            <Badge
                              variant={
                                hasKnowledgeAllocationMismatch
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              合计 {requestedKnowledgeQuestionCount} 题
                            </Badge>
                          ) : null}
                          <ChevronDown
                            size={16}
                            className={cn(
                              "text-muted-foreground transition-transform",
                              autoKnowledgeQuotaOpen && "rotate-180",
                            )}
                          />
                        </span>
                      </button>

                      {!autoKnowledgeQuotaOpen &&
                      availableKnowledgePoints.length > 0 ? (
                        <span
                          className={cn(
                            "flex items-center gap-1 text-xs font-medium",
                            knowledgeCoverageMet
                              ? "text-emerald-600"
                              : "text-amber-600",
                          )}
                        >
                          {knowledgeCoverageMet ? (
                            <CheckCircle2 size={12} />
                          ) : (
                            <CircleAlert size={12} />
                          )}
                          {isKnowledgeAllocationMode ? "已" : "将自动"}覆盖{" "}
                          {knowledgeCoverageCovered}/{knowledgeCoverageTotal}{" "}
                          个知识点（{knowledgeCoveragePercent}%）
                        </span>
                      ) : null}

                      {autoKnowledgeQuotaOpen ? (
                        <>
                          {availableKnowledgePoints.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={applyEvenKnowledgeCoverage}
                                disabled={knowledgePointQuery.isLoading}
                              >
                                <Wand2 size={14} className="mr-1" />
                                按章节均匀覆盖
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                依据当前计划的{" "}
                                {knowledgeQuotaTargetCount || 0}{" "}
                                题在各知识点均匀分布。
                              </span>
                              {hasKnowledgeAllocationMismatch ? (
                                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                                  <CircleAlert size={12} />
                                  配额合计需等于 {knowledgeQuotaTargetCount} 题
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {knowledgePointQuery.isLoading ? (
                            <div className="text-sm text-muted-foreground">
                              知识点加载中...
                            </div>
                          ) : availableKnowledgePoints.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              当前题库与难度条件下暂无可用于自动出题的知识点。
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {availableKnowledgePoints.map(
                                (knowledgePoint) => {
                                  const allocation = autoAllocationMap.get(
                                    knowledgePoint.id,
                                  );
                                  const shortage = allocation
                                    ? allocation.count >
                                      knowledgePoint.availableCount
                                    : false;

                                  return (
                                    <div
                                      key={knowledgePoint.id}
                                      className={cn(
                                        "grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_120px]",
                                        allocation
                                          ? "border-primary/40 bg-background"
                                          : "border-border bg-background/70",
                                      )}
                                    >
                                      <label className="flex items-start gap-3">
                                        <Checkbox
                                          checked={Boolean(allocation)}
                                          onCheckedChange={(value) =>
                                            handleKnowledgeAllocationToggle(
                                              knowledgePoint.id,
                                              value === true,
                                            )
                                          }
                                        />
                                        <span className="min-w-0">
                                          <span className="block text-sm font-medium text-foreground">
                                            {knowledgePoint.name}
                                          </span>
                                          <span className="mt-1 block text-xs text-muted-foreground">
                                            当前可用{" "}
                                            {knowledgePoint.availableCount} 题
                                          </span>
                                          {shortage ? (
                                            <span className="mt-1 flex items-center gap-1 text-xs text-destructive">
                                              <CircleAlert size={12} />
                                              数量不足，最多可选{" "}
                                              {knowledgePoint.availableCount} 题
                                            </span>
                                          ) : null}
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
                                        onChange={(event) =>
                                          handleKnowledgeAllocationCountChange(
                                            knowledgePoint.id,
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          生成题单
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            已选 {questionIds.length} 题
                            {autoGeneratedMeta ? (
                              <span className="ml-2">
                                · 最近生成 {autoGeneratedMeta.count} 题 /{" "}
                                {autoGeneratedMeta.totalScore} 分
                              </span>
                            ) : null}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          按题型计划生成题目；若设置了知识点配额，会在这批题内按配额抽题，并覆盖当前已选题目。
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={handleAutoGenerate}
                        disabled={
                          autoCandidatesLoading ||
                          knowledgePointQuery.isLoading ||
                          (isTypeAllocationMode
                            ? hasTypeAllocationShortage ||
                              hasKnowledgeAllocationShortage ||
                              hasKnowledgeAllocationMismatch
                            : isKnowledgeAllocationMode
                              ? requestedKnowledgeQuestionCount <= 0 ||
                                hasKnowledgeAllocationShortage
                              : autoQuestionCount <= 0)
                        }
                      >
                        {autoCandidatesLoading ? (
                          <Loader2 size={16} className="mr-1 animate-spin" />
                        ) : (
                          <Sparkles size={16} className="mr-1" />
                        )}
                        {autoGeneratedMeta ? "重新生成" : "生成题单"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <AIQuestionConfigPanel
                      title="AI出题设置"
                      fetcher={apiRequest}
                      storageKey="practice-ai-generate-recent-keywords"
                      totalCount={aiQuestionCount}
                      onTotalCountChange={setAIQuestionCount}
                      difficulty={aiDifficulty}
                      onDifficultyChange={setAIDifficulty}
                      typeAlloc={aiTypeAlloc}
                      onTypeAllocChange={setAITypeAlloc}
                      model={aiModel}
                      onModelChange={setAIModel}
                      selectedKnowledgePoints={selectedKnowledgePoints}
                      onSelectedKnowledgePointsChange={
                        setSelectedKnowledgePoints
                      }
                      filterRootNodeId={mainKnowledgePoint?.id}
                      customPrompt={aiPrompt}
                      onCustomPromptChange={setAIPrompt}
                      allocationError={aiAllocationError}
                      footer={
                        !aiGenerating ? (
                          <Button
                            type="button"
                            className="w-full"
                            onClick={() => void handleAIGenerate()}
                            disabled={aiApplying || Boolean(aiAllocationError)}
                          >
                            <Sparkles size={16} className="mr-1" />
                            开始生成
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="destructive"
                            className="w-full"
                            onClick={stopAIGeneration}
                          >
                            <StopCircle size={16} className="mr-1" />
                            停止生成
                          </Button>
                        )
                      }
                    />

                    <div className="relative min-h-[520px] rounded-xl border border-border/80 bg-background">
                      {aiQuestions.length === 0 && !aiGenerating ? (
                        <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
                          <Sparkles size={40} className="opacity-50" />
                          <p className="text-sm">配置参数后点击开始生成</p>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col">
                          <div className="flex items-center justify-between gap-3 px-4 py-3">
                            <div className="text-sm font-semibold text-foreground">
                              生成结果
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                已自动加入{" "}
                                {
                                  aiQuestions.filter(
                                    (question) => question.persistedQuestionId,
                                  ).length
                                }{" "}
                                道
                              </span>
                            </div>
                            {aiApplying ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" />
                                正在自动加入...
                              </div>
                            ) : null}
                          </div>
                          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                            {aiQuestions.map((question) => (
                              <AIGeneratedQuestionCard
                                key={question.index}
                                question={question}
                                onRemove={() =>
                                  removeAIQuestion(question.index)
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {aiGenerating && (
                        <AIGenerateLoadingOverlay
                          generatedCount={aiQuestions.length}
                        />
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {currentStepId === "students" && (
            <Card>
              <CardHeader>
                <CardTitle>步骤 3：选择班级 / 学生</CardTitle>
              </CardHeader>
              <CardContent>
                <ClassStudentSelector
                  selectedIds={studentIds}
                  onChange={setStudentIds}
                  summaryLabel="人"
                  emptySummaryText="还没有选择发布对象，可以优先按班级选择，导入和手动添加作为补充方式。"
                />
                <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      公开链接
                    </p>
                    <p className="text-xs text-muted-foreground">
                      开启后，发布成功会生成一个公开链接。外部考生填写姓名和手机号后进入。
                    </p>
                  </div>
                  <Switch
                    checked={publicLinkEnabled}
                    onCheckedChange={setPublicLinkEnabled}
                    aria-label="开启公开链接"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {currentStepId === "publish" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>步骤 4：发布设置</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScoreDialogOpen(true)}
                >
                  预览与设置分数
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="practice-duration">练习时长</Label>
                    <div className="relative">
                      <Input
                        id="practice-duration"
                        type="number"
                        min={1}
                        value={durationMinutes}
                        onChange={(event) =>
                          setDurationMinutes(
                            parseInt(event.target.value, 10) || 0,
                          )
                        }
                        className="pr-12"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        分钟
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>结束时间</Label>
                    <DatePicker
                      value={toPickerDate(endTime)}
                      onChange={(date) =>
                        updatePracticeEndTime(toLocalDateTimeValue(date))
                      }
                      includeTime
                      placeholder="不设置则按发布后长期有效"
                      className="h-9 w-full"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      发布后立即开始
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      关闭后可设置未来的开始时间。
                    </p>
                  </div>
                  <Switch
                    checked={startImmediately}
                    onCheckedChange={updateStartImmediately}
                  />
                </div>

                {!startImmediately && (
                  <div className="space-y-1.5">
                    <Label>开始时间</Label>
                    <DatePicker
                      value={toPickerDate(scheduledStartTime)}
                      onChange={(date) =>
                        updatePracticeStartTime(toLocalDateTimeValue(date))
                      }
                      includeTime
                      placeholder="开始时间"
                      className="h-9 w-full"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      允许学生查看结果
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      开启后，学生提交后可以直接看到练习结果。
                    </p>
                  </div>
                  <Switch
                    checked={showResult}
                    onCheckedChange={setShowResult}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      允许学生重做
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      开启后，学生提交后可以再次开始作答。
                    </p>
                  </div>
                  <Switch
                    checked={allowRetake}
                    onCheckedChange={setAllowRetake}
                  />
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
              {currentStep < stepItems.length - 1 ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={goNext}
                >
                  下一步
                  <ArrowRight size={16} className="ml-1" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleSubmit}
                  disabled={
                    Boolean(submitValidation) ||
                    mutation.isPending ||
                    updateMutation.isPending
                  }
                >
                  {mutation.isPending || updateMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {isEditMode ? "保存中..." : "发布中..."}
                    </span>
                  ) : isEditMode ? (
                    "保存修改"
                  ) : (
                    "发布练习"
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                摘要
                <Badge variant="outline" className={practiceBadgeClass}>
                  练习
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">练习名称</p>
                <p className="text-sm font-semibold text-foreground">
                  {title.trim() || "未填写"}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">知识点</span>
                <span className="font-medium text-foreground">
                  {selectedKnowledgePoints.length} 个
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">题目</span>
                <span className="font-medium text-foreground">
                  {questionIds.length} 题
                </span>
              </div>
              {showQuestionStepPreviewButton ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-center text-xs"
                  onClick={() => setScoreDialogOpen(true)}
                >
                  <BookCopy size={14} className="mr-1.5" />
                  预览
                </Button>
              ) : null}
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">学生</span>
                <span className="font-medium text-foreground">
                  {studentIds.length} 人
                </span>
              </div>
              <button
                type="button"
                className="group flex w-full items-center justify-between gap-3 rounded-md text-left text-sm outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                title="点击设置练习分数"
                onClick={() => setScoreDialogOpen(true)}
              >
                <span className="text-muted-foreground">总分</span>
                <span className="font-medium text-foreground transition-colors group-hover:text-primary">
                  {totalScore} 分
                  <span className="ml-2 hidden text-xs font-normal text-primary group-hover:inline">
                    可设置
                  </span>
                </span>
              </button>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">时长</span>
                <span className="font-medium text-foreground">
                  {durationMinutes} 分钟
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">开始方式</span>
                <span className="font-medium text-foreground">
                  {startImmediately ? "立即开始" : "定时开始"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={questionMode === "manual" ? "secondary" : "outline"}
                >
                  {questionMode === "manual"
                    ? "手动选题"
                    : questionMode === "auto"
                      ? "自动出题"
                      : "AI出题"}
                </Badge>
                <Badge variant="outline">练习</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
