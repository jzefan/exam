import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Info,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Save,
  Sparkles,
  StopCircle,
  Trash2,
} from "lucide-react";

import {
  GeneratedAssignmentDialog,
  type GeneratedAssignmentDialogSubmitPayload,
} from "@/pages/knowledge/GeneratedAssignmentDialog";

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
import { useToast } from "@/hooks/use-toast";
import type { QuestionType } from "@/types";

const DEFAULT_TARGET_QUESTION_BANK_NAME = "主知识对应题库";

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
      className={`inline-block h-[9px] w-1 rounded-[1px] ${
        i < level ? "bg-amber-400" : "bg-border"
      }`}
    />
  ));
}

function getAnswerText(answer: GeneratedQuestion["answer"] | null | undefined) {
  if (!answer) return "";
  if (typeof answer.text === "string") return answer.text.trim();
  if (typeof answer.correct === "string") return answer.correct.trim();
  return "";
}

function inferCourseNameFromKnowledgePath(
  knowledgePointPath: string,
  knowledgePointName: string,
) {
  const parts = knowledgePointPath
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts[2];
  if (parts.length >= 2) return parts[0];
  return knowledgePointName;
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
  targetQuestionBankName?: string;
  /** 触发刷新相关题目列表 */
  onSaved?: () => void;
}

