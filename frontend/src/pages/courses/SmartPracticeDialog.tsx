import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getPublishedExamStatus } from "@/pages/exams/components/exam-form-utils";
import {
  ClassStudentSelector,
  type StudentSemesterOption,
} from "@/pages/exams/components/ClassStudentSelector";
import type { IQuestion, QuestionDisplayType } from "@/types";
import {
  getQuestionDisplayType,
  questionDisplayTypeFullLabel,
} from "@/components/questions/question-preview-utils";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";

import { listCourseQuestions } from "./api";
import type { CourseKnowledgeNode } from "./api";
import { KnowledgeFilterTreeMenu } from "./knowledge-filter-tree-menu";
import {
  ALL_DIFFICULTIES,
  SMART_PRACTICE_WHOLE_COURSE_ID,
  collectKnowledgeScopeIds,
  parseSmartPracticePrompt,
  selectSmartPracticeQuestions,
  type SmartPracticeChapterTarget,
  type SmartPracticeSlotTrace,
  type SmartPracticeIntent,
  type SmartPracticeTypeKey,
  type SmartPracticeTypeTarget,
  type SmartPracticeKnowledgeOption,
} from "./smart-practice-utils";

type CreationMode = "conditions" | "ratio" | "prompt";
type RatioBase = "chapter" | "type";
type RatioChapterGroup = {
  chapterId: string;
  typeCounts: Record<string, number>;
};
type RatioTypeGroup = {
  type: string;
  chapters: Array<{ chapterId: string; count: number }>;
};
type DialogStage = "configure" | "preview";

const DIFFICULTY_OPTIONS = [
  { value: ALL_DIFFICULTIES, label: "综合" },
  { value: 1, label: "容易" },
  { value: 2, label: "较易" },
  { value: 3, label: "中等" },
  { value: 4, label: "较难" },
  { value: 5, label: "很难" },
];

const COUNT_PRESETS = ["10", "15", "20", "25", "30", "40", "50"] as const;

/** 题型配比表单里的题型；单选/多选在数据模型里同属 choice，这里分开计数。 */
const TYPE_RATIO_FIELDS: Array<{ key: string; label: string }> = [
  { key: "single_choice", label: "单选" },
  { key: "multi_choice", label: "多选" },
  { key: "true_false", label: "判断" },
  { key: "fill_in", label: "填空" },
  { key: "short_answer", label: "简答" },
];

function KnowledgePicker({
  id,
  tree,
  options,
  selectedId,
  onSelect,
  className,
}: {
  id: string;
  tree: CourseKnowledgeNode | null;
  options: SmartPracticeKnowledgeOption[];
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === selectedId);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={`知识点：${selected?.name ?? "全部知识点"}`}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring",
            className,
          )}
        >
          <span className="truncate">{selected?.name ?? "全部知识点"}</span>
          <ChevronDown size={16} className="shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px] p-1">
        <KnowledgeFilterTreeMenu
          tree={tree}
          options={options}
          selectedId={selectedId}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 「本节巩固」里展示的题型顺序与短名。 */
const DISPLAY_TYPE_ORDER: Array<[QuestionDisplayType, string]> = [
  ["single_choice", "单选"],
  ["multi_choice", "多选"],
  ["true_false", "判断"],
  ["fill_in", "填空"],
  ["short_answer", "简答"],
  ["essay", "论述"],
  ["code", "编程"],
];

/** 配比里的题型 key 既可能是 single_choice/multi_choice，也可能是 choice 等。 */
function typeLabel(type: string): string {
  return (
    questionDisplayTypeFullLabel[type as keyof typeof questionDisplayTypeFullLabel] ??
    TYPE_LABELS[type] ??
    type
  );
}

const TYPE_LABELS: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

