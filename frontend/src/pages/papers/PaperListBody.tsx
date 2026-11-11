import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { Calculator, Copy, Download, Eye, FilePlus2, ListPlus, Loader2, Network, Pencil, Plus, RefreshCcw, Search, Send, ShoppingBasket, Sparkles, Trash2, X } from "lucide-react";

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
  QuestionDisplayType,
  QuestionType,
} from "@/types";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  getQuestionDisplayType,
  getQuestionDisplayTypeLabel,
  questionDisplayTypeFullLabel,
} from "@/components/questions/question-preview-utils";
import { cn } from "@/lib/utils";
import type { StudentSemesterOption } from "@/pages/exams/components/ClassStudentSelector";
import {
  QuestionEditFormContent,
  type QuestionEditSubmitValues,
} from "@/pages/questions/edit";

import {
  appendPaperQuestionsWithAI,
  getDifficultyStrategyLabel,
  paperApiList,
  paperApiRequest,
  type PaperDifficultyStrategy,
} from "./api";
import { PaperAIGenerateDialog } from "./ai-generate-dialog";
import { PaperExpandDialog } from "./paper-expand-dialog";
import {
  PaperQuickPublishDialog,
  type PaperQuickPublishMode,
} from "./quick-publish-dialog";
import { PaperScorePanel, type ScoreViewMode } from "@/pages/exams/components/PaperScorePanel";
import {
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
  type QuestionTypeSummary,
} from "@/pages/exams/components/paper-view-utils";
import type { ExamQuestionFormItem } from "@/pages/exams/components/exam-form-utils";
import {
  applyPaperTypeScoreAllocation,
  buildPaperScoreItems,
  totalPaperScore,
} from "./paper-detail-score";

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
  /** 本课程的学期列表；进入试卷详情后可一键按学期选中学生。 */
  courseSemesters?: StudentSemesterOption[];
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

