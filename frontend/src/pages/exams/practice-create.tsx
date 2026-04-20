import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCreate, useList, useOne, useUpdate } from "@refinedev/core";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookCopy,
  CheckCircle2,
  Compass,
  Loader2,
  Maximize2,
  Sparkles,
  StopCircle,
  Wand2,
} from "lucide-react";

import { AIQuestionConfigPanel } from "@/components/questions/ai-question-config-panel";
import { type AIModelProvider } from "@/components/questions/ai-question-config-constants";
import { AIGeneratedQuestionCard } from "@/components/questions/ai-generated-question-card";
import { KnowledgePointSelector, type SelectedKnowledgePoint } from "@/components/questions/knowledge-point-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/pages/grading/api";
import { AIGenerateLoadingOverlay } from "@/pages/questions/components/ai-generate-loading-overlay";
import { validateTypeAllocation } from "@/pages/questions/ai-generate-utils";
import type { IExamQuestion, IExamStudent, IQuestion, QuestionType } from "@/types";

import { QuestionSelector } from "./components/QuestionSelector";
import { ClassStudentSelector } from "./components/ClassStudentSelector";
import { getErrorMessage, getPublishedExamStatus } from "./components/exam-form-utils";

type PracticeStepId = "knowledge" | "questions" | "students" | "publish";
type QuestionMode = "manual" | "ai";

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
  question_mode?: QuestionMode | null;
  questions: IExamQuestion[];
  students: IExamStudent[];
};

