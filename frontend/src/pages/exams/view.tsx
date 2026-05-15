import { useEffect, useMemo, useRef, useState } from "react";
import { useGetIdentity, useList, useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import { FilePenLine, List, Loader2 } from "lucide-react";

import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { IExam, IExamQuestion, IExamStudent, IQuestion, QuestionType } from "@/types";

import { ExamStatusBadge } from "./components/ExamStatusBadge";
import { getErrorMessage, type ExamQuestionFormItem } from "./components/exam-form-utils";
import { ExamSettingsPanel, type ViewSettingsValues } from "./components/ExamSettingsPanel";
import { PaperPreview } from "./components/PaperPreview";
import type { ScoreViewMode } from "./components/PaperScorePanel";
import { PaperSummarySidebar } from "./components/PaperSummarySidebar";
import { InvitationManagement } from "./components/InvitationManagement";
import {
  buildEvenScoreAllocation,
  buildPaperPreviewItems,
  buildQuestionTypeSummaries,
  type QuestionTypeSummary,
} from "./components/paper-view-utils";
import { getEffectiveExamStatus } from "./utils";

type ExamViewDetail = IExam & {
  questions: IExamQuestion[];
  students: IExamStudent[];
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  }));
}

function areQuestionItemsEqual(left: ExamQuestionFormItem[], right: ExamQuestionFormItem[]) {
  return JSON.stringify(
    [...left].sort((a, b) => a.order - b.order).map((item) => ({
      question_id: item.question_id,
      order: item.order,
      score_override: item.score_override,
    })),
  ) === JSON.stringify(
    [...right].sort((a, b) => a.order - b.order).map((item) => ({
      question_id: item.question_id,
      order: item.order,
      score_override: item.score_override,
    })),
  );
}

export function ExamPaperViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { mutate: update, mutation } = useUpdate();
  const { data: identity } = useGetIdentity<{ primary_org?: { org_type?: string } | null }>();

  const { result: exam, query } = useOne<ExamViewDetail>({
    resource: "exams",
    id: id!,
  });

  const [settings, setSettings] = useState<ViewSettingsValues | null>(null);
  const [initialSettings, setInitialSettings] = useState<ViewSettingsValues | null>(null);
  const [questionItems, setQuestionItems] = useState<ExamQuestionFormItem[]>([]);
  const [initialQuestionItems, setInitialQuestionItems] = useState<ExamQuestionFormItem[]>([]);
  const [scoreMode, setScoreMode] = useState<ScoreViewMode>("order");
  const [typeScoreDrafts, setTypeScoreDrafts] = useState<Partial<Record<QuestionType, string>>>({});
  const [savingTarget, setSavingTarget] = useState<"settings" | "scores" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const typeScoreDraftDefaultsRef = useRef<Partial<Record<QuestionType, string>>>({});

  const questionIds = useMemo(() => questionItems.map((item) => item.question_id), [questionItems]);
  const questionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters: questionIds.length > 0 ? [{ field: "id", operator: "in" as const, value: questionIds }] : [],
    queryOptions: { enabled: questionIds.length > 0 },
  });

  useEffect(() => {
    if (!exam) return;
    const nextSettings = toSettingsValues(exam);
    const nextQuestionItems = toQuestionItems(exam);
    setSettings(nextSettings);
    setInitialSettings(nextSettings);
    setQuestionItems(nextQuestionItems);
    setInitialQuestionItems(nextQuestionItems);
    setHydrated(true);
  }, [exam]);

  const previewItems = useMemo(
    () => buildPaperPreviewItems(questionItems, questionQuery.query.data?.data ?? []),
    [questionItems, questionQuery.query.data?.data],
  );

  const questionTypeSummaries = useMemo(
    () => buildQuestionTypeSummaries(previewItems),
    [previewItems],
  );

  const questionTypeDraftDefaults = useMemo(
    () =>
      questionTypeSummaries.reduce<Partial<Record<QuestionType, string>>>((acc, summary) => {
        acc[summary.type] = summary.totalScore > 0 ? String(summary.totalScore) : "";
        return acc;
      }, {}),
    [questionTypeSummaries],
  );

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

  const effectiveStatus = exam ? getEffectiveExamStatus(exam) : "draft";
  const categoryLabel = exam?.category === "practice" ? "练习" : "考试";
  const showInvitations = identity?.primary_org?.org_type === "enterprise" && exam?.category === "exam";
  const selectedKnowledgePoints = useMemo(
    () =>
      Array.from(
        new Map(
          (questionQuery.query.data?.data ?? [])
            .flatMap((question) => question.knowledge_points ?? [])
            .map((knowledgePoint) => [knowledgePoint.id, knowledgePoint]),
        ).values(),
      ),
    [questionQuery.query.data?.data],
  );

  const totalScore = useMemo(
    () => questionItems.reduce((sum, item) => sum + (Number(item.score_override) || 0), 0),
    [questionItems],
  );

  const isSettingsDirty =
    settings !== null && initialSettings !== null && JSON.stringify(settings) !== JSON.stringify(initialSettings);
  const isScoresDirty = !areQuestionItemsEqual(questionItems, initialQuestionItems);

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
            description: getErrorMessage(error, "保存考试设置失败，请稍后重试。"),
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
            description: getErrorMessage(error, "保存考试分数失败，请稍后重试。"),
            variant: "destructive",
          });
        },
      },
    );
  };

  useEffect(() => {
    if (!hydrated || !isScoresDirty || (savingTarget === "scores" && mutation.isPending)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      handleSaveScores();
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hydrated, isScoresDirty, mutation.isPending, questionItems, savingTarget]);

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
        title={`${categoryLabel}查看`}
        description="左侧按标准试卷格式查看完整内容，右侧适合做分数与设置的轻量调整。"
        onBack={() => navigate("/exams")}
        backLabel="返回考试列表"
        fullBleed
        actions={
          <div className="flex items-center gap-2">
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
            <Button variant="outline" onClick={() => navigate("/exams")}>
              <List className="h-4 w-4" />
              返回考试列表
            </Button>
          </div>
        }
      />

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

            setQuestionItems((prev) => applyTypeScoreAllocationToItems(prev, summary, parsed));
          }}
          onQuestionScoreChange={updateQuestionScore}
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
                <span className="text-right font-medium text-foreground">{exam.title}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">时间</span>
                <span className="text-right font-medium text-foreground">
                  {formatDateTime(exam.start_time)} 到 {formatDateTime(exam.end_time)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">题目</span>
                <span className="font-medium text-foreground">{previewItems.length} 题</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">卷面总分</span>
                <span className="font-medium text-foreground">{Number(totalScore.toFixed(2)).toString()} 分</span>
              </div>
              {exam.category === "exam" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">考生人数</span>
                    <span className="font-medium text-foreground">{exam.total_students} 人</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">已提交</span>
                    <span className="font-medium text-foreground">{exam.submitted_count} 人</span>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          {exam.category === "practice" && selectedKnowledgePoints.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">知识点</h3>
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
