import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Copy, Download, Eye, Loader2, Maximize2, Network, Pencil, Plus, RefreshCcw, Search, Sparkles, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip-button";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { exportPaper, type ExportPaperFormat } from "@/lib/exam-export";
import type {
  IKnowledgePoint,
  IPaper,
  IPaperDetail,
  IPaperQuestion,
  IQuestion,
  IQuestionBank,
  ITag,
  PaperSourceType,
  QuestionType,
} from "@/types";
import { QuestionSelector } from "@/pages/exams/components/QuestionSelector";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  QuestionEditFormContent,
  type QuestionEditSubmitValues,
} from "@/pages/questions/edit";

import {
  appendPaperQuestionsWithAI,
  getDifficultyStrategyLabel,
  paperApiRequest,
  type PaperDifficultyStrategy,
} from "./api";
import { PaperAIGenerateDialog } from "./ai-generate-dialog";

const PAPER_SOURCE_LABELS: Record<PaperSourceType, string> = {
  manual: "手工",
  import: "导入",
  ai_generated: "AI 生成",
};

type PaperDetailNavState = {
  backTo?: string;
  backLabel?: string;
  courseOrigin?: boolean;
  courseKpId?: string;
  courseSemesterId?: string;
  defaultClassIds?: string[];
  publishExamSuccessTo?: string;
  publishPracticeSuccessTo?: string;
};

type PaperKnowledgePointOption = {
  id: string;
  name: string;
  path: string;
};

type ManualQuestionType = QuestionType | "single_choice" | "multi_choice";

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
  ...Object.fromEntries(MANUAL_QUESTION_TYPES.map((item) => [item.value, item.label])),
};

const QUESTION_TYPE_ORDER: Record<QuestionType, number> = {
  choice: 0,
  true_false: 1,
  fill_in: 2,
  short_answer: 3,
  essay: 4,
  code: 5,
};

function toBackendQuestionType(type: ManualQuestionType): QuestionType {
  return type === "single_choice" || type === "multi_choice" ? "choice" : type;
}

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 试卷列表主体（筛选 + 表格 + 操作 + AI 生成弹窗），供「考试管理-试卷列表」与
 * 「课程详情-试卷」共用。传入 rootKnowledgePointId 时只展示该主知识点下的试卷
 * （即某门课程的试卷）。
 */