/** Inline stepper chip for type allocation — +/- buttons with editable count */
function TypeChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const active = value > 0;
  const [draft, setDraft] = useState<string | null>(null);
  const focused = draft !== null;
  const display = focused ? draft : String(value);

  const commit = (raw: string) => {
    const n = Math.max(0, Math.min(50, parseInt(raw, 10) || 0));
    onChange(n);
    setDraft(null);
  };

  const set = (v: number) => {
    const clamped = Math.max(0, Math.min(50, v));
    onChange(clamped);
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
        active
          ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-border bg-muted/30"
      }`}
    >
      <span
        className={`text-[13px] font-medium whitespace-nowrap ${
          active ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => set(value - 1)}
          disabled={value === 0}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted disabled:cursor-default disabled:text-muted-foreground/30"
        >
          <Minus size={12} />
        </button>
        <input
          type="number"
          min={0}
          max={50}
          className={`w-12 bg-transparent text-center text-[14px] font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            active ? "text-blue-600 dark:text-blue-400" : ""
          }`}
          value={display}
          onFocus={() => setDraft(String(value))}
          onBlur={() => commit(draft ?? String(value))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button
          type="button"
          onClick={() => set(value + 1)}
          className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
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
  targetQuestionBankName = DEFAULT_TARGET_QUESTION_BANK_NAME,
  onSaved,
}: MaterialAIGenerateDialogProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const [difficulty, setDifficulty] = useState(3);
  const [typeAlloc, setTypeAlloc] = useState<TypeAllocation>({
    choice: 10,
    true_false: 0,
    fill_in: 0,
    short_answer: 0,
    essay: 0,
    code: 0,
  });
  const [model, setModel] = useState<AIModelProvider>("deepseek");
  const [customPrompt, setCustomPrompt] = useState("");

  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showGeneratedAssignmentDialog, setShowGeneratedAssignmentDialog] =
    useState(false);
  const [createdAssignment, setCreatedAssignment] = useState<{
    id: string;
    title: string;
    questionCount: number;
  } | null>(null);

  const totalCount = Object.values(typeAlloc).reduce((a, b) => a + b, 0);

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
    }
  }, [open, knowledgePointName, materialTitle]);

  const startGeneration = useCallback(async () => {
    if (totalCount === 0) {
      toast({
        title: "请分配题型数量",
        description: "至少为一种题型设置数量。",
        variant: "destructive",
      });
      return;
    }

    const codeCount = typeAlloc.code ?? 0;
    const codePrompt =
      codeCount > 0
        ? " 特别注意：本次包含代码题，所有代码题必须提供 answer.text，内容需包含参考实现或关键解法步骤，不能为空。"
        : "";

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setQuestions([]);

    const typeDistribution: Record<string, number> = {};
    for (const [k, v] of Object.entries(typeAlloc)) {
      if (v > 0) typeDistribution[k] = v;
    }
    const expectedTypes = Object.entries(typeAlloc).flatMap(([type, count]) =>
      Array.from({ length: count }, () => type as QuestionType),
    );

    const requestBody = {
      total_count: totalCount,
      difficulty,
      type_distribution:
        Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
      knowledge_point_ids: [knowledgePointId],
      course_name: inferCourseNameFromKnowledgePath(
        knowledgePointPath,
        knowledgePointName,
      ),
      prompt: `${customPrompt.trim()}${codePrompt}`.trim() || undefined,
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
        const dataLine = part
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        try {
          const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            if (questionIndex >= totalCount) return;
            const expectedType = expectedTypes[questionIndex];
            const generatedType = event.data.type ?? "choice";
            if (expectedType && generatedType !== expectedType) {
              toast({
                title: "生成题型不符合要求",
                description: `第 ${questionIndex + 1} 题要求生成「${AI_TYPE_LABELS[expectedType]}」，但 AI 返回了「${AI_TYPE_LABELS[generatedType as QuestionType] ?? generatedType}」。请重新生成。`,
                variant: "destructive",
              });
              streamFailed = true;
              await reader.cancel();
              return;
            }
            if (generatedType === "code" && !getAnswerText(event.data.answer)) {
              toast({
                title: "代码题缺少答案",
                description: `第 ${questionIndex + 1} 题是代码题，但 AI 没有返回参考答案。请重新生成。`,
                variant: "destructive",
              });
              streamFailed = true;
              await reader.cancel();
              return;
            }
            const q: GeneratedQuestion = {
              index: questionIndex++,
              type: generatedType as QuestionType,
              title: event.data.title ?? "",
              content: {
                text: event.data.content?.text ?? event.data.title ?? "",
              },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? difficulty,
              selected: true,
            };
            setQuestions((prev) => [...prev, q]);
          } else if (event.type === "error") {
            toast({
              title: "生成出错",
              description: event.message ?? "未知错误",
              variant: "destructive",
            });
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
        toast({
          title: "生成失败",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [
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
    setQuestions((prev) =>
      prev.map((q) =>
        q.index === index ? { ...q, selected: !q.selected } : q,
      ),
    );
  };

  const toggleSelectAll = () => {
    const allSelected =
      questions.length > 0 && questions.every((q) => q.selected);
    setQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((q) => q.index !== index));
  };

  const getSavePermissionErrorDescription = () =>
    "请确认当前知识点对你的账号可见，且未引用其它无权限访问的私有知识点。";

  const buildAndSaveSelectedQuestions = useCallback(
    async (failureTitle: string) => {
      const selected = questions.filter((q) => q.selected);
      if (selected.length === 0) {
        toast({ title: "请至少选择一道题目", variant: "destructive" });
        return null;
      }
      const codeWithoutAnswer = selected.find(
        (q) => q.type === "code" && !getAnswerText(q.answer),
      );
      if (codeWithoutAnswer) {
        toast({
          title: "代码题必须带答案",
          description: `第 ${codeWithoutAnswer.index + 1} 题是代码题，请先补充参考答案后再保存或发布。`,
          variant: "destructive",
        });
        return null;
      }

      const payload = selected.map((q) => ({
        type: q.type,
        title: q.title,
        content: q.content,
        options: q.options,
        answer:
          q.type === "code"
            ? { ...q.answer, code: getAnswerText(q.answer) }
            : q.answer,
        analysis: q.analysis,
        difficulty: q.difficulty,
        score: 10,
        tag_ids: [],
        knowledge_point_ids: [knowledgePointId],
      }));

      try {
        const saveResult = await apiFetch<{
          created: number;
          created_question_ids?: string[];
        }>("/api/questions/save-generated-to-course-bank", {
          method: "POST",
          body: JSON.stringify({ questions: payload }),
        });
        return { selected, saveResult };
      } catch (err) {
        const message = (err as Error).message;
        const isPermissionError = /403|forbidden|权限|permission/i.test(
          message,
        );
        toast({
          title: isPermissionError
            ? "当前知识点暂不允许保存题目"
            : failureTitle,
          description: isPermissionError
            ? getSavePermissionErrorDescription()
            : message,
          variant: "destructive",
        });
        throw err;
      }
    },
    [knowledgePointId, questions, toast],
  );

  const saveToCourseBank = useCallback(async () => {
    setIsSaving(true);
    try {
      const saveOutcome = await buildAndSaveSelectedQuestions("保存失败");
      if (!saveOutcome) return;

      toast({
        title: `已保存 ${saveOutcome.selected.length} 道题目到「${targetQuestionBankName}」`,
      });
      onSaved?.();
      onOpenChange(false);
    } catch {
      // error handled in buildAndSaveSelectedQuestions
    } finally {
      setIsSaving(false);
    }
  }, [
    buildAndSaveSelectedQuestions,
    onOpenChange,
    onSaved,
    targetQuestionBankName,
    toast,
  ]);

  const handleGeneratedAssignmentSubmit = useCallback(
    async ({ title, studentIds }: GeneratedAssignmentDialogSubmitPayload) => {
      setIsSaving(true);
      try {
        const saveOutcome = await buildAndSaveSelectedQuestions("发布练习失败");
        if (!saveOutcome) return;

        const createdQuestionIds =
          saveOutcome.saveResult.created_question_ids ?? [];
        if (createdQuestionIds.length === 0) {
          throw new Error("保存题目成功但未返回可用于组卷的题目 ID");
        }

        const startDate = new Date();
        const endDate = new Date(
          startDate.getTime() + 14 * 24 * 60 * 60 * 1000,
        );

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
        const isPermissionError = /403|forbidden|权限|permission/i.test(
          message,
        );
        toast({
          title: isPermissionError
            ? "当前知识点暂不允许保存题目"
            : "发布练习失败",
          description: isPermissionError
            ? getSavePermissionErrorDescription()
            : message,
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [buildAndSaveSelectedQuestions, toast],
  );

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
  const canCreateAssignment = !isGenerating && !isSaving && selectedCount > 0;
  const generatedAssignmentDefaultTitle = `${knowledgePointName} - ${selectedCount}题练习`;
  const allQuestionsSelected =
    questions.length > 0 && questions.every((q) => q.selected);
  const generationProgress =
    totalCount > 0
      ? Math.min(100, Math.round((questions.length / totalCount) * 100))
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[96vw] max-w-[960px] flex-col overflow-hidden border-border/70 bg-background p-0 shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* ── header ── */}
        <DialogHeader className="flex-shrink-0 border-b border-border/70 px-6 py-5">
          <div className="flex items-start gap-4">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
              <Sparkles size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-bold">
                基于学习资料智能出题
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                题目将自动归入「{targetQuestionBankName}
                」，并关联到当前知识点。若资料含图片/版面信息，将优先使用多模态模型理解内容。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── settings strip ── */}
        <div className="flex-shrink-0 space-y-3 border-b border-border/70 bg-muted/20 px-6 pt-4 pb-5">
          {/* row 1: knowledge point + diff + model + generate */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
              知识点
            </span>
            <span
              className="inline-flex max-w-[280px] items-center gap-1.5 truncate rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] font-semibold text-foreground"
              title={knowledgePointPath}
            >
              {knowledgePointPath}
            </span>
            <div className="flex-1" />
            <Select
              value={String(difficulty)}
              onValueChange={(value) => setDifficulty(Number(value))}
            >
              <SelectTrigger className="h-9 w-[104px]">
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
            <Select
              value={model}
              onValueChange={(value) => setModel(value as AIModelProvider)}
            >
              <SelectTrigger className="h-9 w-[132px]">
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
            {!isGenerating ? (
              <Button
                className="h-9 gap-1.5"
                onClick={startGeneration}
                disabled={totalCount === 0}
              >
                <Sparkles size={15} />
                {questions.length > 0 ? "重新生成" : "开始生成"}
              </Button>
            ) : (
              <Button
                className="h-9 gap-1.5"
                variant="destructive"
                onClick={stopGeneration}
              >
                <StopCircle size={15} />
                停止生成
              </Button>
            )}
          </div>

          {/* row 2: type allocation — left 40%: label + total; right 60%: 2-row grid of chips */}
          <div className="flex items-start gap-4">
            <div className="flex w-1/4 shrink-0 items-center gap-3">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                题型分配
              </span>
              <span className="inline-flex items-baseline gap-1 rounded-lg border border-border bg-background px-2.5 py-1">
                <span className="text-xs text-muted-foreground">共</span>
                <span className="text-[17px] font-bold tabular-nums text-primary">
                  {totalCount}
                </span>
                <span className="text-xs text-muted-foreground">题</span>
              </span>
            </div>
            <div className="grid w-3/4 grid-cols-3 gap-2">
              {(Object.keys(AI_TYPE_LABELS) as QuestionType[]).map((type) => (
                <TypeChip
                  key={type}
                  label={AI_TYPE_LABELS[type]}
                  value={typeAlloc[type]}
                  onChange={(v) =>
                    setTypeAlloc((prev) => ({ ...prev, [type]: v }))
                  }
                />
              ))}
            </div>
          </div>

          {/* row 3: custom prompt + material card */}
          <div className="flex gap-3">
            <Textarea
              placeholder="自定义提示（资料正文已自动附加，无需粘贴）"
              rows={3}
              className="min-h-0 flex-1 resize-none text-sm leading-relaxed"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
            <div className="flex w-[220px] shrink-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText size={16} />
              </span>
              <div className="min-w-0">
                <div
                  className="truncate text-[13px] font-semibold text-foreground"
                  title={materialTitle}
                >
                  {materialTitle}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  学习资料
                  {materialImages.length > 0
                    ? ` · ${materialImages.length} 张图片`
                    : ""}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── results header ── */}
        <div className="flex-shrink-0 flex items-center gap-3 border-border/50 px-6 py-1">
          <span className="text-sm font-bold text-foreground whitespace-nowrap">
            生成结果
          </span>
          {questions.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
              {questions.length} 题
            </span>
          )}
          {isGenerating && (
            <div className="flex min-w-[190px] items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Loader2 size={13} className="animate-spin" />
              <span className="tabular-nums">{generationProgress}%</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary/15">
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${generationProgress}%` }}
                />
              </span>
            </div>
          )}
          <div className="flex-1" />
          {questions.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleSelectAll}>
              {allQuestionsSelected ? "取消全选" : "全选"}
            </Button>
          )}
        </div>

        {/* ── results (scroll) ── */}
        <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {questions.length === 0 && !isGenerating ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground">
              <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles size={28} strokeWidth={1.6} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  配置题型数量后点击「开始生成」
                </p>
                <p className="mt-1 text-xs">
                  生成的题目会先作为草稿展示，可勾选后保存或发布练习。
                </p>
              </div>
            </div>
          ) : (
            questions.map((q) => {
              const correctKey = q.answer?.correct?.trim().toUpperCase();

              return (
                <article
                  key={q.index}
                  className={`overflow-hidden rounded-[14px] border bg-background shadow-sm ${
                    q.selected
                      ? "border-blue-200 ring-1 ring-blue-200 dark:border-blue-800"
                      : "border-border"
                  }`}
                >
                  {/* card head */}
                  <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-3">
                    <Checkbox
                      checked={q.selected}
                      onCheckedChange={() => toggleSelect(q.index)}
                    />
                    <span className="text-[15px] font-bold tabular-nums text-foreground">
                      #{q.index + 1}
                    </span>
                    <span className="rounded-[7px] bg-primary/10 px-[9px] py-[2px] text-[12.5px] font-semibold text-primary">
                      {AI_TYPE_LABELS[q.type as keyof TypeAllocation] ?? q.type}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex gap-[3px]">
                        {difficultyDots(q.difficulty)}
                      </span>
                      {AI_DIFFICULTY_LABELS[q.difficulty] ?? q.difficulty}
                    </span>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-[30px] w-[30px] border border-border p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        /* TODO: inline edit */
                      }}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-[30px] w-[30px] border border-border p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeQuestion(q.index)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>

                  {/* card body */}
                  <div className="px-[18px] py-4">
                    <p className="mb-2 text-[15px] font-semibold text-foreground">
                      <LatexText>{q.title}</LatexText>
                    </p>
                    {q.content.text && q.content.text !== q.title && (
                      <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        <LatexText>{q.content.text}</LatexText>
                      </p>
                    )}

                    {/* options with correct answer highlight */}
                    {q.options && Object.keys(q.options).length > 0 && (
                      <div className="mb-4 flex flex-col gap-2">
                        {Object.entries(q.options).map(([key, value]) => {
                          const isCorrect = correctKey === key.toUpperCase();
                          return (
                            <div
                              key={key}
                              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                                isCorrect
                                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20"
                                  : "border-border/60 bg-muted/10"
                              }`}
                            >
                              <span
                                className={`flex size-[22px] shrink-0 items-center justify-center rounded-md text-[12px] font-bold ${
                                  isCorrect
                                    ? "bg-emerald-500 text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isCorrect ? (
                                  <svg
                                    width="12"
                                    height="12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.8"
                                    viewBox="0 0 24 24"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  key
                                )}
                              </span>
                              <span
                                className={`text-sm ${
                                  isCorrect
                                    ? "font-semibold text-emerald-700 dark:text-emerald-300"
                                    : "text-foreground"
                                }`}
                              >
                                <LatexText>{value}</LatexText>
                              </span>
                              {isCorrect && (
                                <span className="ml-auto text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                  正确答案
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* answer (for non-option types) */}
                    {(!q.options || Object.keys(q.options).length === 0) && (
                      <div className="mb-3 rounded-lg bg-muted/20 p-3 text-sm">
                        <span className="font-semibold text-primary">
                          答案：
                        </span>
                        <LatexText>
                          {q.answer.correct ??
                            q.answer.text ??
                            JSON.stringify(q.answer)}
                        </LatexText>
                      </div>
                    )}

                    {/* analysis */}
                    {q.analysis && (
                      <div className="flex gap-2.5 rounded-lg border border-border/60 bg-muted/10 p-3">
                        <Info
                          size={14}
                          className="mt-0.5 shrink-0 text-muted-foreground"
                        />
                        <div>
                          <span className="text-[12px] font-bold text-muted-foreground">
                            解析{" "}
                          </span>
                          <span className="text-[13px] leading-relaxed text-muted-foreground">
                            <LatexText>{q.analysis}</LatexText>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}

          {isGenerating && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
              <Loader2 size={14} className="animate-spin" />
              生成中... 已生成 {questions.length} 道
            </div>
          )}
        </div>

        {/* ── footer ── */}
        <DialogFooter className="flex-shrink-0 flex items-center gap-3 border-t border-border/60 px-6 py-3 sm:justify-between">
          <span className="text-[13px] text-muted-foreground whitespace-nowrap">
            已选择{" "}
            <b className="tabular-nums text-foreground">{selectedCount}</b> /{" "}
            {questions.length} 道
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              关闭
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowGeneratedAssignmentDialog(true)}
              disabled={!canCreateAssignment}
            >
              <ClipboardList size={14} className="mr-1.5" />
              生成练习
            </Button>
            <Button
              onClick={() => void saveToCourseBank()}
              disabled={isSaving || isGenerating || selectedCount === 0}
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {!isSaving && <Save size={14} className="mr-1.5" />}
              保存 {selectedCount > 0 ? selectedCount : ""} 题到「
              {targetQuestionBankName}」
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

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
            <DialogTitle>练习已发布</DialogTitle>
            <DialogDescription>
              已发布 {createdAssignment?.questionCount ?? 0}{" "}
              道题的练习，可以立即进入练习详情查看。
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm font-medium">
            {createdAssignment?.title}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreatedAssignmentDialog}>
              稍后查看
            </Button>
            <Button onClick={viewCreatedAssignment}>查看练习</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