const stepItems: Array<{
  id: PracticeStepId;
  title: string;
  description: string;
}> = [
  {
    id: "knowledge",
    title: "步骤 1：选择知识点",
    description: "先确定这次练习覆盖的知识范围。",
  },
  {
    id: "questions",
    title: "步骤 2：选择题目 / AI出题",
    description: "可以手动选题，也可以按知识点直接生成练习题。",
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

export function PracticeCreate() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { mutate: create, mutation } = useCreate();
  const { mutate: update, mutation: updateMutation } = useUpdate();
  const abortRef = useRef<AbortController | null>(null);
  const hydratedExamRef = useRef(false);
  const hydratedQuestionMetaRef = useRef(false);
  const isEditMode = Boolean(id);

  const { result: practice, query: practiceQuery } = useOne<PracticeDetail>({
    resource: "exams",
    id: id ?? "",
    queryOptions: { enabled: isEditMode },
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [title, setTitle] = useState(() => (isEditMode ? "" : getDefaultPracticeTitle()));
  const [description, setDescription] = useState("");
  const [selectedKnowledgePoints, setSelectedKnowledgePoints] = useState<SelectedKnowledgePoint[]>([]);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("manual");
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [isManualQuestionFullscreen, setIsManualQuestionFullscreen] = useState(false);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [startImmediately, setStartImmediately] = useState(true);
  const [scheduledStartTime, setScheduledStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [showResult, setShowResult] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
  const [aiPrompt, setAIPrompt] = useState("");
  const [aiQuestions, setAIQuestions] = useState<GeneratedQuestion[]>([]);
  const [aiGenerating, setAIGenerating] = useState(false);
  const [aiApplying, setAIApplying] = useState(false);

  const currentStepId = stepItems[currentStep].id;
  const publishStartTime = isEditMode
    ? scheduledStartTime
    : startImmediately
      ? toLocalNowValue()
      : scheduledStartTime;

  const selectedQuestionQuery = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    filters: questionIds.length > 0 ? [{ field: "id", operator: "in" as const, value: questionIds }] : [],
    queryOptions: { enabled: questionIds.length > 0 },
  });

  const selectedQuestions = useMemo(
    () =>
      Array.from(
        new Map((selectedQuestionQuery.query.data?.data ?? []).map((question) => [question.id, question])).values(),
      ),
    [selectedQuestionQuery.query.data?.data],
  );

  useEffect(() => {
    if (!practice || hydratedExamRef.current) return;

    hydratedExamRef.current = true;
    setTitle(practice.title ?? "");
    setDescription(practice.description ?? "");
    setQuestionMode(practice.question_mode === "ai" ? "ai" : "manual");
    setQuestionIds(practice.questions.map((question) => question.question_id));
    setStudentIds(practice.students.map((student) => student.student_id));
    setDurationMinutes(practice.duration_minutes ?? 60);
    setScheduledStartTime(practice.start_time ? toLocalDateTimeValue(new Date(practice.start_time)) : "");
    setEndTime(practice.end_time ? toLocalDateTimeValue(new Date(practice.end_time)) : "");
    setShowResult(practice.show_result ?? true);
    setStartImmediately(false);
    setSubmitError(null);
  }, [practice]);

  useEffect(() => {
    if (!isEditMode || !hydratedExamRef.current || hydratedQuestionMetaRef.current || selectedQuestions.length === 0) {
      return;
    }

    hydratedQuestionMetaRef.current = true;
    const nextKnowledgePoints = Array.from(
      new Map(
        selectedQuestions
          .flatMap((question) => question.knowledge_points ?? [])
          .map((knowledgePoint) => [
            knowledgePoint.id,
            { id: knowledgePoint.id, name: knowledgePoint.name, path: knowledgePoint.name },
          ]),
      ).values(),
    );
    setSelectedKnowledgePoints(nextKnowledgePoints);

    if ((practice?.question_mode ?? questionMode) === "ai") {
      setAIQuestions(
        selectedQuestions.map((question, index) => ({
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
        })),
      );
    }
  }, [isEditMode, practice?.question_mode, questionMode, selectedQuestions]);

  const totalScore = useMemo(
    () => selectedQuestions.reduce((sum, question) => sum + (Number(question.score) || 0), 0),
    [selectedQuestions],
  );

  const allocationState = validateTypeAllocation(aiQuestionCount, aiTypeAlloc);
  const aiAllocationError =
    allocationState.hasCustomAllocation && !allocationState.isValid
      ? `题型数量之和 (${allocationState.allocated}) 与题目总数 (${aiQuestionCount}) 不一致`
      : null;

  const validateStep = (stepId: PracticeStepId): string | null => {
    if (stepId === "knowledge") {
      if (!title.trim()) return "请填写练习名称。";
      if (selectedKnowledgePoints.length === 0) return "请至少选择一个知识点。";
    }

    if (stepId === "questions") {
      if (questionIds.length === 0) {
        return questionMode === "manual" ? "请先选择题目。" : "请先生成并加入练习题目。";
      }
    }

    if (stepId === "students") {
      if (studentIds.length === 0) return "请至少选择一个班级或学生。";
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
      if (selectedKnowledgePoints.length === 0) return "待选择";
      return `已选 ${selectedKnowledgePoints.length} 个知识点`;
    }
    if (stepId === "questions") return `已选 ${questionIds.length} 题`;
    if (stepId === "students") return `已选 ${studentIds.length} 人`;
    return startImmediately ? "发布后立即开始" : "定时开始";
  };

  const findFirstInvalidStep = () => {
    for (let index = 0; index < stepItems.length; index += 1) {
      const message = validateStep(stepItems[index].id);
      if (message) return { index, message };
    }
    return null;
  };

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
          type_distribution: Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
          knowledge_point_ids: selectedKnowledgePoints.map((item) => item.id),
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
            throw new Error(event.message ?? "AI 出题失败");
          }
        }
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
  }, [aiAllocationError, aiDifficulty, aiModel, aiPrompt, aiQuestionCount, aiTypeAlloc, selectedKnowledgePoints, toast]);

  const stopAIGeneration = () => {
    abortRef.current?.abort();
  };

  const handleApplyAIQuestions = useCallback(async () => {
    const pickedQuestions = aiQuestions.filter((question) => question.selected);
    if (pickedQuestions.length === 0) {
      setSubmitError("请至少选择一道 AI 题目。");
      return;
    }

    setAIApplying(true);
    setSubmitError(null);
    try {
      const banks = await apiRequest<Array<{ id: string; name: string }>>("/question-banks");
      let bankId = banks.find((bank) => bank.name === "AI题库")?.id;
      if (!bankId) {
        const createdBank = await apiRequest<{ id: string }>("/question-banks", {
          method: "POST",
          body: JSON.stringify({ name: "AI题库", description: "AI 自动生成的练习题目" }),
        });
        bankId = createdBank.id;
      }

      const createdQuestions = await Promise.all(
        pickedQuestions.map((question) =>
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
              knowledge_point_ids: selectedKnowledgePoints.map((item) => item.id),
              question_bank_id: bankId,
            }),
          }),
        ),
      );

      setQuestionIds(createdQuestions.map((question) => question.id));
      toast({
        title: "AI 题目已加入练习",
        description: `已加入 ${createdQuestions.length} 道题目。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加入练习失败";
      setSubmitError(message);
      toast({
        title: "加入练习失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAIApplying(false);
    }
  }, [aiQuestions, selectedKnowledgePoints, toast]);

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
      start_time: publishStartTime || null,
      end_time: endTime || null,
      duration_minutes: durationMinutes,
      total_score: totalScore,
      status: getPublishedExamStatus(
        { start_time: publishStartTime, end_time: endTime },
        new Date(),
      ),
      position_id: null,
      max_switch_count: 0,
      show_result: showResult,
      notes_template: null,
      question_mode: questionMode,
      question_ids: [],
      question_items: selectedQuestions.map((question, index) => ({
        question_id: question.id,
        order: index,
        score_override: question.score,
      })),
      student_ids: studentIds,
    };

    const onError = (error: unknown) => {
      const message = getErrorMessage(
        error,
        isEditMode ? "保存练习失败，请稍后重试。" : "发布练习失败，请稍后重试。",
      );
      setSubmitError(message);
      toast({
        title: isEditMode ? "保存失败" : "发布失败",
        description: message,
        variant: "destructive",
      });
    };

    if (isEditMode && id) {
      update(
        {
          resource: "exams",
          id,
          values,
        },
        {
          onSuccess: () => {
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
        values,
      },
      {
        onSuccess: () => {
          toast({
            title: "发布成功",
            description: "练习已发布，正在返回列表。",
          });
          navigate("/exams");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" aria-label="返回列表" onClick={() => navigate("/exams")}>
          <ArrowLeft size={16} />
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-foreground tracking-tight">
            {isEditMode ? "编辑练习" : "发布练习"}
          </h1>
        </div>
      </div>

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
                        {isDone ? <CheckCircle2 size={14} /> : <span className="h-2.5 w-2.5 rounded-full bg-current/80" />}
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
                  selectedKnowledgePoints={selectedKnowledgePoints}
                  onSelectedKnowledgePointsChange={setSelectedKnowledgePoints}
                  storageKey="practice-publish-recent-keywords"
                  triggerLabel="选择练习知识点"
                  popoverSide="right"
                />
                <div className="space-y-1.5">
                  <Label htmlFor="practice-title">练习名称</Label>
                  <Input
                    id="practice-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={getDefaultPracticeTitle()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practice-description">练习说明（可不填）</Label>
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
                <CardTitle>步骤 2：选择题目 / AI出题</CardTitle>
                {questionMode === "manual" && (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      已选 <span className="font-semibold text-foreground">{questionIds.length}</span> 题
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
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setQuestionMode("manual")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      questionMode === "manual"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <BookCopy size={16} className={questionMode === "manual" ? "text-primary" : "text-muted-foreground"} />
                      <p className="text-sm font-semibold text-foreground">手动选题</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestionMode("ai")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      questionMode === "ai"
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Wand2 size={16} className={questionMode === "ai" ? "text-primary" : "text-muted-foreground"} />
                      <p className="text-sm font-semibold text-foreground">AI出题</p>
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
                  />
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
                      onSelectedKnowledgePointsChange={setSelectedKnowledgePoints}
                      customPrompt={aiPrompt}
                      onCustomPromptChange={setAIPrompt}
                      allocationError={aiAllocationError}
                      footer={
                        !aiGenerating ? (
                          <Button type="button" className="w-full" onClick={() => void handleAIGenerate()} disabled={aiApplying || Boolean(aiAllocationError)}>
                            <Sparkles size={16} className="mr-1" />
                            开始生成
                          </Button>
                        ) : (
                          <Button type="button" variant="destructive" className="w-full" onClick={stopAIGeneration}>
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
                          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                            <p className="text-sm font-semibold text-foreground">
                              生成结果
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                已选 {aiQuestions.filter((question) => question.selected).length}/{aiQuestions.length} 道
                              </span>
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleApplyAIQuestions()}
                              disabled={aiApplying || aiGenerating || aiQuestions.every((question) => !question.selected)}
                            >
                              {aiApplying && <Loader2 size={14} className="mr-1 animate-spin" />}
                              加入练习
                            </Button>
                          </div>
                          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                            {aiQuestions.map((question) => (
                              <AIGeneratedQuestionCard
                                key={question.index}
                                question={question}
                                onToggleSelected={() =>
                                  setAIQuestions((prev) =>
                                    prev.map((item) =>
                                      item.index === question.index ? { ...item, selected: !item.selected } : item,
                                    ),
                                  )
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {aiGenerating && <AIGenerateLoadingOverlay generatedCount={aiQuestions.length} />}
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
              </CardContent>
            </Card>
          )}

          {currentStepId === "publish" && (
            <Card>
              <CardHeader>
                <CardTitle>步骤 4：发布设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">发布后立即开始</p>
                    <p className="mt-1 text-xs text-muted-foreground">关闭后可设置未来的开始时间。</p>
                  </div>
                  <Switch checked={startImmediately} onCheckedChange={setStartImmediately} />
                </div>

                {!startImmediately && (
                  <div className="space-y-1.5">
                    <Label>开始时间</Label>
                    <DatePicker
                      value={toPickerDate(scheduledStartTime)}
                      onChange={(date) => setScheduledStartTime(toLocalDateTimeValue(date))}
                      includeTime
                      placeholder="开始时间"
                      className="h-9 w-full"
                    />
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="practice-duration">练习时长</Label>
                    <div className="relative">
                      <Input
                        id="practice-duration"
                        type="number"
                        min={1}
                        value={durationMinutes}
                        onChange={(event) => setDurationMinutes(parseInt(event.target.value, 10) || 0)}
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
                      onChange={(date) => setEndTime(toLocalDateTimeValue(date))}
                      includeTime
                      placeholder="不设置则按发布后长期有效"
                      className="h-9 w-full"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">允许学生查看结果</p>
                    <p className="mt-1 text-xs text-muted-foreground">开启后，学生提交后可以直接看到练习结果。</p>
                  </div>
                  <Switch checked={showResult} onCheckedChange={setShowResult} />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full flex-col-reverse gap-3 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={goPrev} disabled={currentStep === 0}>
                上一步
              </Button>
              {currentStep < stepItems.length - 1 ? (
                <Button type="button" className="w-full sm:w-auto" onClick={goNext}>
                  下一步
                  <ArrowRight size={16} className="ml-1" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleSubmit}
                  disabled={mutation.isPending || updateMutation.isPending}
                >
                  {mutation.isPending || updateMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {isEditMode ? "保存中..." : "发布中..."}
                    </span>
                  ) : (
                    isEditMode ? "保存修改" : "发布练习"
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
                <Badge variant="outline" className={practiceBadgeClass}>练习</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">练习名称</p>
                <p className="text-sm font-semibold text-foreground">{title.trim() || "未填写"}</p>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">知识点</span>
                <span className="font-medium text-foreground">{selectedKnowledgePoints.length} 个</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">题目</span>
                <span className="font-medium text-foreground">{questionIds.length} 题</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">学生</span>
                <span className="font-medium text-foreground">{studentIds.length} 人</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">总分</span>
                <span className="font-medium text-foreground">{totalScore} 分</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">时长</span>
                <span className="font-medium text-foreground">{durationMinutes} 分钟</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">开始方式</span>
                <span className="font-medium text-foreground">{startImmediately ? "立即开始" : "定时开始"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={questionMode === "manual" ? "secondary" : "outline"}>
                  {questionMode === "manual" ? "手动选题" : "AI出题"}
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
