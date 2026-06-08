import { useEffect, useMemo, useRef, useState } from "react";
import { useGetIdentity, useList, useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { FilePenLine, ListOrdered, Loader2, Plus, Sparkles } from "lucide-react";

import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import type {
  IExam,
  IExamQuestion,
  IExamStudent,
  IQuestion,
  QuestionType,
} from "@/types";

import { ExamStatusBadge } from "./components/ExamStatusBadge";
import {
  getErrorMessage,
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

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [questionItems, setQuestionItems] = useState<ExamQuestionFormItem[]>(
    [],
  );
  const [initialQuestionItems, setInitialQuestionItems] = useState<
    ExamQuestionFormItem[]
  >([]);
  const [questionOverrides, setQuestionOverrides] = useState<Record<string, IQuestion>>({});
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("order");
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<
    Partial<Record<QuestionType, string>>
  >({});
  const [savingTarget, setSavingTarget] = useState<
    "settings" | "scores" | null
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
  const [isAddQuestionFullscreen, setIsAddQuestionFullscreen] = useState(false);
  const typeScoreDraftDefaultsRef = useRef<
    Partial<Record<QuestionType, string>>
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
  const addQuestionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters:
      addQuestionIds.length > 0
        ? [{ field: "id", operator: "in" as const, value: addQuestionIds }]
        : [],
    queryOptions: { enabled: addQuestionIds.length > 0 },
  });

  useEffect(() => {
    if (!exam) return;
    const nextSettings = toSettingsValues(exam);
    const nextQuestionItems = toQuestionItems(exam);
    setSettings(nextSettings);
    setInitialSettings(nextSettings);
    setQuestionItems(nextQuestionItems);
    setInitialQuestionItems(nextQuestionItems);
    setQuestionOverrides({});
    setMockQuestionCount(String(nextQuestionItems.length));
    setMockReuseRate("80");
    setMockTitle(`${exam.title} - 模拟试卷`);
    setHydrated(true);
  }, [exam]);

  const previewItems = useMemo(
    () => {
      const questions = (questionQuery.query.data?.data ?? []).map(
        (question) => questionOverrides[question.id] ?? question,
      );
      return buildPaperPreviewItems(questionItems, questions);
    },
    [questionItems, questionOverrides, questionQuery.query.data?.data],
  );
  const questionTypeSummaries = useMemo(
    () => buildQuestionTypeSummaries(previewItems),
    [previewItems],
  );
  const questionJumpGroups = useMemo(
    () => buildQuestionJumpGroups(previewItems, questionTypeSummaries),
    [previewItems, questionTypeSummaries],
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

  const effectiveStatus = exam ? getEffectiveExamStatus(exam) : "draft";
  const categoryLabel = exam?.category === "practice" ? "练习" : "考试";
  const showInvitations =
    identity?.primary_org?.org_type === "enterprise" &&
    exam?.category === "exam";
  const selectedKnowledgePoints = useMemo(
    () =>
      Array.from(
        new Map(
          (questionQuery.query.data?.data ?? [])
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
      ),
    [questionQuery.query.data?.data],
  );

  const totalScore = useMemo(
    () =>
      questionItems.reduce(
        (sum, item) => sum + (Number(item.score_override) || 0),
        0,
      ),
    [questionItems],
  );

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

  const handleOpenAddQuestions = () => {
    setAddQuestionIds([]);
    setAddQuestionsOpen(true);
  };

  const handleAddQuestionsOpenChange = (open: boolean) => {
    setAddQuestionsOpen(open);
    if (!open) {
      setAddQuestionIds([]);
      setIsAddQuestionFullscreen(false);
    }
  };

  const handleConfirmAddQuestions = () => {
    const existingSet = new Set(questionItems.map((item) => item.question_id));
    const nextIds = addQuestionIds.filter((questionId) => !existingSet.has(questionId));
    if (nextIds.length === 0) {
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
    toast({
      title: "题目已添加",
      description: `已追加 ${nextIds.length} 道题，系统会自动保存到当前考试。`,
    });
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

  if (query.isLoading || !exam || !hydrated || questionQuery.query.isLoading) {
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
        description={`${categoryLabel}查看 · 左侧按标准试卷格式查看完整内容，右侧适合做分数与设置的轻量调整。`}
        onBack={() => navigate("/exams")}
        backLabel="返回考试列表"
        fullBleed
        actions={
          <div className="flex items-center gap-2">
            {exam.category === "exam" ? (
              <Button variant="default" onClick={handleOpenMockDialog}>
                <Sparkles className="h-4 w-4" />
                生成模拟卷
              </Button>
            ) : null}
            <Button variant="outline" onClick={handleOpenAddQuestions}>
              <Plus className="h-4 w-4" />
              添加题目
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate(
                  exam.category === "practice"
                    ? `/exams/practice/edit/${exam.id}`
                    : `/exams/edit/${exam.id}`,
                )
              }
            >
              <FilePenLine className="h-4 w-4" />
              进入编辑
            </Button>
          </div>
        }
      />

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
        <DialogContent className="flex max-h-[90vh] w-[min(1180px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 pr-12">
            <DialogTitle>手动添加题目</DialogTitle>
            <DialogDescription>
              选择要追加到当前考试末尾的题目；已存在于本考试中的题目会自动忽略。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <QuestionSelector
              selectedIds={addQuestionIds}
              onChange={setAddQuestionIds}
              knowledgePointOptions={selectedKnowledgePoints}
              showSummary={false}
              isFullscreen={isAddQuestionFullscreen}
              onFullscreenChange={setIsAddQuestionFullscreen}
            />
          </div>
          <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
            <Button
              variant="outline"
              onClick={() => handleAddQuestionsOpenChange(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmAddQuestions}
              disabled={
                addQuestionIds.length === 0 || addQuestionQuery.query.isLoading
              }
            >
              <Plus className="h-4 w-4" />
              添加 {addQuestionIds.length} 题
            </Button>
          </DialogFooter>
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
              setTypeScoreDrafts((prev) => ({
                ...prev,
                [summary.type]: value,
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

          <PaperSummarySidebar title="考试摘要">
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
                      key={group.summary.type}
                      className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-0"
                    >
                      <span className="pt-1 text-xs font-medium text-muted-foreground">
                        {questionTypeLabels[group.summary.type]}
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
