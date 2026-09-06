import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { getPublishedExamStatus } from "@/pages/exams/components/exam-form-utils";
import { ClassStudentSelector } from "@/pages/exams/components/ClassStudentSelector";
import type { IQuestion } from "@/types";

import { listCourseQuestions } from "./api";
import {
  ALL_DIFFICULTIES,
  ALL_KNOWLEDGE_POINTS,
  getQuestionPreviewText,
  parseSmartPracticePrompt,
  selectSmartPracticeQuestions,
  type SmartPracticeKnowledgeOption,
} from "./smart-practice-utils";

type CreationMode = "conditions" | "prompt";
type DialogStage = "configure" | "preview";

const DIFFICULTY_OPTIONS = [
  { value: ALL_DIFFICULTIES, label: "综合" },
  { value: 1, label: "容易" },
  { value: 2, label: "较易" },
  { value: 3, label: "中等" },
  { value: 4, label: "较难" },
  { value: 5, label: "很难" },
];

const TYPE_LABELS: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

function defaultPracticeTitle(courseName: string): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${courseName}-${month}${day}练习`;
}

function getPromptTemplate(
  courseName: string,
  knowledgeName: string | null,
  count = 10,
  difficulty = "容易",
) {
  const scope = knowledgeName ? `“${knowledgeName}”` : `“${courseName}”`;
  return `请从这些题目中选取${count}道${difficulty}题，围绕${scope}生成一份练习。`;
}

export interface SmartPracticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
  courseKpId: string;
  courseSemesterId: string | null;
  selectedQuestionIds: string[];
  knowledgeOptions: SmartPracticeKnowledgeOption[];
  initialKnowledgePointId?: string | null;
  onPublished?: (examId: string) => void | Promise<void>;
}

export function SmartPracticeDialog({
  open,
  onOpenChange,
  courseId,
  courseName,
  courseKpId,
  courseSemesterId,
  selectedQuestionIds,
  knowledgeOptions,
  initialKnowledgePointId = null,
  onPublished,
}: SmartPracticeDialogProps) {
  const { toast } = useToast();
  const [stage, setStage] = useState<DialogStage>("configure");
  const [mode, setMode] = useState<CreationMode>("conditions");
  const [sourceQuestions, setSourceQuestions] = useState<IQuestion[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [countPreset, setCountPreset] = useState("10");
  const [customCount, setCustomCount] = useState(10);
  const [difficulty, setDifficulty] = useState(ALL_DIFFICULTIES);
  const [knowledgePointId, setKnowledgePointId] = useState<string | null>(
    initialKnowledgePointId,
  );
  const [prompt, setPrompt] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState<IQuestion[]>([]);
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [variation, setVariation] = useState(0);
  const [title, setTitle] = useState(() => defaultPracticeTitle(courseName));
  const [studentIds, setStudentIds] = useState<string[]>([]);
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
    setMode("conditions");
    setCountPreset("10");
    setCustomCount(10);
    setDifficulty(ALL_DIFFICULTIES);
    setKnowledgePointId(initialKnowledgePointId);
    setPrompt("");
    setPreviewQuestions([]);
    setIncludedIds(new Set());
    setSelectionNotice(null);
    setVariation(0);
    setTitle(defaultPracticeTitle(courseName));
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

  const promptTemplates = useMemo(
    () => [
      {
        label: "10 道容易题",
        value: getPromptTemplate(courseName, selectedKnowledge?.name ?? null),
      },
      {
        label: "20 道综合题",
        value: getPromptTemplate(
          courseName,
          selectedKnowledge?.name ?? null,
          20,
          "综合难度",
        ),
      },
      {
        label: "本节巩固",
        value: `请为本节“${selectedKnowledge?.name ?? courseName}”选取10道题，基础与应用题兼顾。`,
      },
    ],
    [courseName, selectedKnowledge?.name],
  );

  const generatePreview = (nextVariation = variation) => {
    const baseIntent = {
      count: Math.max(1, Math.min(200, requestedCount || 1)),
      difficulty,
      knowledgePointId,
    };
    const intent =
      mode === "prompt"
        ? parseSmartPracticePrompt(prompt, knowledgeOptions, baseIntent)
        : { ...baseIntent, searchTerms: [] };
    const picked = selectSmartPracticeQuestions(
      sourceQuestions,
      intent,
      nextVariation,
    );
    setPreviewQuestions(picked);
    setIncludedIds(new Set(picked.map((question) => question.id)));
    setSelectionNotice(
      picked.length < intent.count
        ? `当前条件下可用 ${picked.length} 题`
        : null,
    );
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

  const handlePublish = async () => {
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
        course_semester_id: courseSemesterId ?? undefined,
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
    requestedCount > 0 &&
    (mode === "conditions" || prompt.trim().length > 0);
  const canPublish =
    title.trim().length > 0 && includedQuestions.length > 0 && studentIds.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!publishing) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl">
        {stage === "configure" ? (
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as CreationMode)}
            className="flex min-h-0 flex-1 flex-col"
          >
              <DialogHeader className="border-b px-5 py-4 pr-12">
                <div className="grid grid-cols-[auto_1fr] items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Sparkles size={16} aria-hidden="true" />
                    智能创建练习
                  </DialogTitle>
                  <TabsList className="grid w-40 grid-cols-2 justify-self-end sm:w-64 sm:justify-self-center">
                    <TabsTrigger value="conditions">按条件</TabsTrigger>
                    <TabsTrigger value="prompt">提示词</TabsTrigger>
                  </TabsList>
                  <span className="hidden sm:block" aria-hidden="true" />
                </div>
                <DialogDescription>{sourceLabel}</DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div
                  data-testid="smart-practice-mode-content"
                  className="h-[268px] sm:h-[132px]"
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
                          <SelectItem value="10">10 题</SelectItem>
                          <SelectItem value="20">20 题</SelectItem>
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
                    <Select
                      value={knowledgePointId ?? ALL_KNOWLEDGE_POINTS}
                      onValueChange={(value) =>
                        setKnowledgePointId(value === ALL_KNOWLEDGE_POINTS ? null : value)
                      }
                    >
                      <SelectTrigger id="smart-practice-knowledge">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={ALL_KNOWLEDGE_POINTS}>全部知识点</SelectItem>
                          {knowledgeOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
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
                    value="prompt"
                    className="mt-0 h-full overflow-y-auto pt-1"
                  >
                    <div className="flex flex-col gap-3">
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
                      </div>
                      <Textarea
                        aria-label="练习提示词"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder={getPromptTemplate(
                          courseName,
                          selectedKnowledge?.name ?? null,
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
            <DialogHeader className="border-b px-5 py-4 pr-12">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles size={16} aria-hidden="true" />
                智能创建练习
              </DialogTitle>
              <DialogDescription>预览 · {includedQuestions.length} 题</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStage("configure")}>
                <ArrowLeft data-icon="inline-start" />
                修改条件
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleRegenerate}>
                <RefreshCw data-icon="inline-start" />
                换一组
              </Button>
              {selectionNotice ? <Badge variant="warning">{selectionNotice}</Badge> : null}
            </div>

            <div className="flex flex-col gap-2">
              {previewQuestions.map((question, index) => {
                const included = includedIds.has(question.id);
                return (
                  <div
                    key={question.id}
                    className="flex items-start gap-3 rounded-md border px-3 py-2.5"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={included}
                      onCheckedChange={() => toggleIncluded(question.id)}
                      aria-label={`${included ? "移除" : "加入"}第 ${index + 1} 题`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {index + 1}. {getQuestionPreviewText(question)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <span>{TYPE_LABELS[question.type] ?? "题目"}</span>
                        <span>难度 {question.difficulty}</span>
                        {question.knowledge_points[0] ? (
                          <span>{question.knowledge_points[0].name}</span>
                        ) : null}
                      </div>
                    </div>
                    {!included ? (
                      <X size={16} className="text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <Check size={16} className="text-primary" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smart-practice-title">练习名称</Label>
                <Input
                  id="smart-practice-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              <ClassStudentSelector
                selectedIds={studentIds}
                onChange={setStudentIds}
                summaryLabel="名学生"
                emptySummaryText="请选择学生"
                defaultSupplementCollapsed
              />
            </div>
            </div>
          </>
        )}

        <DialogFooter className="border-t px-5 py-4 sm:gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
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
              确认发布 · 7 天
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
