import { useEffect, useMemo, useRef, useState } from "react";
import { useOne } from "@refinedev/core";
import {
  Copy,
  FilePlus2,
  Filter,
  Hash,
  Layers,
  List,
  Loader2,
  Send,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/ui/tooltip-button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import type { IPaperDetail, QuestionType } from "@/types";
import type { ExamQuestionFormItem } from "@/pages/exams/components/exam-form-utils";
import {
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
  getPaperQuestionAnchorId,
  type QuestionTypeSummary,
} from "@/pages/exams/components/paper-view-utils";
import {
  PaperScorePanel,
  type ScoreViewMode,
} from "@/pages/exams/components/PaperScorePanel";

import { paperApiRequest } from "./api";
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
  publishExamSuccessTo?: string;
  publishPracticeSuccessTo?: string;
};

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getQuestionTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type;
}

export function PaperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as PaperDetailNavState;
  const backTo = navState.backTo ?? "/papers";
  const backLabel = navState.backLabel ?? "返回试卷列表";
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [quickPublishMode, setQuickPublishMode] = useState<PaperQuickPublishMode | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [scoreDrawerOpen, setScoreDrawerOpen] = useState(false);
  const [currentPaper, setCurrentPaper] = useState<IPaperDetail | null>(null);
  const [scoreItems, setScoreItems] = useState<ExamQuestionFormItem[]>([]);
  const [initialScoreItems, setInitialScoreItems] = useState<ExamQuestionFormItem[]>([]);
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("order");
  const [pendingJumpQuestionId, setPendingJumpQuestionId] = useState<string | null>(null);
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<QuestionType, string>>
  >({});
  const [scoreSaving, setScoreSaving] = useState(false);
  const typeScoreDraftDefaultsRef = useRef<
    Partial<Record<QuestionType, string>>
  >({});

  const { result: fetchedPaper, query } = useOne<IPaperDetail>({
    resource: "papers",
    id: id!,
    queryOptions: { enabled: Boolean(id) },
  });

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
    () => buildQuestionTypeSummaries(previewItems),
    [previewItems],
  );

  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<QuestionType, string>>>(
        (acc, summary) => {
          acc[summary.type] =
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
        Partial<Record<QuestionType, string>>
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

  const scoreItemByQuestionId = useMemo(
    () => new Map(scoreItems.map((item) => [item.question_id, item])),
    [scoreItems],
  );

  const scoreDirty = !arePaperScoreItemsEqual(scoreItems, initialScoreItems);
  const scoreTotal = totalPaperScore(scoreItems);

  const typeBuckets = useMemo(() => {
    if (!currentPaper) return [] as Array<{ type: string; count: number; totalScore: number }>;
    const map = new Map<string, { type: string; count: number; totalScore: number }>();
    for (const item of currentPaper.questions) {
      const key = item.question?.type ?? "unknown";
      const bucket = map.get(key) ?? { type: key, count: 0, totalScore: 0 };
      bucket.count += 1;
      bucket.totalScore += scoreItemByQuestionId.get(item.question_id)?.score_override ?? 0;
      map.set(key, bucket);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [currentPaper, scoreItemByQuestionId]);

  const filteredQuestions = useMemo(() => {
    if (!currentPaper) return [];
    if (selectedTypes.size === 0) return currentPaper.questions;
    return currentPaper.questions.filter((item) => selectedTypes.has(item.question?.type ?? "unknown"));
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
    const parsed = Number(typeScoreDrafts[summary.type]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({
        title: "题型总分无效",
        description: `${getQuestionTypeLabel(summary.type)}的总分必须大于 0。`,
        variant: "destructive",
      });
      return;
    }
    setScoreItems((prev) => applyPaperTypeScoreAllocation(prev, summary, parsed));
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
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleExpand = (questionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  const jumpToQuestion = (questionId: string) => {
    setExpandedIds((prev) => new Set(prev).add(questionId));
    setSelectedTypes(new Set());
    setPendingJumpQuestionId(questionId);
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
        fullBleed
        className="mb-6"
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
              onClick={() => setQuickPublishMode("practice")}
              disabled={archived || currentPaper.questions.length === 0}
              tooltip="基于当前试卷快速发布一次练习"
            >
              <Send className="h-4 w-4" />
              发布练习
            </TooltipButton>
            <TooltipButton
              size="sm"
              onClick={() => setQuickPublishMode("exam")}
              disabled={archived || currentPaper.questions.length === 0}
              tooltip="基于当前试卷快速创建一场考试"
            >
              <FilePlus2 className="h-4 w-4" />
              创建考试
            </TooltipButton>
            <TooltipButton
              variant="outline"
              size="sm"
              onClick={handleBack}
              tooltip={backLabel}
            >
              <List className="h-4 w-4" />
              返回列表
            </TooltipButton>
          </div>
        }
      />

      <div className="grid gap-6 px-4 pb-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left rail: filters & meta */}
        <aside className="space-y-5">
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
                  const active = selectedTypes.has(bucket.type);
                  return (
                    <li key={bucket.type}>
                      <button
                        type="button"
                        onClick={() => toggleType(bucket.type)}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground hover:bg-muted/60"
                        }`}
                      >
                        <span className="truncate">{getQuestionTypeLabel(bucket.type)}</span>
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
                        {getQuestionTypeLabel(type)}
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
                    <button
                      key={item.question_id}
                      id={getPaperQuestionAnchorId(item.question_id)}
                      type="button"
                      onClick={() => toggleExpand(item.question_id)}
                      className="block w-full text-left"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "收起" : "展开"}第 ${index + 1} 题`}
                    >
                      <QuestionPreviewCard
                        question={{ ...item.question, score }}
                        mode="detailed"
                        expanded={isExpanded}
                        index={index + 1}
                        className="transition-colors hover:border-primary/30 hover:bg-muted/20"
                      />
                    </button>
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