const BANK_PAGE_SIZE = 20;
const BANK_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const QUESTION_DISPLAY_TYPE_ORDER: QuestionDisplayType[] = [
  "single_choice",
  "multi_choice",
  "true_false",
  "fill_in",
  "short_answer",
  "essay",
  "code",
];

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
const PAPER_KEYWORD_PARAM = "pk";
const PAPER_SOURCE_PARAM = "psrc";

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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  // Filters live in the URL so opening a paper (and coming back) restores the
  // same list instead of the unfiltered default.
  const [keyword, setKeyword] = useState(
    () => searchParams.get(PAPER_KEYWORD_PARAM) ?? "",
  );
  const [sourceFilter, setSourceFilter] = useState<"all" | PaperSourceType>(
    () => (searchParams.get(PAPER_SOURCE_PARAM) as PaperSourceType | null) ?? "all",
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextKeyword = keyword.trim();
      const currentKeyword = searchParams.get(PAPER_KEYWORD_PARAM) ?? "";
      const currentSource = searchParams.get(PAPER_SOURCE_PARAM) ?? "all";
      if (nextKeyword === currentKeyword && sourceFilter === currentSource) {
        return;
      }
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (nextKeyword) {
            params.set(PAPER_KEYWORD_PARAM, nextKeyword);
          } else {
            params.delete(PAPER_KEYWORD_PARAM);
          }
          if (sourceFilter === "all") {
            params.delete(PAPER_SOURCE_PARAM);
          } else {
            params.set(PAPER_SOURCE_PARAM, sourceFilter);
          }
          return params;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword, sourceFilter, searchParams, setSearchParams]);
  const [busyPaperId, setBusyPaperId] = useState<string | null>(null);
  const [aiDialogPaper, setAiDialogPaper] = useState<IPaper | null>(null);
  const [expandDialogPaper, setExpandDialogPaper] = useState<IPaper | null>(
    null,
  );
  const [publishTarget, setPublishTarget] = useState<{
    paper: IPaper;
    mode: PaperQuickPublishMode;
  } | null>(null);
  const [publishDetail, setPublishDetail] = useState<IPaperDetail | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
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

  const handleOpenPublish = async (
    paper: IPaper,
    mode: PaperQuickPublishMode,
  ) => {
    setPublishLoading(true);
    try {
      const detail = await paperApiRequest<IPaperDetail>(`/papers/${paper.id}`);
      setPublishDetail(detail);
      setPublishTarget({ paper, mode });
    } catch (error) {
      toast({
        title: "加载试卷失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setPublishLoading(false);
    }
  };

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
                              backTo:
                                detailNavState?.backTo ??
                                `${location.pathname}${location.search}`,
                              backLabel: detailNavState?.backLabel ?? "返回试卷列表",
                              courseQuestionBankName,
                              knowledgePointOptions,
                            },
                          })
                        }
                        tooltip="查看"
                      >
                        <Eye className="h-4 w-4" />
                      </TooltipButton>
                      <TooltipButton
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingPaper(paper)}
                        disabled={isBusy}
                        tooltip="修改试卷"
                      >
                        <Pencil className="h-4 w-4" />
                      </TooltipButton>
                      {rootKnowledgePointId ? (
                        <TooltipButton
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            navigate(`/papers/${paper.id}/knowledge-coverage`, {
                              state: {
                                ...detailNavState,
                                backTo:
                                  detailNavState?.backTo ??
                                  `${location.pathname}${location.search}`,
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
                      <TooltipProvider delayDuration={150}>
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={isBusy}
                                    aria-label="生成试卷"
                                  >
                                    <Sparkles className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>试卷衍生与 AI 重组</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end" className="w-56">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={isBusy}
                                  onSelect={() => handleCopy(paper)}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  复制试卷
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                复制试卷（保留题目与分值）
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={isBusy || Boolean(paper.archived_at)}
                                  onSelect={() => setAiDialogPaper(paper)}
                                >
                                  <Sparkles className="mr-2 h-4 w-4" />
                                  AI 生成新试卷
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                按本卷结构 AI 仿编新卷
                              </TooltipContent>
                            </Tooltip>
                            {courseQuestionBankName ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuItem
                                    disabled={
                                      isBusy || Boolean(paper.archived_at)
                                    }
                                    onSelect={() =>
                                      setExpandDialogPaper(paper)
                                    }
                                  >
                                    <ListPlus className="mr-2 h-4 w-4" />
                                    扩充生成试卷
                                  </DropdownMenuItem>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  保留已有题目并扩充题量
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TooltipProvider>
                      <TooltipProvider delayDuration={150}>
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={
                                      isBusy ||
                                      publishLoading ||
                                      Boolean(paper.archived_at) ||
                                      paper.question_count === 0
                                    }
                                    aria-label="发布"
                                  >
                                    <Send className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>发布</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end" className="w-44">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={
                                    isBusy ||
                                    Boolean(paper.archived_at) ||
                                    paper.question_count === 0
                                  }
                                  onSelect={() =>
                                    void handleOpenPublish(paper, "practice")
                                  }
                                >
                                  <Send className="mr-2 h-4 w-4" />
                                  发布练习
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                用这份试卷发布练习
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={
                                    isBusy ||
                                    Boolean(paper.archived_at) ||
                                    paper.question_count === 0
                                  }
                                  onSelect={() =>
                                    void handleOpenPublish(paper, "exam")
                                  }
                                >
                                  <FilePlus2 className="mr-2 h-4 w-4" />
                                  发布考试
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                用这份试卷创建并发布考试
                              </TooltipContent>
                            </Tooltip>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TooltipProvider>
                      {rootKnowledgePointId ? (
                        <TooltipProvider delayDuration={150}>
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
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
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>导出试卷 (Word / JSON)</TooltipContent>
                          </Tooltip>
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
                        </TooltipProvider>
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

      {expandDialogPaper ? (
        <PaperExpandDialog
          open={Boolean(expandDialogPaper)}
          onOpenChange={(open) => {
            if (!open) setExpandDialogPaper(null);
          }}
          paper={expandDialogPaper}
          courseQuestionBankName={courseQuestionBankName}
          generatedPaperState={detailNavState}
        />
      ) : null}

      {publishTarget && publishDetail ? (
        <PaperQuickPublishDialog
          open
          mode={publishTarget.mode}
          paper={publishDetail}
          courseKpId={
            detailNavState?.courseKpId ?? rootKnowledgePointId ?? undefined
          }
          courseSemesterId={detailNavState?.courseSemesterId}
          defaultClassIds={detailNavState?.defaultClassIds}
          semesterOptions={detailNavState?.courseSemesters}
          onOpenChange={(open) => {
            if (!open) {
              setPublishTarget(null);
              setPublishDetail(null);
            }
          }}
          onPublished={() => {
            const successTo =
              publishTarget.mode === "practice"
                ? detailNavState?.publishPracticeSuccessTo
                : detailNavState?.publishExamSuccessTo;
            setPublishTarget(null);
            setPublishDetail(null);
            if (successTo) {
              navigate(successTo);
            } else {
              void query.refetch();
            }
          }}
        />
      ) : null}
    </div>
  );
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
  const typeLabel = getQuestionDisplayTypeLabel(question);
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
  // 题库浏览：左侧题型、右侧题目；试卷篮展示当前试卷题目。
  const [bankPageQuestions, setBankPageQuestions] = useState<IQuestion[]>([]);
  const [bankQuestionCache, setBankQuestionCache] = useState<
    Map<string, IQuestion>
  >(() => new Map());
  const [bankTypeCounts, setBankTypeCounts] = useState<
    Array<[QuestionDisplayType, number]>
  >([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankGrandTotal, setBankGrandTotal] = useState(0);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankType, setBankType] = useState<QuestionDisplayType | "all">("all");
  const [bankSearch, setBankSearch] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(BANK_PAGE_SIZE);
  const [bankJump, setBankJump] = useState("");
  const [basketOpen, setBasketOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scoreEdited, setScoreEdited] = useState(false);
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("type");
  const [scoreItems, setScoreItems] = useState<ExamQuestionFormItem[]>([]);
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<string, string>>
  >({});
  const [basketType, setBasketType] = useState<QuestionDisplayType | "all">(
    "all",
  );
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [basketPulse, setBasketPulse] = useState(false);
  const [flyChip, setFlyChip] = useState<{
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const [flyActive, setFlyActive] = useState(false);
  const basketButtonRef = useRef<HTMLButtonElement>(null);

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
        setScoreItems(buildPaperScoreItems(value));
        setTypeScoreDrafts({});
        setScoreEdited(false);
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


  const canAIAppend = Boolean(detail && detail.questions.length > 0 && !detail.archived_at);
  const courseBank =
    ensuredCourseBank ??
    (courseQuestionBankName
      ? banks.find((bank) => bank.name === courseQuestionBankName)
      : null) ??
    null;

  // 题型总数：走后端聚合接口，避免把整个题库拉回前端计数。
  useEffect(() => {
    if (!courseBank?.id) {
      setBankTypeCounts([]);
      setBankTotal(0);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ question_bank_id: courseBank.id });
    paperApiRequest<Array<{ type: string; count: number }>>(
      `/questions/type-distribution?${params}`,
    )
      .then((rows) => {
        if (cancelled) return;
        const counts = new Map<QuestionDisplayType, number>();
        for (const row of rows) {
          const type = row.type as QuestionDisplayType;
          if (!QUESTION_DISPLAY_TYPE_ORDER.includes(type)) continue;
          counts.set(type, (counts.get(type) ?? 0) + row.count);
        }
        setBankTypeCounts(
          QUESTION_DISPLAY_TYPE_ORDER.filter((type) => counts.has(type)).map(
            (type) => [type, counts.get(type)!] as const,
          ),
        );
        const grandTotal = [...counts.values()].reduce(
          (sum, count) => sum + count,
          0,
        );
        setBankGrandTotal(grandTotal);
        setBankTotal(grandTotal);
      })
      .catch(() => {
        if (!cancelled) {
          setBankTypeCounts([]);
          setBankTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseBank?.id, selectorRefreshKey]);

  // 题目列表：服务端分页 + 题型/搜索筛选，避免一次加载整个题库。
  useEffect(() => {
    if (!courseBank?.id) {
      setBankPageQuestions([]);
      return;
    }
    let cancelled = false;
    setBankLoading(true);
    const params = new URLSearchParams({
      _start: String((safeBankPage - 1) * bankPageSize),
      _end: String(safeBankPage * bankPageSize),
      question_bank_id: courseBank.id,
    });
    const keyword = bankSearch.trim();
    if (keyword) params.set("search_text", keyword);
    if (bankType === "single_choice") {
      params.set("type", "choice");
      params.set("multi", "false");
    } else if (bankType === "multi_choice") {
      params.set("type", "choice");
      params.set("multi", "true");
    } else if (bankType !== "all") {
      params.set("type", bankType);
    }
    paperApiList<IQuestion[]>(`/questions?${params}`)
      .then(({ data, total }) => {
        if (cancelled) return;
        setBankPageQuestions(data);
        if (total != null) setBankTotal(total);
        setBankQuestionCache((prev) => {
          const next = new Map(prev);
          for (const question of data) next.set(question.id, question);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setBankPageQuestions([]);
      })
      .finally(() => {
        if (!cancelled) setBankLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankPage, bankPageSize, bankSearch, bankType, courseBank?.id, selectorRefreshKey]);

  useEffect(() => {
    setBankPage(1);
  }, [bankType, bankSearch]);

  const bankPageCount = Math.max(1, Math.ceil(bankTotal / bankPageSize));
  const safeBankPage = Math.min(bankPage, bankPageCount);

  // 试卷篮：当前试卷里的题目（含刚加入、还没保存的）。
  const questionById = useMemo(() => {
    const map = new Map<string, IQuestion>();
    for (const item of detail?.questions ?? []) {
      if (item.question) map.set(item.question_id, item.question);
    }
    for (const [id, question] of bankQuestionCache) {
      map.set(id, question);
    }
    return map;
  }, [bankQuestionCache, detail]);

  const basketItems = useMemo(
    () =>
      selectedIds.map((id) => ({
        id,
        question: questionById.get(id) ?? null,
      })),
    [questionById, selectedIds],
  );

  /** 左侧题型各有多少道已在试卷里，便于边挑边看配比。 */
  const selectedTypeCounts = useMemo(() => {
    const counts = new Map<QuestionDisplayType, number>();
    for (const id of selectedIds) {
      const question = questionById.get(id);
      if (!question) continue;
      const displayType = getQuestionDisplayType(question);
      if (!displayType) continue;
      counts.set(displayType, (counts.get(displayType) ?? 0) + 1);
    }
    return counts;
  }, [questionById, selectedIds]);

  // 设置分数：沿用试卷详情里的评分面板，面板数据跟随当前试卷题目。
  const scoreItemById = useMemo(
    () => new Map(scoreItems.map((item) => [item.question_id, item])),
    [scoreItems],
  );

  const panelScoreItems: ExamQuestionFormItem[] = useMemo(
    () =>
      selectedIds.map((id, index) => {
        const existing = scoreItemById.get(id);
        const question = questionById.get(id);
        return {
          question_id: id,
          order: index,
          score_override: existing?.score_override ?? question?.score ?? 0,
          source_exam_id: null,
          source_question_id: null,
        };
      }),
    [questionById, scoreItemById, selectedIds],
  );

  const scoreQuestions = useMemo(
    () =>
      selectedIds
        .map((id) => questionById.get(id))
        .filter((question): question is IQuestion => Boolean(question)),
    [questionById, selectedIds],
  );

  const scorePreviewItems = useMemo(
    () => buildPaperPreviewItems(panelScoreItems, scoreQuestions),
    [panelScoreItems, scoreQuestions],
  );

  const scoreTypeSummaries = useMemo(
    () => buildQuestionTypeSummaries(scorePreviewItems, { splitChoice: true }),
    [scorePreviewItems],
  );

  const scoreTotal = totalPaperScore(panelScoreItems);

  const handleQuestionScoreChange = (questionId: string, value: string) => {
    const parsed = Number(value);
    const nextScore = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setScoreItems((prev) => {
      const map = new Map(prev.map((item) => [item.question_id, item]));
      map.set(questionId, {
        question_id: questionId,
        order: itemById.get(questionId)?.order ?? map.size,
        score_override: nextScore,
        source_exam_id: null,
        source_question_id: null,
      });
      return [...map.values()];
    });
    setScoreEdited(true);
  };

  const handleApplyTypeScore = (
    summary: QuestionTypeSummary,
    value?: string,
  ) => {
    const rawValue =
      value ?? typeScoreDrafts[summary.key ?? summary.type] ?? "";
    // 清空输入框时不要弹出错误提示。
    if (String(rawValue).trim() === "") return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({
        title: "题型总分无效",
        description: "题型总分必须大于 0。",
        variant: "destructive",
      });
      return;
    }
    setScoreItems((prev) => {
      const next = applyPaperTypeScoreAllocation(
        panelScoreItems,
        summary,
        parsed,
      );
      const map = new Map(prev.map((item) => [item.question_id, item]));
      for (const item of next) map.set(item.question_id, item);
      return [...map.values()];
    });
    setScoreEdited(true);
  };

  const basketTypeRows = useMemo(() => {
    const counts = new Map<QuestionDisplayType, number>();
    for (const item of basketItems) {
      const displayType = item.question
        ? getQuestionDisplayType(item.question)
        : null;
      if (!displayType) continue;
      counts.set(displayType, (counts.get(displayType) ?? 0) + 1);
    }
    return QUESTION_DISPLAY_TYPE_ORDER.filter((type) => counts.has(type)).map(
      (type) => [type, counts.get(type)!] as const,
    );
  }, [basketItems]);

  const visibleBasketItems = basketItems.filter(
    (item) =>
      basketType === "all" ||
      (item.question ? getQuestionDisplayType(item.question) : null) ===
        basketType,
  );

  const flyToBasket = (fromEl: HTMLElement | null) => {
    const target = basketButtonRef.current;
    if (!fromEl || !target) return;
    const from = fromEl.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const startX = from.left + from.width / 2 - 10;
    const startY = from.top + from.height / 2 - 10;
    const endX = to.left + to.width / 2 - 10;
    const endY = to.top + to.height / 2 - 10;
    setFlyChip({
      x: startX,
      y: startY,
      dx: endX - startX,
      dy: endY - startY,
    });
    setFlyActive(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlyActive(true));
    });
    window.setTimeout(() => setFlyChip(null), 520);
    setBasketPulse(true);
    window.setTimeout(() => setBasketPulse(false), 500);
  };

  const removeWithAnimation = (questionId: string) => {
    setRemovingIds((prev) => new Set(prev).add(questionId));
    window.setTimeout(() => {
      removeQuestion(questionId);
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }, 180);
  };

  const toggleQuestion = (question: IQuestion, fromEl: HTMLElement | null) => {
    if (selectedIds.includes(question.id)) {
      removeWithAnimation(question.id);
      return;
    }
    flyToBasket(fromEl);
    updateSelectedIds([...selectedIds, question.id]);
  };

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
          const scored = scoreItemById.get(questionId);
          return {
            question_id: questionId,
            order: index,
            score_override:
              scored?.score_override ?? existing?.score_override ?? null,
          };
        }),
      }),
    });
    setDetail(updated);
    setTitle(updated.title);
    setScoreItems(buildPaperScoreItems(updated));
    setTypeScoreDrafts({});
    setScoreEdited(false);
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
            修改试卷名称，从课程题库增删题目；右侧「试卷篮」可随时查看当前试卷的题目。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载试卷...
          </div>
        ) : detail ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Input
                id="paper-edit-title"
                className="h-9 w-full max-w-xs"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="请输入试卷名称"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualAddOpen(true)}
              >
                <Plus className="h-4 w-4" />
                添加题目
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setScoreOpen(true)}
              >
                <Calculator className="h-4 w-4" />
                设置分数
              </Button>
              {renderAIAppendPopover()}
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 w-52 pl-8"
                  value={bankSearch}
                  onChange={(event) => setBankSearch(event.target.value)}
                  placeholder="搜索题目"
                  aria-label="搜索题库题目"
                />
              </div>
              <Button
                ref={basketButtonRef}
                type="button"
                size="sm"
                className={cn(
                  "shrink-0 transition-shadow",
                  basketPulse && "ring-2 ring-primary/50",
                )}
                onClick={() => setBasketOpen(true)}
              >
                <ShoppingBasket className="h-4 w-4" />
                试卷篮
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-semibold tabular-nums">
                  {selectedIds.length}
                </span>
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-[200px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border/60 p-1.5">
                <button
                  type="button"
                  onClick={() => setBankType("all")}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    bankType === "all"
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className="whitespace-nowrap">全部题型</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                    {selectedIds.length > 0 ? (
                      <>
                        <span className="font-medium text-primary">
                          已选 {selectedIds.length}
                        </span>
                        <span className="text-muted-foreground/60">/</span>
                      </>
                    ) : null}
                    <span>{bankGrandTotal}</span>
                  </span>
                </button>
                {bankTypeCounts.map(([type, count]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setBankType(type)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      bankType === type
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span className="truncate">
                      {questionDisplayTypeFullLabel[type]}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
                      {(selectedTypeCounts.get(type) ?? 0) > 0 ? (
                        <>
                          <span className="font-medium text-primary">
                            已选 {selectedTypeCounts.get(type)}
                          </span>
                          <span className="text-muted-foreground/60">/</span>
                        </>
                      ) : null}
                      <span>{count}</span>
                    </span>
                  </button>
                ))}
              </aside>

              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/60">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {bankType === "all"
                      ? "全部题型"
                      : questionDisplayTypeFullLabel[bankType]}
                    {" · "}
                    {bankTotal} 题
                  </span>
                  <span className="shrink-0">点「加入 / 已加入」增删</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {bankLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在加载题库...
                    </div>
                  ) : !courseBank ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      {ensuringCourseBank ? "正在准备课程题库..." : "课程题库未就绪"}
                    </div>
                  ) : bankPageQuestions.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      没有符合条件的题目
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {bankPageQuestions.map((question, index) => {
                          const inPaper = selectedIds.includes(question.id);
                          const removing = removingIds.has(question.id);
                          return (
                            <QuestionPreviewCard
                              key={question.id}
                              question={question}
                              index={
                                (safeBankPage - 1) * bankPageSize + index + 1
                              }
                              expandOnClick
                              hideAnswer
                              markChoiceAnswer
                              className={cn(
                                "transition-all duration-200",
                                inPaper
                                  ? "border-primary/50 bg-primary/5"
                                  : "hover:border-primary/50",
                                removing && "scale-[0.98] opacity-0",
                              )}
                              trailing={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={inPaper ? "secondary" : "outline"}
                                  className="h-7 shrink-0 px-2 text-xs"
                                  onClick={(event) =>
                                    toggleQuestion(question, event.currentTarget)
                                  }
                                >
                                  {inPaper ? "已加入" : "加入"}
                                </Button>
                              }
                            />
                          );
                        })}
                      </div>

                    </>
                  )}
                </div>
                {!bankLoading && courseBank && bankPageQuestions.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <span>每页</span>
                      <Select
                        value={String(bankPageSize)}
                        onValueChange={(value) => {
                          setBankPageSize(Number(value));
                          setBankPage(1);
                          setBankJump("");
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-[72px] text-xs"
                          aria-label="每页题目数量"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BANK_PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem
                              key={size}
                              value={String(size)}
                              className="text-xs"
                            >
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span>题</span>
                    </label>
                    <span className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={safeBankPage <= 1}
                        onClick={() => setBankPage(safeBankPage - 1)}
                      >
                        上一页
                      </Button>
                      <span className="tabular-nums">
                        {safeBankPage} / {bankPageCount}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={safeBankPage >= bankPageCount}
                        onClick={() => setBankPage(safeBankPage + 1)}
                      >
                        下一页
                      </Button>
                    </span>
                    {bankPageCount > 1 ? (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const next = Number(bankJump.trim());
                          if (!Number.isFinite(next) || next <= 0) return;
                          setBankPage(
                            Math.min(bankPageCount, Math.max(1, Math.floor(next))),
                          );
                          setBankJump("");
                        }}
                      >
                        <span>跳至</span>
                        <Input
                          className="h-8 w-12 text-center text-xs"
                          inputMode="numeric"
                          value={bankJump}
                          onChange={(event) =>
                            setBankJump(event.target.value.replace(/[^\d]/g, ""))
                          }
                          aria-label="跳转到指定页"
                        />
                        <span>页</span>
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          disabled={!bankJump.trim()}
                        >
                          跳转
                        </Button>
                      </form>
                      ) : null}
                    </div>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}

        {flyChip ? (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[70] h-5 w-5 rounded-full bg-primary shadow-md transition-transform duration-500 ease-out"
            style={{
              left: flyChip.x,
              top: flyChip.y,
              transform: flyActive
                ? `translate(${flyChip.dx}px, ${flyChip.dy}px) scale(0.4)`
                : "translate(0, 0) scale(1)",
            }}
          />
        ) : null}

        {basketOpen ? (
          <div
            className="fixed inset-0 z-[60] flex justify-end bg-black/30"
            onClick={() => setBasketOpen(false)}
          >
            <div
              className="flex h-full w-full flex-col bg-background shadow-2xl sm:w-1/2"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">试卷篮</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    已选 {selectedIds.length} 题 · 试卷共 {detail?.questions.length ?? 0} 题
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="关闭试卷篮"
                  onClick={() => setBasketOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-[132px_minmax(0,1fr)]">
                <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-1.5">
                  <button
                    type="button"
                    onClick={() => setBasketType("all")}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      basketType === "all"
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span>全部</span>
                    <span className="text-xs tabular-nums">{basketItems.length}</span>
                  </button>
                  {basketTypeRows.map(([type, count]) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setBasketType(type)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                        basketType === type
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span className="truncate">
                        {questionDisplayTypeFullLabel[type]}
                      </span>
                      <span className="text-xs tabular-nums">{count}</span>
                    </button>
                  ))}
                </aside>
                <section className="min-h-0 overflow-y-auto p-2">
                  {visibleBasketItems.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      试卷篮还是空的
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleBasketItems.map((item, index) =>
                        item.question ? (
                          <QuestionPreviewCard
                            key={item.id}
                            question={item.question}
                            scoreOverride={
                              scoreItemById.get(item.id)?.score_override ?? null
                            }
                            index={selectedIds.indexOf(item.id) + 1}
                            expandOnClick
                            hideAnswer
                            markChoiceAnswer
                            className={cn(
                              "transition-all duration-200",
                              removingIds.has(item.id) &&
                                "scale-[0.98] opacity-0",
                              recentlyReplacedQuestionId === item.id &&
                                "animate-in fade-in-0 duration-200",
                            )}
                            actionsPlacement="header"
                            actions={
                              <div className="flex items-center gap-1">
                                <TooltipButton
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={Boolean(replacingQuestionId)}
                                  onClick={() =>
                                    void handleReplaceQuestion({
                                      question_id: item.id,
                                      question: item.question as IQuestion,
                                      order: index,
                                      score_override: null,
                                    } as IPaperQuestion)
                                  }
                                  tooltip="换一题"
                                >
                                  {replacingQuestionId === item.id ? (
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
                                  onClick={() => removeWithAnimation(item.id)}
                                  tooltip="从试卷中移除"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </TooltipButton>
                              </div>
                            }
                          />
                        ) : (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3 transition-all duration-200",
                              removingIds.has(item.id) &&
                                "scale-[0.98] opacity-0",
                            )}
                          >
                            <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                              {index + 1}.
                            </span>
                            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                              题目已不存在
                            </p>
                            <TooltipButton
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => removeWithAnimation(item.id)}
                              tooltip="从试卷中移除"
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </TooltipButton>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>
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
      <Dialog open={scoreOpen} onOpenChange={setScoreOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>设置分数</DialogTitle>
            <DialogDescription>
              支持逐题微调，也可以按题型设置总分并均分到每题；点「应用分数」后再保存试卷。
            </DialogDescription>
          </DialogHeader>
          <PaperScorePanel
            items={scorePreviewItems}
            questionItems={panelScoreItems}
            mode={scoreMode}
            onModeChange={setScoreMode}
            onQuestionScoreChange={handleQuestionScoreChange}
            questionTypeSummaries={scoreTypeSummaries}
            typeScoreDrafts={typeScoreDrafts}
            onTypeDraftChange={(type, value) =>
              setTypeScoreDrafts((prev) => ({ ...prev, [type]: value }))
            }
            onApplyTypeScore={handleApplyTypeScore}
            totalScore={scoreTotal}
            dirty={scoreEdited}
            saving={false}
            onSave={() => setScoreOpen(false)}
            title={`总题量 ${selectedIds.length} 题`}
            description="直接输入分数即可自动均分；保存试卷后生效。"
            saveLabel="应用分数"
            compact
            autoApply
          />
        </DialogContent>
      </Dialog>

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