function defaultDialogTitle(
  courseName: string,
  target: "practice" | "paper",
): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${courseName}-${month}${day}${target === "paper" ? "试卷" : "练习"}`;
}

function getPromptTemplate(
  courseName: string,
  knowledgeName: string | null,
  count = 10,
  difficulty = "容易",
  noun = "练习",
) {
  const scope = knowledgeName ? `，围绕“${knowledgeName}”` : "";
  return `请从“${courseName}”题库中选取${count}道${difficulty}题${scope}生成一份${noun}。`;
}

export interface SmartPracticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** dialog：弹窗（默认）；page：独立页面（/courses/:id/papers/smart）。 */
  variant?: "dialog" | "page";
  /** page 变体的「返回」动作。 */
  onExit?: () => void;
  /** page 变体顶部固定的面包屑（由调用方提供，便于复用路由信息）。 */
  breadcrumb?: ReactNode;
  /** practice：创建练习；paper：创建试卷（预览时可改每题分值）。 */
  target?: "practice" | "paper";
  courseId: string;
  courseName: string;
  courseKpId: string;
  courseSemesterId: string | null;
  defaultClassIds?: string[];
  /** 本课程的学期列表；传入后可选学期一键选中该学期关联班级的学生。 */
  semesterOptions?: StudentSemesterOption[];
  selectedQuestionIds: string[];
  knowledgeOptions: SmartPracticeKnowledgeOption[];
  /** 课程知识点树：用于把知识点下拉展示成树状结构。 */
  knowledgeTree?: CourseKnowledgeNode | null;
  initialKnowledgePointId?: string | null;
  onPublished?: (examId: string) => void | Promise<void>;
  /** target="paper" 创建成功后的回调（试卷 id）。 */
  onPaperCreated?: (paperId: string) => void | Promise<void>;
}

export function SmartPracticeDialog({
  open,
  onOpenChange,
  variant = "dialog",
  onExit,
  breadcrumb,
  target = "practice",
  courseId,
  courseName,
  courseKpId,
  courseSemesterId,
  defaultClassIds,
  semesterOptions,
  selectedQuestionIds,
  knowledgeOptions,
  knowledgeTree = null,
  initialKnowledgePointId = null,
  onPublished,
  onPaperCreated,
}: SmartPracticeDialogProps) {
  const isPage = variant === "page";
  const { toast } = useToast();
  const [stage, setStage] = useState<DialogStage>("configure");
  const [mode, setMode] = useState<CreationMode>("ratio");
  const [sourceQuestions, setSourceQuestions] = useState<IQuestion[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [countPreset, setCountPreset] = useState("10");
  const [customCount, setCustomCount] = useState(10);
  const [difficulty, setDifficulty] = useState(ALL_DIFFICULTIES);
  const [knowledgePointId, setKnowledgePointId] = useState<string | null>(
    initialKnowledgePointId,
  );
  const [typeRatioOpen, setTypeRatioOpen] = useState(false);
  const [strengthenOpen, setStrengthenOpen] = useState(false);
  const [ratioBase, setRatioBase] = useState<RatioBase>("chapter");
  const [ratioChapterGroups, setRatioChapterGroups] = useState<RatioChapterGroup[]>([]);
  const [ratioTypeGroups, setRatioTypeGroups] = useState<RatioTypeGroup[]>([]);
  const [typeRatioCounts, setTypeRatioCounts] = useState<Record<string, number>>(
    { single_choice: 10, multi_choice: 5, true_false: 10, fill_in: 10, short_answer: 5 },
  );
  const [typeRatioDifficulty, setTypeRatioDifficulty] = useState(ALL_DIFFICULTIES);
  const [prompt, setPrompt] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState<IQuestion[]>([]);
  // 创建试卷时，预览阶段允许逐题改分值。
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>(
    {},
  );
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
  // 预览题数少于设置题数时，需要老师显式确认后才允许发布，避免悄悄少发题。
  const [requestedPreviewCount, setRequestedPreviewCount] = useState(0);
  /** 每个「章节 × 题型」设置了多少、实际选到多少，用于预览页对照。 */
  const [previewSlotTrace, setPreviewSlotTrace] = useState<SmartPracticeSlotTrace[]>([]);
  /** 预览页左侧树选中的「章节|题型」；null 表示全部。 */
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [shortfallAccepted, setShortfallAccepted] = useState(false);
  const [variation, setVariation] = useState(0);
  const [title, setTitle] = useState(() => defaultDialogTitle(courseName, "practice"));
  const [studentIds, setStudentIds] = useState<string[]>([]);
  // 「按学期选择」里点中的学期；没点过就沿用课程默认学期。
  const [semesterOverride, setSemesterOverride] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const selectedKnowledge = knowledgeOptions.find(
    (option) => option.id === knowledgePointId,
  );
  const requestedCount = countPreset === "custom" ? customCount : Number(countPreset);
  const includedQuestions = previewQuestions.filter((question) =>
    includedIds.has(question.id),
  );
  const selectedQuestionIdKey = selectedQuestionIds.join(",");
  const sourceLabel =
    selectedQuestionIds.length > 0
      ? `已选 ${sourceQuestions.length} 题`
      : `课程全部 ${sourceQuestions.length} 题`;

  useEffect(() => {
    if (!open) return;
    setStage("configure");
    setMode("ratio");
    setCountPreset("10");
    setCustomCount(10);
    setDifficulty(ALL_DIFFICULTIES);
    setKnowledgePointId(initialKnowledgePointId);
    setTypeRatioOpen(false);
    setStrengthenOpen(false);
    setTypeRatioCounts({
      single_choice: 10,
      multi_choice: 5,
      true_false: 10,
      fill_in: 10,
      short_answer: 5,
    });
    setTypeRatioDifficulty(ALL_DIFFICULTIES);
    setPrompt("");
    setPreviewQuestions([]);
    setIncludedIds(new Set());
    setRequestedPreviewCount(0);
    setShortfallAccepted(false);
    setVariation(0);
    setTitle(defaultDialogTitle(courseName, target));
    setStudentIds([]);
    setSourceError(null);

    let active = true;
    setSourceLoading(true);
    void listCourseQuestions(courseId)
      .then((questions) => {
        if (!active) return;
        const selectedIdsFromKey = selectedQuestionIdKey
          ? selectedQuestionIdKey.split(",")
          : [];
        if (selectedIdsFromKey.length === 0) {
          setSourceQuestions(questions);
          return;
        }
        const selectedIds = new Set(selectedIdsFromKey);
        setSourceQuestions(
          questions.filter((question) => selectedIds.has(question.id)),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSourceQuestions([]);
        setSourceError(error instanceof Error ? error.message : "题目加载失败");
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    courseId,
    courseName,
    initialKnowledgePointId,
    open,
    selectedQuestionIdKey,
  ]);

  // 「按配比」页签：章节取课程知识树的一级节点（没有树时退回知识点列表），
  // 额外提供「整个课程」用于整门课按题型配比。
  const ratioChapterRows = useMemo(() => {
    const chapters = knowledgeTree?.children?.length
      ? knowledgeTree.children.map((node) => ({
          id: node.id,
          name: node.name,
        }))
      : knowledgeOptions.map((option) => ({
          id: option.id,
          name: option.name,
        }));
    return [
      { id: SMART_PRACTICE_WHOLE_COURSE_ID, name: "整个课程" },
      ...chapters,
    ];
  }, [knowledgeOptions, knowledgeTree]);

  // 「整个课程」的取题范围：知识树全部节点（根 + 子节点）。
  const wholeCourseScopeIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (node: CourseKnowledgeNode) => {
      ids.push(node.id);
      node.children.forEach(walk);
    };
    if (knowledgeTree) walk(knowledgeTree);
    if (ids.length === 0) {
      return knowledgeOptions.map((option) => option.id);
    }
    return ids;
  }, [knowledgeOptions, knowledgeTree]);

  const resolveChapterScopeIds = (chapterId: string) =>
    chapterId === SMART_PRACTICE_WHOLE_COURSE_ID
      ? wholeCourseScopeIds
      : collectKnowledgeScopeIds(chapterId, knowledgeOptions);

  const defaultRatioChapterId =
    ratioChapterRows.find(
      (row) => row.id !== SMART_PRACTICE_WHOLE_COURSE_ID,
    )?.id ?? SMART_PRACTICE_WHOLE_COURSE_ID;

  // 「按配比」里每个章节按题型可用的题量，避免把数量设得超过题库。
  const chapterAvailability = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of ratioChapterRows) {
      const scope = new Set(
        row.id === SMART_PRACTICE_WHOLE_COURSE_ID
          ? wholeCourseScopeIds
          : collectKnowledgeScopeIds(row.id, knowledgeOptions),
      );
      const counts: Record<string, number> = {};
      for (const question of sourceQuestions) {
        if (
          !question.knowledge_points.some((point) => scope.has(point.id))
        ) {
          continue;
        }
        const type = getQuestionDisplayType(question) ?? question.type;
        counts[type] = (counts[type] ?? 0) + 1;
      }
      map.set(row.id, counts);
    }
    return map;
  }, [
    ratioChapterRows,
    sourceQuestions,
    wholeCourseScopeIds,
    knowledgeOptions,
  ]);

  const ratioTypeRows = useMemo(() => {
    const available = new Map<QuestionDisplayType, number>();
    for (const question of sourceQuestions) {
      const displayType = getQuestionDisplayType(question);
      if (!displayType) continue;
      available.set(displayType, (available.get(displayType) ?? 0) + 1);
    }
    const rows = DISPLAY_TYPE_ORDER.filter(
      ([type]) => (available.get(type) ?? 0) > 0,
    );
    return rows.length > 0 ? rows : DISPLAY_TYPE_ORDER.slice(0, 5);
  }, [sourceQuestions]);

  // 「按配比」页签：按章节（章节题量再拆到题型）或按题型（题型题量再拆到章节），
  // 每组都是显式题量，老师能精确控制。
  useEffect(() => {
    if (!open || sourceQuestions.length === 0) return;
    if (ratioChapterRows.length === 0 || ratioTypeRows.length === 0) return;
    if (ratioBase === "chapter" && ratioChapterGroups.length === 0) {
      setRatioChapterGroups([
        {
          chapterId: defaultRatioChapterId,
          typeCounts: { [ratioTypeRows[0][0]]: 10 },
        },
      ]);
    }
    if (ratioBase === "type" && ratioTypeGroups.length === 0) {
      setRatioTypeGroups([
        {
          type: ratioTypeRows[0][0],
          chapters: [{ chapterId: defaultRatioChapterId, count: 10 }],
        },
      ]);
    }
  }, [
    open,
    sourceQuestions.length,
    ratioBase,
    ratioChapterRows,
    ratioTypeRows,
    ratioChapterGroups.length,
    ratioTypeGroups.length,
  ]);

  const chapterGroupTotal = (group: RatioChapterGroup) =>
    Object.values(group.typeCounts).reduce(
      (total, count) => total + Math.max(0, count || 0),
      0,
    );
  const typeGroupTotal = (group: RatioTypeGroup) =>
    group.chapters.reduce(
      (total, chapter) => total + Math.max(0, chapter.count || 0),
      0,
    );
  const ratioTotal =
    ratioBase === "chapter"
      ? ratioChapterGroups.reduce(
          (total, group) => total + chapterGroupTotal(group),
          0,
        )
      : ratioTypeGroups.reduce(
          (total, group) => total + typeGroupTotal(group),
          0,
        );

  // 把「按配比」页签的配置转成取题意图（显式题量，不再按百分比换算）。
  const buildRatioIntent = (): SmartPracticeIntent => {
    if (ratioBase === "chapter") {
      const chapters: SmartPracticeChapterTarget[] = ratioChapterGroups
        .map((group) => ({
          knowledgePointId: group.chapterId,
          scopeIds: resolveChapterScopeIds(group.chapterId),
          typeCounts: Object.fromEntries(
            Object.entries(group.typeCounts)
              .map(
                ([type, count]) =>
                  [type, Math.max(0, Math.floor(count || 0))] as const,
              )
              .filter(([, count]) => count > 0),
          ),
        }))
        .filter((chapter) => Object.keys(chapter.typeCounts ?? {}).length > 0);
      return {
        count: chapters.reduce(
          (total, chapter) =>
            total +
            Object.values(chapter.typeCounts ?? {}).reduce(
              (sum, count) => sum + (count ?? 0),
              0,
            ),
          0,
        ),
        // 「按配比」页签没有难度选项，不能悄悄沿用「按条件」里的难度筛选。
        difficulty: ALL_DIFFICULTIES,
        knowledgePointId: null,
        searchTerms: [],
        chapters,
      };
    }
    const typeGroups: SmartPracticeTypeTarget[] = ratioTypeGroups
      .map((group) => ({
        type: group.type as SmartPracticeTypeKey,
        chapterCounts: group.chapters
          .filter((chapter) => chapter.count > 0)
          .map((chapter) => ({
            knowledgePointId: chapter.chapterId,
            scopeIds: resolveChapterScopeIds(chapter.chapterId),
            count: Math.max(0, Math.floor(chapter.count)),
          })),
      }))
      .filter((group) => group.chapterCounts.length > 0);
    return {
      count: typeGroups.reduce(
        (total, group) =>
          total +
          group.chapterCounts.reduce((sum, chapter) => sum + chapter.count, 0),
        0,
      ),
      difficulty: ALL_DIFFICULTIES,
      knowledgePointId: null,
      searchTerms: [],
      typeGroups,
    };
  };

  // 「提示词」页签里的配比模版：把上面的配置转成一段可解析的提示词。
  const buildRatioPrompt = () => {
    if (ratioBase === "chapter") {
      const parts = ratioChapterGroups
        .map((group) => {
          const chapter = ratioChapterRows.find(
            (row) => row.id === group.chapterId,
          );
          const total = chapterGroupTotal(group);
          if (!chapter || total === 0) return null;
          const types = ratioTypeRows
            .filter(([type]) => (group.typeCounts[type] ?? 0) > 0)
            .map(([type, label]) => `${label}题${group.typeCounts[type]}道`);
          return types.length > 0
            ? `${chapter.name}${total}道（${types.join("、")}）`
            : `${chapter.name}${total}道`;
        })
        .filter(Boolean);
      return `请从“${courseName}”题库中按章节分配：${parts.join("；")}。`;
    }
    const parts = ratioTypeGroups
      .map((group) => {
        const label =
          DISPLAY_TYPE_ORDER.find(([type]) => type === group.type)?.[1] ??
          "选择";
        const total = typeGroupTotal(group);
        if (total === 0) return null;
        const chapters = group.chapters
          .filter((chapter) => chapter.count > 0)
          .map((chapter) => {
            const row = ratioChapterRows.find(
              (item) => item.id === chapter.chapterId,
            );
            return `${row?.name ?? ""}${chapter.count}道`;
          });
        return chapters.length > 0
          ? `${label}题${total}道（${chapters.join("、")}）`
          : `${label}题${total}道`;
      })
      .filter(Boolean);
    return `请从“${courseName}”题库中按题型分配：${parts.join("；")}。`;
  };

  const promptTemplates = useMemo(
    () => [
      {
        label: "10 道容易题",
        value: getPromptTemplate(
          courseName,
          selectedKnowledge?.name ?? null,
          10,
          "容易",
          target === "paper" ? "试卷" : "练习",
        ),
      },
      {
        label: "20 道综合题",
        value: getPromptTemplate(
          courseName,
          selectedKnowledge?.name ?? null,
          20,
          "综合难度",
          target === "paper" ? "试卷" : "练习",
        ),
      },
    ],
    [courseName, selectedKnowledge?.name, target],
  );

  // 「本节巩固」弹层里的题型可用量：按所选知识点（含子节点）统计。
  const sectionTypeCounts = useMemo(() => {
    if (!knowledgePointId) return null;
    const scope = new Set(
      collectKnowledgeScopeIds(knowledgePointId, knowledgeOptions),
    );
    const counts = new Map<QuestionDisplayType, number>();
    for (const question of sourceQuestions) {
      if (!question.knowledge_points.some((point) => scope.has(point.id))) {
        continue;
      }
      const displayType = getQuestionDisplayType(question);
      if (!displayType) continue;
      counts.set(displayType, (counts.get(displayType) ?? 0) + 1);
    }
    return counts;
  }, [knowledgeOptions, knowledgePointId, sourceQuestions]);

  const sectionQuestionTotal = sectionTypeCounts
    ? [...sectionTypeCounts.values()].reduce((sum, count) => sum + count, 0)
    : 0;

  const applyStrengthenPrompt = () => {
    if (!knowledgePointId) return;
    setPrompt(
      `请从“${courseName}”题库中选取10道题，围绕本节“${selectedKnowledge?.name ?? ""}”生成一份巩固${target === "paper" ? "试卷" : "练习"}，基础与应用题兼顾。`,
    );
    setStrengthenOpen(false);
  };

  const applyTypeRatio = () => {
    const parts = TYPE_RATIO_FIELDS.map(({ key, label }) => ({
      label,
      count: Math.max(0, Math.min(200, Math.floor(typeRatioCounts[key] ?? 0))),
    })).filter((item) => item.count > 0);
    if (parts.length === 0) {
      toast({ title: "请至少设置一种题型的数量", variant: "destructive" });
      return;
    }
    const difficultyText =
      typeRatioDifficulty === ALL_DIFFICULTIES
        ? "综合难度"
        : `难度${DIFFICULTY_OPTIONS.find((option) => option.value === typeRatioDifficulty)?.label ?? "中等"}`;
    const scope = selectedKnowledge?.name
      ? `围绕“${selectedKnowledge.name}”`
      : "";
    setPrompt(
      `请从“${courseName}”题库中${scope}选取${parts
        .map((item) => `${item.label}题${item.count}道`)
        .join("、")}，${difficultyText}。`,
    );
    setTypeRatioOpen(false);
    setStrengthenOpen(false);
  };

  const generatePreview = (nextVariation = variation) => {
    const baseIntent = {
      count: Math.max(1, Math.min(200, requestedCount || 1)),
      difficulty,
      knowledgePointId,
    };
    const rawIntent =
      mode === "prompt"
        ? parseSmartPracticePrompt(prompt, knowledgeOptions, baseIntent)
        : mode === "ratio"
          ? buildRatioIntent()
          : { ...baseIntent, searchTerms: [] };
    // 提示词里写的「整个课程」需要展开成整棵课程树的节点。
    const intent: SmartPracticeIntent = {
      ...rawIntent,
      chapters: rawIntent.chapters?.map((chapter) => ({
        ...chapter,
        scopeIds:
          chapter.scopeIds && chapter.scopeIds.length > 0
            ? chapter.scopeIds
            : resolveChapterScopeIds(chapter.knowledgePointId),
      })),
      typeGroups: rawIntent.typeGroups?.map((group) => ({
        ...group,
        chapterCounts: group.chapterCounts.map((chapter) => ({
          ...chapter,
          scopeIds:
            chapter.scopeIds && chapter.scopeIds.length > 0
              ? chapter.scopeIds
              : resolveChapterScopeIds(chapter.knowledgePointId),
        })),
      })),
    };
    // 选中「物理层」这类上级知识点时，取题范围同时包含它下面的所有子知识点。
    const knowledgePointIds = collectKnowledgeScopeIds(
      intent.knowledgePointId,
      knowledgeOptions,
    );
    const slotTrace: SmartPracticeSlotTrace[] = [];
    const picked = selectSmartPracticeQuestions(
      sourceQuestions,
      { ...intent, knowledgePointIds },
      nextVariation,
      slotTrace,
    );
    setPreviewSlotTrace(slotTrace);
    setSlotFilter(null);
    setPreviewQuestions(picked);
    setIncludedIds(new Set(picked.map((question) => question.id)));
    setScoreOverrides(
      Object.fromEntries(
        picked.map((question) => [
          question.id,
          Number.isFinite(question.score) && question.score > 0
            ? question.score
            : 5,
        ]),
      ),
    );
    setRequestedPreviewCount(intent.count);
    setShortfallAccepted(false);
    setStage("preview");
  };

  const handleRegenerate = () => {
    const nextVariation = variation + 1;
    setVariation(nextVariation);
    generatePreview(nextVariation);
  };

  const toggleIncluded = (questionId: string) => {
    setIncludedIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const previewSlotRows = useMemo(() => {
    if (previewSlotTrace.length === 0) {
      return [];
    }
    const chapterName = (chapterId: string | null) => {
      if (!chapterId || chapterId === SMART_PRACTICE_WHOLE_COURSE_ID) {
        return "整个课程";
      }
      return (
        knowledgeOptions.find((option) => option.id === chapterId)?.name ??
        "未知章节"
      );
    };
    const merged = new Map<
      string,
      { chapter: string; type: string; requested: number; picked: number }
    >();
    for (const slot of previewSlotTrace) {
      const chapter = chapterName(slot.chapterId);
      const type = typeLabel(slot.type);
      const key = `${chapter}|${type}`;
      const row = merged.get(key) ?? { chapter, type, requested: 0, picked: 0 };
      row.requested += slot.requested;
      row.picked += slot.picked;
      merged.set(key, row);
    }
    return [...merged.values()];
  }, [previewSlotTrace, knowledgeOptions]);

  const previewSlotTree = useMemo(() => {
    if (previewSlotTrace.length === 0) {
      return [];
    }
    const chapterName = (chapterId: string | null) => {
      if (!chapterId || chapterId === SMART_PRACTICE_WHOLE_COURSE_ID) {
        return "整个课程";
      }
      return (
        knowledgeOptions.find((option) => option.id === chapterId)?.name ??
        "未知章节"
      );
    };
    const chapters = new Map<
      string,
      {
        id: string;
        label: string;
        requested: number;
        picked: number;
        types: Array<{
          key: string;
          label: string;
          requested: number;
          picked: number;
        }>;
      }
    >();
    for (const slot of previewSlotTrace) {
      const chapterId = slot.chapterId ?? "";
      const chapter = chapters.get(chapterId) ?? {
        id: chapterId,
        label: chapterName(slot.chapterId),
        requested: 0,
        picked: 0,
        types: [],
      };
      chapter.requested += slot.requested;
      chapter.picked += slot.picked;
      const key = `${chapterId}|${slot.type}`;
      const existing = chapter.types.find((item) => item.key === key);
      if (existing) {
        existing.requested += slot.requested;
        existing.picked += slot.picked;
      } else {
        chapter.types.push({
          key,
          label: typeLabel(slot.type),
          requested: slot.requested,
          picked: slot.picked,
        });
      }
      chapters.set(chapterId, chapter);
    }
    return [...chapters.values()];
  }, [previewSlotTrace, knowledgeOptions]);

  const slotFilteredIds = useMemo(() => {
    if (!slotFilter) {
      return null;
    }
    const ids = new Set<string>();
    for (const slot of previewSlotTrace) {
      if (`${slot.chapterId ?? ""}|${slot.type}` !== slotFilter) {
        continue;
      }
      for (const id of slot.questionIds ?? []) {
        ids.add(id);
      }
    }
    return ids;
  }, [slotFilter, previewSlotTrace]);

  const previewShortfall =
    requestedPreviewCount > 0 &&
    previewQuestions.length < requestedPreviewCount;
  const paperTotalScore = includedQuestions.reduce(
    (sum, question) =>
      sum + (scoreOverrides[question.id] ?? question.score ?? 0),
    0,
  );

  const handlePublishPaper = async () => {
    if (includedQuestions.length === 0 || publishing) return;
    if (!title.trim()) {
      toast({ title: "请填写试卷名称", variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      const response = await apiClient.post<{ id: string }>("/api/papers", {
        title: title.trim(),
        description: null,
        source_type: "manual",
        root_knowledge_point_id: courseKpId,
        question_items: includedQuestions.map((question, index) => ({
          question_id: question.id,
          order: index,
          score_override:
            scoreOverrides[question.id] ?? question.score ?? null,
        })),
      });
      toast({
        title: "试卷已创建",
        description: `${includedQuestions.length} 道题 · ${paperTotalScore} 分`,
      });
      onOpenChange(false);
      await onPaperCreated?.(response.data.id);
    } catch (error) {
      toast({
        title: "创建试卷失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  const handlePublish = async () => {
    if (target === "paper") {
      await handlePublishPaper();
      return;
    }
    if (includedQuestions.length === 0 || studentIds.length === 0 || publishing)
      return;

    setPublishing(true);
    try {
      const now = new Date();
      const endAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const totalScore = includedQuestions.reduce(
        (sum, question) => sum + (Number.isFinite(question.score) ? question.score : 0),
        0,
      );
      const response = await apiClient.post<{ id: string }>("/api/exams", {
        category: "practice",
        title: title.trim(),
        description: null,
        start_time: now.toISOString(),
        end_time: endAt.toISOString(),
        duration_minutes: 60,
        total_score: totalScore > 0 ? totalScore : 100,
        status: getPublishedExamStatus(
          { start_time: now.toISOString(), end_time: endAt.toISOString() },
          now,
        ),
        question_mode: mode === "prompt" ? "ai" : "auto",
        question_items: includedQuestions.map((question, index) => ({
          question_id: question.id,
          order: index,
          score_override: Number.isFinite(question.score) ? question.score : null,
        })),
        question_ids: includedQuestions.map((question) => question.id),
        student_ids: studentIds,
        course_kp_id: knowledgePointId ?? courseKpId,
        // 按学期选了学生就归档到该学期，否则用课程默认学期。
        course_semester_id: semesterOverride ?? courseSemesterId ?? undefined,
      });

      toast({ title: "练习已发布", description: `${includedQuestions.length} 道题 · 有效期 7 天` });
      onOpenChange(false);
      await onPublished?.(response.data.id);
    } catch (error) {
      toast({
        title: "发布失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  const canGenerate =
    !sourceLoading &&
    sourceQuestions.length > 0 &&
    (mode === "ratio"
      ? ratioTotal > 0
      : requestedCount > 0 &&
        (mode === "conditions" || prompt.trim().length > 0));
  const canPublish =
    title.trim().length > 0 &&
    includedQuestions.length > 0 &&
    (target === "paper" || studentIds.length > 0) &&
    (!previewShortfall || shortfallAccepted);

  const pageTopBar = isPage ? (
    <div className="flex flex-wrap items-center gap-3 bg-background/95 px-1 py-2">
      <div className="min-w-0">{breadcrumb}</div>
      {target === "paper" ? (
        <div className="flex min-w-0 flex-1 justify-center">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            aria-label="试卷名称"
            placeholder="试卷名称"
            className="h-8 max-w-xs"
          />
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onExit?.()}
          disabled={publishing}
        >
          返回
        </Button>
        {stage === "configure" ? (
          <Button
            type="button"
            size="sm"
            onClick={() => generatePreview()}
            disabled={!canGenerate}
          >
            <Sparkles data-icon="inline-start" />
            生成预览
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => void handlePublish()}
            disabled={!canPublish || publishing}
          >
            {publishing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {target === "paper" ? "创建试卷" : "确认发布 · 7 天"}
          </Button>
        )}
      </div>
    </div>
  ) : null;

  const content = (
    <>
      {pageTopBar}
        {stage === "configure" ? (
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as CreationMode)}
            className="flex min-h-0 flex-1 flex-col"
          >
              <DialogHeader
                className={cn(
                  isPage ? "px-0 py-2" : "border-b px-5 py-4 pr-12",
                )}
              >
                <div
                  className={cn(
                    "grid items-center gap-3",
                    isPage
                      ? "grid-cols-1"
                      : "grid-cols-[auto_1fr] sm:grid-cols-[1fr_auto_1fr]",
                  )}
                >
                  {isPage ? null : (
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Sparkles size={16} aria-hidden="true" />
                      智能创建{target === "paper" ? "试卷" : "练习"}
                    </DialogTitle>
                  )}
                  <TabsList
                    className={cn(
                      "grid w-52 grid-cols-3 sm:w-80",
                      isPage
                        ? "justify-self-start"
                        : "justify-self-end sm:justify-self-center",
                    )}
                  >
                    <TabsTrigger value="ratio">按配比</TabsTrigger>
                    <TabsTrigger value="prompt">提示词</TabsTrigger>
                    <TabsTrigger value="conditions">按条件</TabsTrigger>
                  </TabsList>
                  {isPage ? null : <span className="hidden sm:block" aria-hidden="true" />}
                </div>
                {isPage ? null : <DialogDescription>{sourceLabel}</DialogDescription>}
              </DialogHeader>

              <div
                className={cn(
                  "min-h-0 flex-1 px-5 py-4",
                  isPage ? "overflow-y-auto px-0" : "overflow-y-auto",
                )}
              >
                <div
                  data-testid="smart-practice-mode-content"
                  className={cn(
                    "min-h-0",
                    isPage
                      ? "min-h-[220px]"
                      : mode === "conditions"
                        ? "h-[268px] sm:h-[132px]"
                        : "h-[320px] sm:h-[220px]",
                  )}
                >
                  <TabsContent
                    value="conditions"
                    className="mt-0 h-full overflow-y-auto pt-1"
                  >
                    <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-practice-count">题目数量</Label>
                    <Select value={countPreset} onValueChange={setCountPreset}>
                      <SelectTrigger id="smart-practice-count">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {COUNT_PRESETS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value} 题
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">自定义</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {countPreset === "custom" ? (
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        aria-label="自定义题目数量"
                        value={customCount}
                        onChange={(event) => setCustomCount(Number(event.target.value))}
                      />
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-practice-knowledge">知识点</Label>
                    <KnowledgePicker
                      id="smart-practice-knowledge"
                      tree={knowledgeTree}
                      options={knowledgeOptions}
                      selectedId={knowledgePointId}
                      onSelect={setKnowledgePointId}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="smart-practice-difficulty">难度</Label>
                    <Select
                      value={String(difficulty)}
                      onValueChange={(value) => setDifficulty(Number(value))}
                    >
                      <SelectTrigger id="smart-practice-difficulty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {DIFFICULTY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={String(option.value)}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="ratio"
                    className="mt-0 h-full overflow-y-auto pt-1"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          分配方式
                        </span>
                        <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
                          <button
                            type="button"
                            onClick={() => setRatioBase("chapter")}
                            className={cn(
                              "rounded-md px-3 py-1 text-xs transition-colors",
                              ratioBase === "chapter"
                                ? "bg-background font-medium text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            按章节
                          </button>
                          <button
                            type="button"
                            onClick={() => setRatioBase("type")}
                            className={cn(
                              "rounded-md px-3 py-1 text-xs transition-colors",
                              ratioBase === "type"
                                ? "bg-background font-medium text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            按题型
                          </button>
                        </div>
                        <span className="ml-auto text-xs text-muted-foreground">
                          共 {ratioTotal} 题
                        </span>
                      </div>

                      {ratioBase === "chapter" ? (
                        <div className="space-y-2">
                          {ratioChapterGroups.map((group, index) => (
                            <div
                              key={`${group.chapterId}-${index}`}
                              className="rounded-lg border border-border/70 p-2"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={group.chapterId}
                                  onValueChange={(value) =>
                                    setRatioChapterGroups((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, chapterId: value }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8 w-40"
                                    aria-label="选择章节"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ratioChapterRows.map((row) => (
                                      <SelectItem key={row.id} value={row.id}>
                                        {row.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground">
                                  共 {chapterGroupTotal(group)} 题
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="ml-auto h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() =>
                                    setRatioChapterGroups((prev) =>
                                      prev.filter(
                                        (_item, itemIndex) =>
                                          itemIndex !== index,
                                      ),
                                    )
                                  }
                                >
                                  删除
                                </Button>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {ratioTypeRows.map(([type, label]) => (
                                  <label
                                    key={type}
                                    className="flex min-w-[104px] max-w-[200px] flex-1 items-center gap-1.5 text-xs text-muted-foreground"
                                  >
                                    <span className="min-w-0 truncate">
                                      {label}
                                    </span>
                                    <Input
                                      type="number"
                                      min={0}
                                      aria-label={`${label}题数量`}
                                      className="h-7 min-w-0 flex-1 text-right"
                                      value={group.typeCounts[type] ?? 0}
                                      onChange={(event) =>
                                        setRatioChapterGroups((prev) =>
                                          prev.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  typeCounts: {
                                                    ...item.typeCounts,
                                                    [type]: Number(
                                                      event.target.value,
                                                    ),
                                                  },
                                                }
                                              : item,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                本章可用：
                                {(() => {
                                  const counts =
                                    chapterAvailability.get(group.chapterId) ??
                                    {};
                                  const parts = ratioTypeRows
                                    .filter(([type]) => (counts[type] ?? 0) > 0)
                                    .map(
                                      ([type, label]) =>
                                        `${label} ${counts[type]}`,
                                    );
                                  return parts.length > 0
                                    ? parts.join(" · ")
                                    : "暂无题目";
                                })()}
                              </p>
                            </div>
                          ))}
                          {ratioChapterGroups.some(
                            (group) =>
                              group.chapterId ===
                              SMART_PRACTICE_WHOLE_COURSE_ID,
                          ) ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const used = new Set(
                                ratioChapterGroups.map(
                                  (group) => group.chapterId,
                                ),
                              );
                              const next = ratioChapterRows.find(
                                (row) =>
                                  row.id !== SMART_PRACTICE_WHOLE_COURSE_ID &&
                                  !used.has(row.id),
                              );
                              if (!next) {
                                toast({
                                  title: "章节已全部添加",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setRatioChapterGroups((prev) => [
                                ...prev,
                                { chapterId: next.id, typeCounts: {} },
                              ]);
                            }}
                          >
                            + 添加章节
                          </Button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {ratioTypeGroups.map((group, index) => (
                            <div
                              key={`${group.type}-${index}`}
                              className="rounded-lg border border-border/70 p-2"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={group.type}
                                  onValueChange={(value) =>
                                    setRatioTypeGroups((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, type: value }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8 w-32"
                                    aria-label="选择题型"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ratioTypeRows.map(([type, label]) => (
                                      <SelectItem key={type} value={type}>
                                        {label}题
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground">
                                  共 {typeGroupTotal(group)} 题
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="ml-auto h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() =>
                                    setRatioTypeGroups((prev) =>
                                      prev.filter(
                                        (_item, itemIndex) =>
                                          itemIndex !== index,
                                      ),
                                    )
                                  }
                                >
                                  删除
                                </Button>
                              </div>
                              <div className="mt-2 space-y-1.5">
                                {group.chapters.map(
                                  (chapterEntry, chapterIndex) => (
                                    <div
                                      key={`${chapterEntry.chapterId}-${chapterIndex}`}
                                      className="flex items-center gap-2"
                                    >
                                      <Select
                                        value={chapterEntry.chapterId}
                                        onValueChange={(value) =>
                                          setRatioTypeGroups((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    chapters: item.chapters.map(
                                                      (entry, entryIndex) =>
                                                        entryIndex ===
                                                        chapterIndex
                                                          ? {
                                                              ...entry,
                                                              chapterId: value,
                                                            }
                                                          : entry,
                                                    ),
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                      >
                                        <SelectTrigger
                                          className="h-8 w-40"
                                          aria-label="选择章节"
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {ratioChapterRows.map((row) => (
                                            <SelectItem
                                              key={row.id}
                                              value={row.id}
                                            >
                                              {row.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Input
                                        type="number"
                                        min={0}
                                        aria-label={`${
                                          ratioChapterRows.find(
                                            (row) =>
                                              row.id ===
                                              chapterEntry.chapterId,
                                          )?.name ?? "章节"
                                        }题数量`}
                                        className="h-8 w-20 text-right"
                                        value={chapterEntry.count}
                                        onChange={(event) =>
                                          setRatioTypeGroups((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    chapters: item.chapters.map(
                                                      (entry, entryIndex) =>
                                                        entryIndex ===
                                                        chapterIndex
                                                          ? {
                                                              ...entry,
                                                              count: Number(
                                                                event.target
                                                                  .value,
                                                              ),
                                                            }
                                                          : entry,
                                                    ),
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        题
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {(() => {
                                          const available =
                                            chapterAvailability.get(
                                              chapterEntry.chapterId,
                                            )?.[group.type] ?? 0;
                                          return available > 0
                                            ? `可用 ${available}`
                                            : "无可用";
                                        })()}
                                      </span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs text-muted-foreground"
                                        onClick={() =>
                                          setRatioTypeGroups((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    chapters:
                                                      item.chapters.filter(
                                                        (_entry, entryIndex) =>
                                                          entryIndex !==
                                                          chapterIndex,
                                                      ),
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  ),
                                )}
                                {group.chapters.some(
                                  (chapter) =>
                                    chapter.chapterId ===
                                    SMART_PRACTICE_WHOLE_COURSE_ID,
                                ) ? null : (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const used = new Set(
                                        group.chapters.map(
                                          (chapter) => chapter.chapterId,
                                        ),
                                      );
                                      const next = ratioChapterRows.find(
                                        (row) =>
                                          row.id !==
                                            SMART_PRACTICE_WHOLE_COURSE_ID &&
                                          !used.has(row.id),
                                      );
                                      if (!next) {
                                        toast({
                                          title: "章节已全部添加",
                                          variant: "destructive",
                                        });
                                        return;
                                      }
                                      setRatioTypeGroups((prev) =>
                                        prev.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                chapters: [
                                                  ...item.chapters,
                                                  {
                                                    chapterId: next.id,
                                                    count: 0,
                                                  },
                                                ],
                                              }
                                            : item,
                                        ),
                                      );
                                    }}
                                  >
                                    + 添加章节
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const used = new Set(
                                ratioTypeGroups.map((group) => group.type),
                              );
                              const next = ratioTypeRows.find(
                                ([type]) => !used.has(type),
                              );
                              if (!next) {
                                toast({
                                  title: "题型已全部添加",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setRatioTypeGroups((prev) => [
                                ...prev,
                                { type: next[0], chapters: [] },
                              ]);
                            }}
                          >
                            + 添加题型
                          </Button>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="prompt"
                    className="mt-0 h-full overflow-y-auto pt-1"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground">
                          本节知识点
                        </span>
                        <div className="w-full sm:w-56">
                          <KnowledgePicker
                            id="smart-practice-prompt-knowledge"
                            tree={knowledgeTree}
                            options={knowledgeOptions}
                            selectedId={knowledgePointId}
                            onSelect={setKnowledgePointId}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {promptTemplates.map((template) => (
                          <Button
                            key={template.label}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPrompt(template.value)}
                          >
                            {template.label}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (ratioTotal <= 0) {
                              toast({
                                title: "请先在「按配比」页签设置章节/题型数量",
                                variant: "destructive",
                              });
                              return;
                            }
                            setPrompt(buildRatioPrompt());
                          }}
                        >
                          按配比
                        </Button>
                        <Popover
                          open={strengthenOpen}
                          onOpenChange={setStrengthenOpen}
                        >
                          <PopoverTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              本节巩固
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-80 space-y-3 p-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                本节巩固
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                按上方选择的知识点统计可用题型，填入提示词。
                              </p>
                            </div>
                            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                              {sectionTypeCounts ? (
                                sectionQuestionTotal > 0 ? (
                                  <>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      {DISPLAY_TYPE_ORDER.filter(
                                        ([type]) =>
                                          (sectionTypeCounts.get(type) ?? 0) > 0,
                                      ).map(([type, label]) => (
                                        <span key={type}>
                                          {label}{" "}
                                          <span className="font-semibold text-foreground">
                                            {sectionTypeCounts.get(type) ?? 0}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      该节共 {sectionQuestionTotal} 道可用题目
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    该节暂无可用的题目
                                  </p>
                                )
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  请先在上方选择知识点
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="w-full"
                              disabled={!knowledgePointId}
                              onClick={applyStrengthenPrompt}
                            >
                              填入提示词
                            </Button>
                          </PopoverContent>
                        </Popover>
                        <Popover
                          open={typeRatioOpen}
                          onOpenChange={setTypeRatioOpen}
                        >
                          <PopoverTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              按题型配比
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-80 space-y-3 p-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                按题型配比
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                按每种题型的数量从题库取题，生成后仍可修改提示词。
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {TYPE_RATIO_FIELDS.map(({ key, label }) => (
                                <div
                                  key={key}
                                  className="flex items-center gap-2"
                                >
                                  <Label
                                    htmlFor={`type-ratio-${key}`}
                                    className="w-9 shrink-0 text-xs"
                                  >
                                    {label}
                                  </Label>
                                  <Input
                                    id={`type-ratio-${key}`}
                                    type="number"
                                    min={0}
                                    max={200}
                                    className="h-8"
                                    value={typeRatioCounts[key] ?? 0}
                                    onChange={(event) =>
                                      setTypeRatioCounts((prev) => ({
                                        ...prev,
                                        [key]: Number(event.target.value),
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                              <div className="flex items-center gap-2">
                                <span className="w-9 shrink-0 text-xs text-muted-foreground">
                                  难度
                                </span>
                                <Select
                                  value={String(typeRatioDifficulty)}
                                  onValueChange={(value) =>
                                    setTypeRatioDifficulty(Number(value))
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8"
                                    aria-label="题型配比难度"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {DIFFICULTY_OPTIONS.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={String(option.value)}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="w-full"
                              onClick={applyTypeRatio}
                            >
                              填入提示词
                            </Button>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Textarea
                        aria-label="练习提示词"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder={getPromptTemplate(
                          courseName,
                          selectedKnowledge?.name ?? null,
                          10,
                          "容易",
                          target === "paper" ? "试卷" : "练习",
                        )}
                        rows={3}
                        maxLength={500}
                      />
                    </div>
                  </TabsContent>
                </div>

                <div className="mt-3 h-5">
                  {sourceLoading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 size={16} className="animate-spin" />
                      正在加载题目
                    </p>
                  ) : sourceError ? (
                    <p className="text-sm text-destructive">{sourceError}</p>
                  ) : null}
                </div>
              </div>
          </Tabs>
        ) : (
          <>
            {isPage ? null : (
              <DialogHeader className="border-b px-5 py-4 pr-12">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Sparkles size={16} aria-hidden="true" />
                  智能创建{target === "paper" ? "试卷" : "练习"}
                </DialogTitle>
                <DialogDescription>
                  预览 · {includedQuestions.length} 题
                  {target === "paper" ? ` · ${paperTotalScore} 分` : ""}
                </DialogDescription>
              </DialogHeader>
            )}
            <div
              className={cn(
                "min-h-0 flex-1 px-5 py-4",
                isPage
                  ? "flex flex-col overflow-y-auto px-0 py-3 lg:overflow-hidden"
                  : "overflow-y-auto",
                isPage && previewSlotTree.length > 0 &&
                  "lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-stretch lg:gap-4",
              )}
            >
            {!isPage ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setStage("configure")}>
                  <ArrowLeft data-icon="inline-start" />
                  修改条件
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleRegenerate}>
                  <RefreshCw data-icon="inline-start" />
                  换一组
                </Button>
              </div>
            ) : null}

            {previewShortfall ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300/70 lg:col-span-full bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="min-w-0 flex-1">
                  设置 {requestedPreviewCount} 题，当前条件只匹配到{" "}
                  {previewQuestions.length} 题。
                </span>
                {shortfallAccepted ? (
                  <Badge variant="success">
                    已按 {previewQuestions.length} 题生成
                  </Badge>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShortfallAccepted(true)}
                    >
                      用 {previewQuestions.length} 题生成
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setStage("configure")}
                    >
                      调整设置
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            {!isPage && previewSlotRows.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">章节</th>
                      <th className="px-2 py-1.5 text-left font-medium">题型</th>
                      <th className="px-2 py-1.5 text-right font-medium">设置</th>
                      <th className="px-2 py-1.5 text-right font-medium">实际</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSlotRows.map((row) => (
                      <tr
                        key={`${row.chapter}|${row.type}`}
                        className="border-t border-border/60"
                      >
                        <td
                          className="max-w-[200px] truncate px-2 py-1.5"
                          title={row.chapter}
                        >
                          {row.chapter}
                        </td>
                        <td className="px-2 py-1.5">{row.type}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.requested}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums",
                            row.picked < row.requested &&
                              "font-medium text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {row.picked}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {isPage && previewSlotTree.length > 0 ? (
              <aside className="flex min-h-0 flex-col gap-2 lg:overflow-y-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setStage("configure")}
                  >
                    <ArrowLeft data-icon="inline-start" />
                    修改条件
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={handleRegenerate}
                  >
                    <RefreshCw data-icon="inline-start" />
                    换一组
                  </Button>
                </div>
                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/40 p-1.5">
                <button
                  type="button"
                  onClick={() => setSlotFilter(null)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    slotFilter === null
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className="truncate">全部题目</span>
                  <span className="tabular-nums">{previewQuestions.length}</span>
                </button>
                {previewSlotTree.map((chapter) => (
                  <div key={chapter.id} className="mt-1">
                    <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs font-medium">
                      <span className="truncate" title={chapter.label}>
                        {chapter.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {chapter.picked}/{chapter.requested}
                      </span>
                    </div>
                    {chapter.types.map((type) => (
                      <button
                        key={type.key}
                        type="button"
                        onClick={() => setSlotFilter(type.key)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md py-1 pl-5 pr-2 text-left text-xs transition-colors",
                          slotFilter === type.key
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <span className="truncate">{type.label}</span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            type.picked < type.requested &&
                              "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {type.picked}/{type.requested}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                </div>
              </aside>
            ) : null}

            <div
              className={cn(
                isPage && "min-w-0 pr-1 lg:min-h-0 lg:overflow-y-auto",
              )}
            >
            <div className="flex flex-col gap-2">
              {(slotFilteredIds
                ? previewQuestions.filter((question) => slotFilteredIds.has(question.id))
                : previewQuestions
              ).map((question) => {
                const index = previewQuestions.indexOf(question);
                const included = includedIds.has(question.id);
                return (
                  <QuestionPreviewCard
                    key={question.id}
                    question={question}
                    index={index + 1}
                    mode="compact"
                    expandOnClick
                    hideAnswer
                    // 分值在这里可改，header 里就不再重复展示分值和难度。
                    hideScoreAndDifficulty={target === "paper"}
                    className={cn("text-left", !included && "opacity-60")}
                    trailing={
                      <div className="flex items-center gap-2">
                        {target === "paper" ? (
                          <>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              难度 {question.difficulty}
                            </span>
                            <label
                              className="flex items-center gap-1 text-xs text-muted-foreground"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Input
                                type="number"
                                min={0}
                                step={0.5}
                                className="h-7 w-16 text-right"
                                aria-label={`第 ${index + 1} 题分值`}
                                value={
                                  scoreOverrides[question.id] ??
                                  question.score ??
                                  0
                                }
                                onChange={(event) =>
                                  setScoreOverrides((prev) => ({
                                    ...prev,
                                    [question.id]: Number(event.target.value),
                                  }))
                                }
                              />
                              分
                            </label>
                          </>
                        ) : null}
                        <Checkbox
                          checked={included}
                          onCheckedChange={() => toggleIncluded(question.id)}
                          aria-label={`${included ? "移除" : "加入"}第 ${index + 1} 题`}
                        />
                      </div>
                    }
                  />
                );
              })}
            </div>

            <div
              className={cn(
                "mt-5 grid gap-4",
                target === "paper"
                  ? isPage
                    ? "hidden"
                    : ""
                  : "lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]",
                isPage && target === "paper" && "hidden",
              )}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smart-practice-title">
                  {target === "paper" ? "试卷名称" : "练习名称"}
                </Label>
                <Input
                  id="smart-practice-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              {target === "paper" ? null : (
                <ClassStudentSelector
                  selectedIds={studentIds}
                  onChange={setStudentIds}
                  summaryLabel="名学生"
                  emptySummaryText="请选择学生"
                  defaultSupplementCollapsed
                  defaultClassIds={defaultClassIds}
                  semesterOptions={semesterOptions}
                  onSemesterChange={setSemesterOverride}
                />
              )}
            </div>
            </div>
            </div>
          </>
        )}

          {isPage ? null : (
            <DialogFooter className="border-t px-5 py-4 sm:gap-2 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={publishing}
              >
                取消
              </Button>
              {stage === "configure" ? (
                <Button type="button" onClick={() => generatePreview()} disabled={!canGenerate}>
                  <Sparkles data-icon="inline-start" />
                  生成预览
                </Button>
              ) : (
                <Button type="button" onClick={() => void handlePublish()} disabled={!canPublish || publishing}>
                  {publishing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                  {target === "paper" ? "创建试卷" : "确认发布 · 7 天"}
                </Button>
              )}
            </DialogFooter>
          )}
    </>
  );

  if (isPage) {
    // 高度完全交给父容器（课程详情的 main），不再用视口公式估算：
    // 面包屑栏固定、预览阶段只有试题列表和左侧树各自滚动。
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-1">{content}</div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!publishing) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl">
        {content}
      </DialogContent>
    </Dialog>
  );
}