export function PaperListBody({
  rootKnowledgePointId,
  courseQuestionBankName,
  knowledgePointOptions,
  detailNavState,
  rightSlot,
}: {
  rootKnowledgePointId?: string | null;
  /** 课程详情中传入，例如「Python程序设计-题库」，用于默认限定从本课程题库选题。 */
  courseQuestionBankName?: string;
  /** 课程详情传入的课程知识点树，只允许在这些知识点中筛选。 */
  knowledgePointOptions?: PaperKnowledgePointOption[];
  /** 查看/AI 生成试卷详情时保留来源，课程详情进入时用于回到原 tab。 */
  detailNavState?: PaperDetailNavState;
  /** 渲染在筛选栏最右侧的额外操作（如课程内的「导入试卷」按钮）。 */
  rightSlot?: ReactNode;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | PaperSourceType>("all");
  const [busyPaperId, setBusyPaperId] = useState<string | null>(null);
  const [aiDialogPaper, setAiDialogPaper] = useState<IPaper | null>(null);
  const [editingPaper, setEditingPaper] = useState<IPaper | null>(null);

  const { query } = useList<IPaper>({
    resource: "papers",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
  });

  const allPapers = query.data?.data ?? [];
  const filteredPapers = useMemo(
    () =>
      allPapers.filter((paper) => {
        if (
          rootKnowledgePointId &&
          paper.root_knowledge_point_id !== rootKnowledgePointId
        ) {
          return false;
        }
        const titleMatch = paper.title
          .toLowerCase()
          .includes(keyword.trim().toLowerCase());
        const sourceMatch = sourceFilter === "all" || paper.source_type === sourceFilter;
        return titleMatch && sourceMatch;
      }),
    [allPapers, keyword, sourceFilter, rootKnowledgePointId],
  );

  const withBusyGuard = async (paperId: string, fn: () => Promise<void>) => {
    setBusyPaperId(paperId);
    try {
      await fn();
      await query.refetch();
    } catch (error) {
      toast({
        title: "操作失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusyPaperId(null);
    }
  };

  const handleCopy = async (paper: IPaper) =>
    withBusyGuard(paper.id, async () => {
      const detail = await paperApiRequest<IPaperDetail>(`/papers/${paper.id}`);
      const created = await paperApiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title: `${detail.title}（复制）`,
          description: detail.description,
          source_type: "manual",
          source_paper_id: detail.id,
          root_knowledge_point_id: detail.root_knowledge_point_id,
          question_items: detail.questions.map((item) => ({
            question_id: item.question_id,
            order: item.order,
            score_override: item.score_override,
          })),
        }),
      });
      toast({ title: "复制成功", description: `已创建试卷：${created.title}` });
    });

  const handleDelete = async (paper: IPaper) =>
    withBusyGuard(paper.id, async () => {
      if (!window.confirm(`确认删除试卷「${paper.title}」？`)) {
        return;
      }
      await paperApiRequest(`/papers/${paper.id}`, { method: "DELETE" });
      toast({ title: "已删除", description: paper.title });
    });

  const handleExport = async (
    paper: IPaper,
    format: ExportPaperFormat,
    answers: boolean,
  ) => {
    try {
      setBusyPaperId(paper.id);
      await exportPaper(paper.id, { format, answers });
    } catch (error) {
      toast({
        title: "导出失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusyPaperId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-muted/5 p-4">
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-background p-1">
          {(["all", "manual", "import", "ai_generated"] as const).map((source) => (
            <button
              key={source}
              type="button"
              className={`h-8 rounded-md px-3 text-xs font-semibold ${
                sourceFilter === source
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => setSourceFilter(source)}
            >
              {source === "all" ? "全部来源" : PAPER_SOURCE_LABELS[source]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按试卷名称搜索"
            className="h-9 w-[240px] border-border/60 pl-9 text-xs font-medium focus-visible:ring-primary/20"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
          onClick={() => query.refetch()}
          disabled={query.isLoading}
        >
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
        {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/40 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs font-semibold">试卷名称</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold">来源</th>
              <th className="px-4 py-3 text-xs font-semibold">主知识点</th>
              <th className="px-4 py-3 text-xs font-semibold">题目数</th>
              <th className="px-4 py-3 text-xs font-semibold">创建人</th>
              <th className="px-4 py-3 text-xs font-semibold">创建时间</th>
              <th className="px-4 py-3 text-right text-xs font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredPapers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {query.isLoading ? "加载中..." : "暂无试卷"}
                </td>
              </tr>
            )}
            {filteredPapers.map((paper) => {
              const isBusy = busyPaperId === paper.id;
              return (
                <tr key={paper.id} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {paper.title}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{PAPER_SOURCE_LABELS[paper.source_type]}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {paper.root_knowledge_point?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">{paper.question_count}</td>
                  <td className="px-4 py-3">{paper.created_by_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateTime(paper.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <TooltipButton
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          navigate(`/papers/${paper.id}`, {
                            state: {
                              ...detailNavState,
                              courseQuestionBankName,
                              knowledgePointOptions,
                            },
                          })
                        }
                        tooltip="详情"
                      >
                        <Eye className="h-4 w-4" />
                      </TooltipButton>
                      {rootKnowledgePointId ? (
                        <TooltipButton
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            navigate(`/papers/${paper.id}/knowledge-coverage`, {
                              state: {
                                ...detailNavState,
                                backTo: detailNavState?.backTo ?? "/papers",
                                backLabel: detailNavState?.backLabel ?? "返回试卷列表",
                                courseQuestionBankName,
                                knowledgePointOptions,
                                rootKnowledgePointId,
                                rootKnowledgePointName: paper.root_knowledge_point?.name,
                              },
                            })
                          }
                          tooltip="知识点视角"
                        >
                          <Network className="h-4 w-4" />
                        </TooltipButton>
                      ) : null}
                      <TooltipButton
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(paper)}
                        disabled={isBusy}
                        tooltip="复制"
                      >
                        <Copy className="h-4 w-4" />
                      </TooltipButton>
                      <TooltipButton
                        variant="ghost"
                        size="icon"
                        onClick={() => setAiDialogPaper(paper)}
                        disabled={isBusy || Boolean(paper.archived_at)}
                        tooltip="AI 生成新试卷"
                      >
                        <Sparkles className="h-4 w-4" />
                      </TooltipButton>
                      {rootKnowledgePointId ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isBusy}
                              aria-label="导出试卷"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="text-xs">导出 Word</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleExport(paper, "docx", true)}>
                              <Download className="mr-2" />
                              含答案
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExport(paper, "docx", false)}>
                              <Download className="mr-2" />
                              空白试卷
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs">导出 PDF</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleExport(paper, "pdf", true)}>
                              <Download className="mr-2" />
                              含答案
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExport(paper, "pdf", false)}>
                              <Download className="mr-2" />
                              空白试卷
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      <TooltipButton
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(paper)}
                        disabled={isBusy}
                        tooltip="删除"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </TooltipButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingPaper ? (
        <PaperEditDialog
          paper={editingPaper}
          courseQuestionBankName={courseQuestionBankName}
          knowledgePointOptions={knowledgePointOptions}
          onOpenChange={(open) => {
            if (!open) setEditingPaper(null);
          }}
          onSaved={async () => {
            setEditingPaper(null);
            await query.refetch();
          }}
        />
      ) : null}

      {aiDialogPaper ? (
        <PaperAIGenerateDialog
          open={Boolean(aiDialogPaper)}
          onOpenChange={(open) => {
            if (!open) setAiDialogPaper(null);
          }}
          paperId={aiDialogPaper.id}
          paperTitle={aiDialogPaper.title}
          rootKnowledgePointName={aiDialogPaper.root_knowledge_point?.name}
          generatedPaperState={detailNavState}
        />
      ) : null}
    </div>
  );
}

function getPaperQuestionTitle(item: IPaperQuestion): string {
  const question = item.question;
  if (!question) return "题目已不存在";
  if (question.title?.trim()) return question.title.trim();
  const content = question.content as { text?: unknown } | string | null | undefined;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (content && typeof content === "object" && typeof content.text === "string" && content.text.trim()) {
    return content.text.trim();
  }
  return "未命名题目";
}

function getQuestionKnowledgePointIds(
  question: IQuestion,
  fallbackKnowledgePointId?: string | null,
): string[] {
  const ids = (question.knowledge_points ?? []).map((kp) => kp.id).filter(Boolean);
  if (ids.length > 0) return ids;
  return fallbackKnowledgePointId ? [fallbackKnowledgePointId] : [];
}

function getQuestionPlainText(question: IQuestion): string {
  const content = question.content as { text?: unknown; html?: unknown } | string | null | undefined;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (content && typeof content === "object") {
    if (typeof content.text === "string" && content.text.trim()) return content.text.trim();
    if (typeof content.html === "string" && content.html.trim()) {
      return content.html.replace(/<[^>]+>/g, " ").trim();
    }
  }
  return question.title ?? "";
}

function buildPaperReplacementPrompt(question: IQuestion, rootKnowledgePointName?: string | null): string {
  const typeLabel = QUESTION_TYPE_LABELS[question.type] ?? question.type;
  const kpNames = (question.knowledge_points ?? []).map((kp) => kp.name).join("、") || rootKnowledgePointName || "当前课程";
  const content = getQuestionPlainText(question).slice(0, 500);
  return `请基于下面的原题生成一道替换题，要求保持同一课程、同一知识点范围、同一题型和接近难度。
- 课程/知识点范围：${kpNames}
- 题型：${typeLabel}
- 不要生成与课程无关的题目，也不要照抄原题。

原题题干：
${content}`.trim();
}

async function streamGenerateReplacementQuestion({
  question,
  knowledgePointIds,
  examTitle,
  rootKnowledgePointName,
}: {
  question: IQuestion;
  knowledgePointIds: string[];
  examTitle: string;
  rootKnowledgePointName?: string | null;
}): Promise<Record<string, unknown>> {
  const token = localStorage.getItem("access_token");
  const response = await fetch("/api/questions/ai-generate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      total_count: 1,
      difficulty: question.difficulty,
      type_distribution: { [question.type]: 1 },
      knowledge_point_ids: knowledgePointIds,
      exam_title: examTitle,
      prompt: buildPaperReplacementPrompt(question, rootKnowledgePointName),
      model: "deepseek",
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error("AI 生成请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let generated: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.replace(/^data:\s*/, "")) as Record<string, unknown>;
      if (event.type === "question") {
        generated = event.data as Record<string, unknown>;
      } else if (event.type === "error") {
        throw new Error((event.message as string) || "AI 生成失败");
      }
    }
  }

  if (!generated) {
    throw new Error("AI 未返回题目数据");
  }
  return generated;
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

function PaperEditDialog({
  paper,
  courseQuestionBankName,
  knowledgePointOptions,
  onOpenChange,
  onSaved,
}: {
  paper: IPaper;
  courseQuestionBankName?: string;
  knowledgePointOptions?: PaperKnowledgePointOption[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<IPaperDetail | null>(null);
  const [title, setTitle] = useState(paper.title);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiAppending, setAiAppending] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<PaperDifficultyStrategy>("similar");
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualQuestionType, setManualQuestionType] = useState<ManualQuestionType>("single_choice");
  const [editingQuestion, setEditingQuestion] = useState<IQuestion | null>(null);
  const [manualKnowledgePointId, setManualKnowledgePointId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [questionSaving, setQuestionSaving] = useState(false);
  const [selectorRefreshKey, setSelectorRefreshKey] = useState(0);
  const [ensuredCourseBank, setEnsuredCourseBank] = useState<IQuestionBank | null>(null);
  const [ensuringCourseBank, setEnsuringCourseBank] = useState(false);
  const [pendingQuestionById, setPendingQuestionById] = useState<Map<string, IPaperQuestion>>(
    () => new Map(),
  );
  const [replacingQuestionId, setReplacingQuestionId] = useState<string | null>(null);
  const [recentlyReplacedQuestionId, setRecentlyReplacedQuestionId] = useState<string | null>(null);
  // 左栏题型分组的展开状态：默认全部收起，点击题型标题展开/收起。
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(() => new Set());

  const toggleTypeExpanded = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    paperApiRequest<IPaperDetail>(`/papers/${paper.id}`)
      .then((value) => {
        if (cancelled) return;
        setDetail(value);
        setTitle(value.title);
        setSelectedIds(value.questions.map((item) => item.question_id));
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "加载试卷失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
        });
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paper.id, onOpenChange, toast]);

  const itemById = useMemo(() => {
    return new Map((detail?.questions ?? []).map((item) => [item.question_id, item]));
  }, [detail]);

  const selectedQuestionItems = useMemo(
    () =>
      selectedIds
        .map((id) => itemById.get(id) ?? pendingQuestionById.get(id))
        .filter((item): item is IPaperQuestion => Boolean(item)),
    [itemById, pendingQuestionById, selectedIds],
  );
  const selectedQuestionGroups = useMemo(() => {
    const grouped = new Map<string, IPaperQuestion[]>();
    for (const item of selectedQuestionItems) {
      const key = item.question?.type ?? "unknown";
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries()).sort(
      ([a], [b]) =>
        (QUESTION_TYPE_ORDER[a as QuestionType] ?? Number.MAX_SAFE_INTEGER) -
        (QUESTION_TYPE_ORDER[b as QuestionType] ?? Number.MAX_SAFE_INTEGER),
    );
  }, [selectedQuestionItems]);
  const existingSelectedCount = selectedIds.filter((id) => itemById.has(id)).length;
  const newSelectedCount = Math.max(0, selectedIds.length - existingSelectedCount);
  const canAIAppend = Boolean(detail && detail.questions.length > 0 && !detail.archived_at);
  const courseBank =
    ensuredCourseBank ??
    (courseQuestionBankName
      ? banks.find((bank) => bank.name === courseQuestionBankName)
      : null) ??
    null;
  const manualQuestionDraft = detail
    ? createManualQuestionDraft({
        type: manualQuestionType,
        bank: courseBank,
        knowledgePoint:
          knowledgePoints.find((item) => item.id === manualKnowledgePointId) ??
          paperKnowledgePointOptionToKnowledgePoint(
            knowledgePointOptions?.find((item) => item.id === manualKnowledgePointId),
          ) ??
          detail.root_knowledge_point,
      })
    : null;

  const updateSelectedIds = (ids: string[]) => {
    setSelectedIds(Array.from(new Set(ids)));
  };

  const removeQuestion = (questionId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== questionId));
    setPendingQuestionById((prev) => {
      if (!prev.has(questionId)) return prev;
      const next = new Map(prev);
      next.delete(questionId);
      return next;
    });
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
    await banksQuery.refetch();
    setEnsuredCourseBank(created);
    return created;
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseBank?.id, courseQuestionBankName, ensuringCourseBank, banksQuery.isLoading]);

  const persistCurrent = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new Error("请输入试卷名称");
    }
    const updated = await paperApiRequest<IPaperDetail>(`/papers/${paper.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: nextTitle,
        question_items: selectedIds.map((questionId, index) => {
          const existing = itemById.get(questionId) ?? pendingQuestionById.get(questionId);
          return {
            question_id: questionId,
            order: index,
            score_override: existing?.score_override ?? null,
          };
        }),
      }),
    });
    setDetail(updated);
    setTitle(updated.title);
    setSelectedIds(updated.questions.map((item) => item.question_id));
    setPendingQuestionById(new Map());
    return updated;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await persistCurrent();
      toast({
        title: "试卷已更新",
        description: `当前共 ${updated.questions.length} 道题。`,
      });
      await onSaved();
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAIAppend = async () => {
    setAiAppending(true);
    try {
      const targetBank = courseQuestionBankName ? await ensureCourseQuestionBank() : courseBank;
      const before = await persistCurrent();
      const updated = await appendPaperQuestionsWithAI<IPaperDetail>(paper.id, {
        question_count: aiCount,
        difficulty_strategy: aiDifficulty,
        prefer_root_knowledge_point: true,
        model: "deepseek",
        ...(targetBank ? { question_bank_id: targetBank.id } : {}),
      });
      setDetail(updated);
      setTitle(updated.title);
      setSelectedIds(updated.questions.map((item) => item.question_id));
      setAiPanelOpen(false);
      setSelectorRefreshKey((value) => value + 1);
      toast({
        title: "AI 题目已加入",
        description: `新增 ${Math.max(0, updated.questions.length - before.questions.length)} 道题。`,
      });
    } catch (error) {
      toast({
        title: "AI 追加失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAiAppending(false);
    }
  };

  const handleManualQuestionSubmit = async (values: QuestionEditSubmitValues) => {
    if (!detail) return;
    setManualSaving(true);
    try {
      const bank = await ensureCourseQuestionBank();
      const explicitKnowledgePointIds = manualKnowledgePointId
        ? [manualKnowledgePointId]
        : values.knowledge_point_ids;
      const knowledgePointIds =
        explicitKnowledgePointIds.length > 0
          ? explicitKnowledgePointIds
          : detail.root_knowledge_point_id
            ? [detail.root_knowledge_point_id]
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
      setPendingQuestionById((prev) => {
        const next = new Map(prev);
        next.set(created.id, {
          question_id: created.id,
          order: selectedIds.length,
          score_override: null,
          question: created,
        });
        return next;
      });
      setSelectedIds((prev) => Array.from(new Set([...prev, created.id])));
      setManualAddOpen(false);
      setManualQuestionType("single_choice");
      setManualKnowledgePointId("");
      setSelectorRefreshKey((value) => value + 1);
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

  const handleQuestionEditSubmit = async (values: QuestionEditSubmitValues) => {
    if (!editingQuestion) return;
    setQuestionSaving(true);
    try {
      const updatedQuestion = await paperApiRequest<IQuestion>(`/questions/${editingQuestion.id}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      setPendingQuestionById((prev) => {
        if (!prev.has(updatedQuestion.id)) return prev;
        const next = new Map(prev);
        const previous = next.get(updatedQuestion.id);
        if (previous) {
          next.set(updatedQuestion.id, {
            ...previous,
            question: updatedQuestion,
          });
        }
        return next;
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.question_id === updatedQuestion.id
                  ? { ...item, question: updatedQuestion }
                  : item,
              ),
            }
          : current,
      );
      setSelectorRefreshKey((value) => value + 1);
      setEditingQuestion(null);
      toast({
        title: "题目已更新",
        description: "当前试卷和课程题库中的题目内容已同步更新。",
      });
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

  const handleReplaceQuestion = async (item: IPaperQuestion) => {
    const currentQuestion = item.question;
    if (!currentQuestion || !detail) return;
    setReplacingQuestionId(item.question_id);
    try {
      const targetBank = courseQuestionBankName ? await ensureCourseQuestionBank() : courseBank;
      if (!targetBank) {
        throw new Error("当前课程题库未就绪，无法换题。");
      }

      const fallbackKnowledgePointId = detail.root_knowledge_point_id ?? paper.root_knowledge_point_id;
      const knowledgePointIds = getQuestionKnowledgePointIds(currentQuestion, fallbackKnowledgePointId);
      const existingSet = new Set(selectedIds);
      let candidates: IQuestion[] = [];
      const params = new URLSearchParams({
        _start: "0",
        _end: "500",
        type: currentQuestion.type,
        question_bank_id: targetBank.id,
      });
      const bankQuestions = await paperApiRequest<IQuestion[]>(`/questions?${params}`);
      const knowledgePointSet = new Set(knowledgePointIds);
      candidates = bankQuestions.filter(
        (question) =>
          question.id !== currentQuestion.id &&
          !existingSet.has(question.id) &&
          (knowledgePointSet.size === 0 ||
            (question.knowledge_points ?? []).some((kp) => knowledgePointSet.has(kp.id))),
      );

      let replacementQuestion: IQuestion;
      let fromAI = false;
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        replacementQuestion = await paperApiRequest<IQuestion>(
          `/questions/${picked.id}/complete-answer`,
          { method: "POST" },
        );
      } else {
        const generated = await streamGenerateReplacementQuestion({
          question: currentQuestion,
          knowledgePointIds,
          examTitle: detail.title,
          rootKnowledgePointName: detail.root_knowledge_point?.name,
        });
        replacementQuestion = await paperApiRequest<IQuestion>("/questions", {
          method: "POST",
          body: JSON.stringify({
            type: (generated.type as QuestionType | undefined) ?? currentQuestion.type,
            title:
              (generated.title as string | undefined) ||
              ((generated.content as { text?: string } | undefined)?.text?.slice(0, 120) ?? currentQuestion.title),
            content: (generated.content as IQuestion["content"] | undefined) ?? { text: "" },
            options: (generated.options as IQuestion["options"] | undefined) ?? null,
            answer: (generated.answer as IQuestion["answer"] | undefined) ?? {},
            analysis: (generated.analysis as string | null | undefined) ?? null,
            difficulty: (generated.difficulty as number | undefined) ?? currentQuestion.difficulty,
            score: currentQuestion.score,
            source: "ai_generated",
            tag_ids: [],
            knowledge_point_ids: knowledgePointIds,
            question_bank_id: targetBank.id,
          }),
        });
        fromAI = true;
      }

      setPendingQuestionById((prev) => {
        const next = new Map(prev);
        next.delete(item.question_id);
        next.set(replacementQuestion.id, {
          question_id: replacementQuestion.id,
          order: item.order,
          score_override: item.score_override,
          question: replacementQuestion,
        });
        return next;
      });
      setSelectedIds((prev) =>
        prev.map((questionId) =>
          questionId === item.question_id ? replacementQuestion.id : questionId,
        ),
      );
      setRecentlyReplacedQuestionId(replacementQuestion.id);
      window.setTimeout(() => {
        setRecentlyReplacedQuestionId((current) =>
          current === replacementQuestion.id ? null : current,
        );
      }, 260);
      setSelectorRefreshKey((value) => value + 1);
      toast({
        title: "已换一题",
        description: fromAI
          ? `题库中没有同知识点可替换题，已用 AI 生成并保存到「${targetBank.name}」。`
          : "已从课程题库中替换为同知识点题目，保存修改后生效。",
      });
    } catch (error) {
      toast({
        title: "换题失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setReplacingQuestionId(null);
    }
  };

  const renderAIAppendPopover = () => (
    <Popover open={aiPanelOpen} onOpenChange={setAiPanelOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          className="border-primary/30 text-primary hover:bg-primary/5 hover:text-primary"
        >
          <Sparkles className="h-4 w-4" />
          AI 生成并加入
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[360px] p-4">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">AI 生成并加入</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              基于当前试卷题型、难度和课程知识点生成新题，生成后加入当前试卷。
            </p>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="paper-ai-count">数量</Label>
              <Input
                id="paper-ai-count"
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
            <div className="space-y-1.5">
              <Label htmlFor="paper-ai-difficulty">难度</Label>
              <select
                id="paper-ai-difficulty"
                value={aiDifficulty}
                onChange={(event) => setAiDifficulty(event.target.value as PaperDifficultyStrategy)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(["similar", "easier", "harder"] as const).map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {getDifficultyStrategyLabel(strategy)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!canAIAppend ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              当前试卷没有源题或已归档，暂不能基于试卷 AI 追加。
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={!canAIAppend || aiAppending || saving}
            onClick={handleAIAppend}
          >
            {aiAppending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            生成加入
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1500px] flex-col gap-3 overflow-hidden p-4">
        <DialogHeader className="shrink-0 space-y-1">
          <DialogTitle>修改试卷</DialogTitle>
          <DialogDescription className="text-xs">
            可修改试卷名称、删除已有题目，也可以从课程题库选择或用 AI 生成题目加入当前试卷。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载试卷...
          </div>
        ) : detail ? (
          <div className="grid min-h-0 flex-1 gap-5 overflow-hidden lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="flex min-h-0 flex-col gap-4 overflow-hidden pr-1">
              <div className="shrink-0 space-y-2">
                <Label htmlFor="paper-edit-title">试卷名称</Label>
                <Input
                  id="paper-edit-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="请输入试卷名称"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/10">
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p className="shrink-0 text-sm font-semibold text-foreground">当前试卷题目</p>
                    <p className="truncate text-xs text-muted-foreground">
                      已选 {selectedIds.length} 题
                      {newSelectedCount > 0 ? `，其中 ${newSelectedCount} 题将在保存后加入` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedIds([])}
                  >
                    清空
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selectedQuestionItems.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      暂无已选题目，可从右侧题库选择。
                    </div>
                  ) : (
                    selectedQuestionGroups.map(([type, items], groupIndex) => {
                      const groupStartIndex = selectedQuestionGroups
                        .slice(0, groupIndex)
                        .reduce((sum, [, groupItems]) => sum + groupItems.length, 0);
                      const isExpanded = expandedTypes.has(type);
                      return (
                        <div key={type} className="border-t border-border/50 first:border-t-0">
                          <button
                            type="button"
                            onClick={() => toggleTypeExpanded(type)}
                            aria-expanded={isExpanded}
                            className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 bg-muted/60 px-4 py-2 text-left backdrop-blur transition-colors hover:bg-muted"
                          >
                            <span className="flex items-center gap-1.5">
                              <ChevronRight
                                className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              />
                              <span className="text-xs font-semibold text-foreground">
                                {QUESTION_TYPE_LABELS[type] ?? "未知题型"}
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {items.length} 题
                            </span>
                          </button>
                          <div
                            className={`space-y-3 p-3 ${isExpanded ? "" : "hidden"}`}
                          >
                            {items.map((item, itemIndex) =>
                              item.question ? (
                                <div
                                  key={item.question_id}
                                  className={`transition-all duration-200 motion-reduce:transition-none ${
                                    replacingQuestionId === item.question_id
                                      ? "translate-y-1 opacity-35"
                                      : recentlyReplacedQuestionId === item.question_id
                                        ? "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                                        : ""
                                  }`}
                                >
                                  <QuestionPreviewCard
                                    question={item.question}
                                    index={groupStartIndex + itemIndex + 1}
                                    className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                                    expandOnClick
                                    hideAnswer
                                    markChoiceAnswer
                                    actions={
                                      <div className="flex items-center gap-1">
                                        <TooltipButton
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={() => setEditingQuestion(item.question)}
                                          tooltip="编辑题目"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </TooltipButton>
                                        <TooltipButton
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          disabled={Boolean(replacingQuestionId)}
                                          onClick={() => handleReplaceQuestion(item)}
                                          tooltip="换一题"
                                        >
                                          {replacingQuestionId === item.question_id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <RefreshCcw className="h-3.5 w-3.5" />
                                          )}
                                        </TooltipButton>
                                        <TooltipButton
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                          onClick={() => removeQuestion(item.question_id)}
                                          tooltip="从试卷中移除"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </TooltipButton>
                                      </div>
                                    }
                                  />
                                </div>
                              ) : (
                                <div
                                  key={item.question_id}
                                  className="flex items-start gap-3 rounded-lg border border-border/60 px-4 py-3"
                                >
                                  <span className="mt-0.5 w-7 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                                    {groupStartIndex + itemIndex + 1}.
                                  </span>
                                  <p className="min-w-0 flex-1 line-clamp-2 text-sm font-medium text-foreground">
                                    {getPaperQuestionTitle(item)}
                                  </p>
                                  <TooltipButton
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={() => removeQuestion(item.question_id)}
                                    tooltip="从试卷中移除"
                                  >
                                    <X className="h-4 w-4 text-destructive" />
                                  </TooltipButton>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border/60 p-4">
              {courseQuestionBankName && !courseBank ? (
                <>
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">从课程题库选择</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setManualAddOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        添加题目
                      </Button>
                      {renderAIAppendPopover()}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
                    {ensuringCourseBank ? "正在准备课程题库..." : "课程题库未就绪"}
                  </div>
                </>
              ) : (
                <QuestionSelector
                  selectedIds={selectedIds}
                  onChange={updateSelectedIds}
                  showSummary
                  renderSummary={({
                    selectedCount,
                    currentBankTotal,
                    total,
                    onClear,
                    onOpenFullscreen,
                  }) => (
                    <div className="flex shrink-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">从课程题库选择</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          已选{" "}
                          <span className="font-semibold text-foreground">{selectedCount}</span> 题
                          {currentBankTotal != null
                            ? `·当前题库共 ${currentBankTotal} 题`
                            : `·共 ${total} 题`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {selectedCount > 0 && (
                          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                            清空选择
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onOpenFullscreen}
                        >
                          <Maximize2 className="h-4 w-4" />
                          全屏显示
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setManualAddOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          添加题目
                        </Button>
                        {renderAIAppendPopover()}
                      </div>
                    </div>
                  )}
                  initialBankName={courseQuestionBankName}
                  initialBankId={courseBank?.id}
                  initialBankQuestionCount={courseBank?.question_count}
                  lockInitialBank={false}
                  knowledgePointOptions={knowledgePointOptions}
                  restrictKnowledgePointsToOptions={knowledgePointOptions !== undefined}
                  fillAvailableHeight
                  refreshKey={selectorRefreshKey}
                  onEditQuestion={setEditingQuestion}
                />
              )}
            </section>
          </div>
        ) : null}

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSave} disabled={loading || saving || aiAppending}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
      <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加题目</DialogTitle>
            <DialogDescription>
              题目会保存到「{courseQuestionBankName ?? "课程题库"}」，并自动加入当前试卷。
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
              <select
                id="manual-question-type"
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div>
                <Label htmlFor="manual-question-knowledge">知识点（可选）</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  不选择时默认绑定当前课程知识点。
                </p>
              </div>
              <select
                id="manual-question-knowledge"
                value={manualKnowledgePointId}
                onChange={(event) => setManualKnowledgePointId(event.target.value)}
                disabled={manualSaving}
                className="h-9 min-w-52 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">默认：当前课程知识点</option>
                {(knowledgePointOptions ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.path || item.name}
                  </option>
                ))}
              </select>
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
    </Dialog>
  );
}
