import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, FileText, Loader2, Sparkles, StopCircle, Trash2 } from "lucide-react";

import {
  GeneratedAssignmentDialog,
  type GeneratedAssignmentDialogSubmitPayload,
} from "@/pages/knowledge/GeneratedAssignmentDialog";

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
import { LatexText } from "@/components/ui/latex-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_DIFFICULTY_LABELS,
  AI_MODEL_OPTIONS,
  AI_TYPE_LABELS,
  type AIModelProvider,
} from "@/components/questions/ai-question-config-constants";
import { validateTypeAllocation } from "@/pages/questions/ai-generate-utils";
import { useToast } from "@/hooks/use-toast";
import type { QuestionType } from "@/types";

const COURSE_QUESTION_BANK_NAME = "课程题库";

type TypeAllocation = Record<QuestionType, number>;

interface GeneratedQuestion {
  index: number;
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string };
  analysis: string | null;
  difficulty: number;
  selected: boolean;
}

const TYPE_COLORS: Record<keyof TypeAllocation, string> = {
  choice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  true_false: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  fill_in: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  short_answer: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  essay: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  code: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "请求失败");
  }
  return response.json() as Promise<T>;
}

function difficultyDots(level: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span
      key={i}
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        i < level ? "bg-primary" : "bg-muted"
      }`}
    />
  ));
}

export interface MaterialAIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgePointId: string;
  knowledgePointName: string;
  /** 完整路径，例如 "计算机科学 / 后端 / 数据结构 / 二叉树" */
  knowledgePointPath: string;
  materialTitle: string;
  materialSourceText: string;
  materialImages: string[];
  /** 触发刷新相关题目列表 */
  onSaved?: () => void;
}

export function MaterialAIGenerateDialog({
  open,
  onOpenChange,
  knowledgePointId,
  knowledgePointName,
  knowledgePointPath,
  materialTitle,
  materialSourceText,
  materialImages,
  onSaved,
}: MaterialAIGenerateDialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const [totalCount, setTotalCount] = useState(10);
  const [difficulty, setDifficulty] = useState(3);
  const [typeAlloc, setTypeAlloc] = useState<TypeAllocation>({
    choice: 10,
    true_false: 0,
    fill_in: 0,
    short_answer: 0,
    essay: 0,
    code: 0,
  });
  const [model, setModel] = useState<AIModelProvider>("qwen");
  const [customPrompt, setCustomPrompt] = useState("");

  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showMaterialPreview, setShowMaterialPreview] = useState(false);
  const [showGeneratedAssignmentDialog, setShowGeneratedAssignmentDialog] = useState(false);
  const [createdAssignment, setCreatedAssignment] = useState<{
    id: string;
    title: string;
    questionCount: number;
  } | null>(null);

  const allocationState = validateTypeAllocation(totalCount, typeAlloc);

  useEffect(() => {
    if (open) {
      setCustomPrompt(
        `请优先依据上传的学习资料「${materialTitle}」，为知识点「${knowledgePointName}」生成题目。题目应覆盖资料中的核心概念、关键步骤和易错点。`,
      );
      setQuestions([]);
      setCreatedAssignment(null);
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
      setShowMaterialPreview(false);
    }
  }, [open, knowledgePointName, materialTitle]);

  const startGeneration = useCallback(async () => {
    if (!allocationState.isValid) {
      toast({
        title: "题型数量不一致",
        description: `当前题型数量之和为 ${allocationState.allocated}，必须与题目总数 ${totalCount} 一致。`,
        variant: "destructive",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setQuestions([]);

    const typeDistribution: Record<string, number> = {};
    for (const [k, v] of Object.entries(typeAlloc)) {
      if (v > 0) typeDistribution[k] = v;
    }

    const requestBody = {
      total_count: totalCount,
      difficulty,
      type_distribution: Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
      knowledge_point_ids: [knowledgePointId],
      prompt: customPrompt.trim() || undefined,
      material_text: materialSourceText,
      material_images: materialImages,
      model,
    };

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail ?? `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let questionIndex = 0;
      let streamFailed = false;

      const processEventPart = async (part: string) => {
        const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        try {
          const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            if (questionIndex >= totalCount) return;
            const q: GeneratedQuestion = {
              index: questionIndex++,
              type: event.data.type ?? "choice",
              title: event.data.title ?? "",
              content: { text: event.data.content?.text ?? event.data.title ?? "" },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? difficulty,
              selected: true,
            };
            setQuestions((prev) => [...prev, q]);
          } else if (event.type === "error") {
            toast({ title: "生成出错", description: event.message ?? "未知错误", variant: "destructive" });
            streamFailed = true;
            await reader.cancel();
          }
        } catch {
          // skip malformed events
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          await processEventPart(part);
          if (streamFailed) break;
        }
        if (streamFailed) break;
      }

      if (!streamFailed && buffer.trim().length > 0) {
        await processEventPart(buffer);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({ title: "生成失败", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [
    allocationState,
    totalCount,
    difficulty,
    typeAlloc,
    knowledgePointId,
    customPrompt,
    model,
    materialSourceText,
    materialImages,
    toast,
  ]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleSelect = (index: number) => {
    setQuestions((prev) => prev.map((q) => (q.index === index ? { ...q, selected: !q.selected } : q)));
  };

  const toggleSelectAll = () => {
    const allSelected = questions.every((q) => q.selected);
    setQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((q) => q.index !== index));
  };

  const getSavePermissionErrorDescription = () =>
    "请确认当前知识点对你的账号可见，且未引用其它无权限访问的私有知识点。";

  const buildAndSaveSelectedQuestions = useCallback(async (failureTitle: string) => {
    const selected = questions.filter((q) => q.selected);
    if (selected.length === 0) {
      toast({ title: "请至少选择一道题目", variant: "destructive" });
      return null;
    }

    const payload = selected.map((q) => ({
      type: q.type,
      title: q.title,
      content: q.content,
      options: q.options,
      answer: q.answer,
      analysis: q.analysis,
      difficulty: q.difficulty,
      score: 10,
      tag_ids: [],
      knowledge_point_ids: [knowledgePointId],
    }));

    try {
      const saveResult = await apiFetch<{ created: number; created_question_ids?: string[] }>(
        "/api/questions/save-generated-to-course-bank",
        {
          method: "POST",
          body: JSON.stringify({ questions: payload }),
        },
      );
      return { selected, saveResult };
    } catch (err) {
      const message = (err as Error).message;
      const isPermissionError = /403|forbidden|权限|permission/i.test(message);
      toast({
        title: isPermissionError ? "当前知识点暂不允许保存题目" : failureTitle,
        description: isPermissionError ? getSavePermissionErrorDescription() : message,
        variant: "destructive",
      });
      throw err;
    }
  }, [knowledgePointId, questions, toast]);

  const saveToCourseBank = useCallback(async () => {
    setIsSaving(true);
    try {
      const saveOutcome = await buildAndSaveSelectedQuestions("保存失败");
      if (!saveOutcome) return;

      toast({ title: `已保存 ${saveOutcome.selected.length} 道题目到「${COURSE_QUESTION_BANK_NAME}」` });
      onSaved?.();
      onOpenChange(false);
    } catch {
      // error handled in buildAndSaveSelectedQuestions
    } finally {
      setIsSaving(false);
    }
  }, [buildAndSaveSelectedQuestions, onOpenChange, onSaved, toast]);

  const handleGeneratedAssignmentSubmit = useCallback(async ({
    title,
    studentIds,
  }: GeneratedAssignmentDialogSubmitPayload) => {
    setIsSaving(true);
    try {
      const saveOutcome = await buildAndSaveSelectedQuestions("发布作业失败");
      if (!saveOutcome) return;

      const createdQuestionIds = saveOutcome.saveResult.created_question_ids ?? [];
      if (createdQuestionIds.length === 0) {
        throw new Error("保存题目成功但未返回可用于组卷的题目 ID");
      }

      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);

      const createdExam = await apiFetch<{ id: string }>("/api/exams", {
        method: "POST",
        body: JSON.stringify({
          category: "practice",
          title,
          description: null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          duration_minutes: 60,
          question_mode: "manual",
          question_ids: createdQuestionIds,
          student_ids: studentIds,
        }),
      });

      setCreatedAssignment({
        id: createdExam.id,
        title,
        questionCount: saveOutcome.selected.length,
      });
      setShowGeneratedAssignmentDialog(false);
    } catch (err) {
      const message = (err as Error).message;
      const isPermissionError = /403|forbidden|权限|permission/i.test(message);
      toast({
        title: isPermissionError ? "当前知识点暂不允许保存题目" : "发布作业失败",
        description: isPermissionError ? getSavePermissionErrorDescription() : message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [buildAndSaveSelectedQuestions, toast]);

  const closeCreatedAssignmentDialog = useCallback(() => {
    setCreatedAssignment(null);
    onSaved?.();
    onOpenChange(false);
  }, [onOpenChange, onSaved]);

  const viewCreatedAssignment = useCallback(() => {
    if (!createdAssignment) {
      return;
    }
    const assignmentId = createdAssignment.id;
    closeCreatedAssignmentDialog();
    navigate(`/exams/${assignmentId}/view`);
  }, [closeCreatedAssignmentDialog, createdAssignment, navigate]);

  const selectedCount = questions.filter((q) => q.selected).length;
  const allocSum = allocationState.allocated;
  const allocMismatch = !allocationState.isValid;
  const canCreateAssignment = !isGenerating && !isSaving && selectedCount > 0;
  const generatedAssignmentDefaultTitle = `${knowledgePointName} - ${selectedCount}题练习`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[95vw] max-w-[900px] flex-col p-0"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-border/60 px-6 py-3">
          <DialogTitle className="text-base">基于学习资料智能出题</DialogTitle>
          <DialogDescription className="text-xs">
            题目将自动归入「{COURSE_QUESTION_BANK_NAME}」，并关联到当前知识点。若资料含图片/版面信息，将优先使用多模态模型理解内容。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* 紧凑表单 */}
          <div className="shrink-0 space-y-3 border-b border-border/60 bg-muted/20 px-6 pb-3 pt-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground">知识点</span>
              <span className="min-w-0 flex-1 truncate" title={knowledgePointPath}>
                {knowledgePointPath}
              </span>
              {!isGenerating ? (
                <Button
                  size="sm"
                  onClick={startGeneration}
                  disabled={isGenerating || allocMismatch}
                >
                  <Sparkles size={14} />
                  开始生成
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={stopGeneration}>
                  <StopCircle size={14} />
                  停止
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(difficulty)}
                onValueChange={(value) => setDifficulty(Number(value))}
              >
                <SelectTrigger className="h-8 w-28">
                  <SelectValue placeholder="难度" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <SelectItem key={level} value={String(level)}>
                      {AI_DIFFICULTY_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={model} onValueChange={(value) => setModel(value as AIModelProvider)}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="模型" />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <span>题目总数</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  className="h-7 w-16 px-2 text-center text-xs"
                  value={totalCount}
                  onChange={(e) =>
                    setTotalCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                  }
                />
              </label>
              <span className="text-xs text-muted-foreground">＝</span>
              {(Object.keys(AI_TYPE_LABELS) as QuestionType[]).map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{AI_TYPE_LABELS[type]}</span>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    className="h-7 w-14 px-2 text-center text-xs"
                    placeholder="0"
                    value={typeAlloc[type] || ""}
                    onChange={(e) =>
                      setTypeAlloc({
                        ...typeAlloc,
                        [type]: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </label>
              ))}
              {allocMismatch ? (
                <span className="text-xs text-destructive">
                  题型之和 {allocSum} ≠ 总数 {totalCount}
                </span>
              ) : null}
            </div>

            <div className="flex items-start gap-2">
              <Textarea
                placeholder="自定义提示（资料正文已自动附加，无需粘贴）"
                rows={2}
                className="flex-1 text-xs"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowMaterialPreview(true)}
                title="点击查看学习资料原文"
                className="flex h-[60px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs hover:bg-muted/50"
              >
                <FileText size={14} className="shrink-0 text-primary" />
                <span className="truncate text-foreground">{materialTitle}</span>
              </button>
            </div>
          </div>

          {/* 题目列表 */}
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-3">
            {questions.length === 0 && !isGenerating ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
                <Sparkles size={32} strokeWidth={1.5} />
                <p className="text-sm">配置参数后点击「开始生成」</p>
              </div>
            ) : (
              questions.map((q) => (
                  <div
                    key={q.index}
                    className="rounded-lg border border-border/35 bg-card/95 p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Checkbox checked={q.selected} onCheckedChange={() => toggleSelect(q.index)} />
                      <span className="text-xs font-medium text-muted-foreground">#{q.index + 1}</span>
                      <Badge
                        variant="secondary"
                        className={TYPE_COLORS[q.type as keyof TypeAllocation] ?? ""}
                      >
                        {AI_TYPE_LABELS[q.type as keyof TypeAllocation] ?? q.type}
                      </Badge>
                      <div className="flex items-center gap-0.5">{difficultyDots(q.difficulty)}</div>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeQuestion(q.index)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <p className="mb-1 text-sm font-medium">
                      <LatexText>{q.title}</LatexText>
                    </p>
                    {q.content.text && q.content.text !== q.title && (
                      <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        <LatexText>{q.content.text}</LatexText>
                      </p>
                    )}
                    {q.options && Object.keys(q.options).length > 0 && (
                      <div className="mb-2 space-y-0.5 pl-2">
                        {Object.entries(q.options).map(([key, value]) => (
                          <p key={key} className="text-sm">
                            <span className="mr-1 font-medium">{key}.</span>
                            <LatexText>{value}</LatexText>
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 rounded bg-muted/30 p-2 text-sm">
                      <span className="font-medium text-primary">答案：</span>
                      <LatexText>
                        {q.answer.correct ?? q.answer.text ?? JSON.stringify(q.answer)}
                      </LatexText>
                    </div>
                    {q.analysis && (
                      <div className="mt-1 rounded bg-muted/15 p-2 text-sm text-muted-foreground">
                        <span className="font-medium">解析：</span>
                        <LatexText>{q.analysis}</LatexText>
                      </div>
                    )}
                  </div>
                ))
              )}

            {isGenerating && (
              <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                生成中... 已生成 {questions.length} 道
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center gap-3 border-t border-border/60 px-6 py-3 sm:justify-between">
          <div className="flex items-center gap-3">
            {questions.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {questions.every((q) => q.selected) ? "取消全选" : "全选"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  已选择 {selectedCount}/{questions.length} 道
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              关闭
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowGeneratedAssignmentDialog(true)}
              disabled={!canCreateAssignment}
            >
              生成作业
            </Button>
            <Button
              onClick={() => void saveToCourseBank()}
              disabled={isSaving || isGenerating || selectedCount === 0}
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              保存到「{COURSE_QUESTION_BANK_NAME}」
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <Dialog open={showMaterialPreview} onOpenChange={setShowMaterialPreview}>
        <DialogContent className="flex max-h-[80vh] w-[95vw] max-w-[800px] flex-col p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText size={16} className="text-primary" />
              <span className="truncate">{materialTitle}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              资料正文已抽取的纯文本，将自动附加到提示词发送给模型。
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
              {materialSourceText}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      <GeneratedAssignmentDialog
        open={showGeneratedAssignmentDialog}
        defaultTitle={generatedAssignmentDefaultTitle}
        questionCount={selectedCount}
        onOpenChange={setShowGeneratedAssignmentDialog}
        onSubmit={handleGeneratedAssignmentSubmit}
      />

      <Dialog
        open={Boolean(createdAssignment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeCreatedAssignmentDialog();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-6" />
            </div>
            <DialogTitle>作业已发布</DialogTitle>
            <DialogDescription>
              已发布 {createdAssignment?.questionCount ?? 0} 道题的练习作业，可以立即进入作业详情查看。
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm font-medium">
            {createdAssignment?.title}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreatedAssignmentDialog}>
              稍后查看
            </Button>
            <Button onClick={viewCreatedAssignment}>查看作业</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
