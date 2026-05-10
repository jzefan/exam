import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Trash2, Loader2, StopCircle, FileQuestion, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getGeneratedQuestionPersistKey,
  useUnsavedGeneratedQuestionsGuard,
} from "@/hooks/use-unsaved-generated-questions-guard";
import { LatexText } from "@/components/ui/latex-text";
import type { IQuestion, QuestionType } from "@/types";
import { AIGenerateLoadingOverlay } from "./components/ai-generate-loading-overlay";
import {
  validateTypeAllocation,
} from "./ai-generate-utils";
import {
  AI_TYPE_LABELS,
  type AIModelProvider,
} from "@/components/questions/ai-question-config-constants";
import {
  AIQuestionConfigPanel,
  type SelectedKnowledgePoint,
} from "@/components/questions/ai-question-config-panel";
import { QuestionEditFormContent, type QuestionEditSubmitValues } from "./edit";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

type TypeAllocation = Record<QuestionType, number>;
const AI_GENERATE_PREFILL_KEY = "ai_generate_prefill_v1";

type AIGeneratePrefill = {
  selectedKnowledgePoints?: SelectedKnowledgePoint[];
  customPrompt?: string;
};

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
      className={`inline-block h-2 w-2 rounded-full ${
        i < level ? "bg-primary" : "bg-muted"
      }`}
    />
  ));
}

function normalizeTrueFalseAnswer(answer: GeneratedQuestion["answer"]) {
  const value = answer.correct ?? answer.text;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "正确", "对", "是"].includes(value.trim().toLowerCase());
  }
  return false;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generatedQuestionToEditableQuestion(question: GeneratedQuestion): IQuestion {
  const answer =
    question.type === "true_false"
      ? { correct: normalizeTrueFalseAnswer(question.answer) }
      : question.answer;

  return {
    id: `generated-${question.index}`,
    type: question.type,
    title: question.title,
    content: {
      html: question.content.text ? `<p>${escapeHtml(question.content.text)}</p>` : "",
      text: question.content.text,
    },
    options: question.options,
    answer,
    analysis: question.analysis,
    difficulty: question.difficulty,
    score: 10,
    usage_count: 0,
    question_bank_id: null,
    question_bank_name: null,
    tags: [],
    knowledge_points: [],
    created_by: "",
    created_by_name: "",
    created_at: "",
    updated_at: "",
  };
}

function applyQuestionEditValues(
  question: GeneratedQuestion,
  values: QuestionEditSubmitValues,
): GeneratedQuestion {
  const contentText = typeof values.content.text === "string" ? values.content.text : values.title;

  return {
    ...question,
    type: values.type,
    title: values.title,
    content: {
      text: contentText,
    },
    options: values.options,
    answer: values.answer,
    analysis: values.analysis,
    difficulty: values.difficulty,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AIGeneratePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [totalCount, setTotalCount] = useState(10);
  const [difficulty, setDifficulty] = useState(3);
  const [typeAlloc, setTypeAlloc] = useState<TypeAllocation>({
    choice: 0,
    true_false: 0,
    fill_in: 0,
    short_answer: 0,
    essay: 0,
    code: 0,
  });
  const [model, setModel] = useState<AIModelProvider>("qwen");
  const [selectedKPs, setSelectedKPs] = useState<SelectedKnowledgePoint[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");

  // Generation state
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [persistedQuestionKeys, setPersistedQuestionKeys] = useState<string[]>([]);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);

  const allocationState = validateTypeAllocation(totalCount, typeAlloc);
  const allocSum = allocationState.allocated;
  const allocMismatch = !allocationState.isValid;

  const selectedCount = questions.filter((q) => q.selected).length;
  const editingQuestion = useMemo(
    () => questions.find((question) => question.index === editingQuestionIndex) ?? null,
    [editingQuestionIndex, questions],
  );
  const currentPersistKeys = useMemo(
    () => questions.map((question) => getGeneratedQuestionPersistKey(question)),
    [questions],
  );
  const hasUnsavedGeneratedQuestions =
    questions.length > 0 &&
    !isGenerating &&
    currentPersistKeys.some((key) => !persistedQuestionKeys.includes(key));
  const { dialog: unsavedGuardDialog, allowNextNavigation } = useUnsavedGeneratedQuestionsGuard({
    when: hasUnsavedGeneratedQuestions,
    message: "当前生成的题目尚未保存到题库，确定离开当前页面吗？",
  });

  useEffect(() => {
    const raw = sessionStorage.getItem(AI_GENERATE_PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(AI_GENERATE_PREFILL_KEY);
    try {
      const prefill = JSON.parse(raw) as AIGeneratePrefill;
      if (prefill.selectedKnowledgePoints?.length) {
        setSelectedKPs(prefill.selectedKnowledgePoints);
      }
      if (prefill.customPrompt) {
        setCustomPrompt(prefill.customPrompt);
      }
    } catch {
      // Ignore invalid prefill payloads.
    }
  }, []);
  /* ---- generation ---- */

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
    setPersistedQuestionKeys([]);
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
      knowledge_point_ids: selectedKPs.length > 0 ? selectedKPs.map((kp) => kp.id) : undefined,
      prompt: customPrompt.trim() || undefined,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine.replace(/^data:\s*/, ""));

            if (event.type === "question") {
              if (questionIndex >= totalCount) {
                continue;
              }
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
              toast({
                title: "生成出错",
                description: event.message ?? "未知错误",
                variant: "destructive",
              });
              streamFailed = true;
              await reader.cancel();
              break;
            }
          } catch {
            // skip malformed events
          }
        }

        if (streamFailed) {
          break;
        }
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
  }, [allocationState, totalCount, difficulty, typeAlloc, selectedKPs, customPrompt, model, toast]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ---- selection ---- */

  const toggleSelect = (index: number) => {
    setQuestions((prev) =>
      prev.map((q) => (q.index === index ? { ...q, selected: !q.selected } : q)),
    );
  };

  const toggleSelectAll = () => {
    const allSelected = questions.every((q) => q.selected);
    setQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((q) => q.index !== index));
  };

  const openQuestionEditor = (question: GeneratedQuestion) => {
    setEditingQuestionIndex(question.index);
  };

  const closeQuestionEditor = () => {
    setEditingQuestionIndex(null);
  };

  const saveQuestionEdit = (values: QuestionEditSubmitValues) => {
    if (editingQuestionIndex === null) return;
    setQuestions((prev) =>
      prev.map((question) =>
        question.index === editingQuestionIndex ? applyQuestionEditValues(question, values) : question,
      ),
    );
    closeQuestionEditor();
  };

  /* ---- save ---- */

  const saveToBank = useCallback(async () => {
    const selected = questions.filter((q) => q.selected);
    if (selected.length === 0) {
      toast({ title: "请至少选择一道题目", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      // Find or create AI题库
      const banks = await apiFetch<Array<{ id: string; name: string }>>("/api/question-banks");
      let bankId: string;
      const aiBank = banks.find((b) => b.name === "AI题库");
      if (aiBank) {
        bankId = aiBank.id;
      } else {
        const created = await apiFetch<{ id: string }>("/api/question-banks", {
          method: "POST",
          body: JSON.stringify({ name: "AI题库", description: "AI自动生成的题目" }),
        });
        bankId = created.id;
      }

      // Bulk create
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
        knowledge_point_ids: [],
        question_bank_id: bankId,
      }));

      await apiFetch<{ created: number }>("/api/questions/bulk", {
        method: "POST",
        body: JSON.stringify({ questions: payload }),
      });

      toast({ title: `已保存 ${selected.length} 道题目到「AI题库」` });
      setPersistedQuestionKeys((prev) =>
        Array.from(new Set([...prev, ...selected.map((question) => getGeneratedQuestionPersistKey(question))])),
      );
      allowNextNavigation();
      navigate("/questions");
    } catch (err) {
      toast({
        title: "保存失败",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [allowNextNavigation, navigate, questions, toast]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full gap-6 p-6">
      {unsavedGuardDialog}
      {/* ---- Left: Config Panel ---- */}
      <AIQuestionConfigPanel
        title="AI 智能出题"
        fetcher={(path, options) => apiFetch(`/api${path}`, options)}
        storageKey="question-ai-generate-recent-keywords"
        className="sticky top-6 flex w-[380px] shrink-0 flex-col gap-5 self-start"
        totalCount={totalCount}
        onTotalCountChange={setTotalCount}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        typeAlloc={typeAlloc}
        onTypeAllocChange={setTypeAlloc}
        model={model}
        onModelChange={setModel}
        selectedKnowledgePoints={selectedKPs}
        onSelectedKnowledgePointsChange={setSelectedKPs}
        customPrompt={customPrompt}
        onCustomPromptChange={setCustomPrompt}
        allocationError={
          allocMismatch ? `题型数量之和 (${allocSum}) 与题目总数 (${totalCount}) 不一致` : null
        }
        footer={
          <>
            <div className="flex gap-2">
              {!isGenerating ? (
                <Button
                  className="flex-1"
                  onClick={startGeneration}
                  disabled={isGenerating || (allocationState.hasCustomAllocation && !allocationState.isValid)}
                >
                  <Sparkles size={16} />
                  开始生成
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={stopGeneration}
                >
                  <StopCircle size={16} />
                  停止生成
                </Button>
              )}
            </div>

            {isGenerating ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                生成中... 已生成 {questions.length} 道
              </div>
            ) : null}
          </>
        }
      />

      {/* ---- Right: Results Panel ---- */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {questions.length === 0 && !isGenerating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileQuestion size={48} strokeWidth={1.5} />
            <p>配置参数后点击开始生成</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto pb-20">
              {questions.map((q) => (
                <div
                  key={q.index}
                  className="rounded-lg border border-border/35 bg-card/95 p-4 transition-colors"
                >
                  {/* Card header */}
                  <div className="mb-2 flex items-center gap-2">
                    <Checkbox
                      checked={q.selected}
                      onCheckedChange={() => toggleSelect(q.index)}
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      #{q.index + 1}
                    </span>
                    <Badge
                      variant="secondary"
                      className={TYPE_COLORS[q.type as keyof TypeAllocation] ?? ""}
                    >
                      {AI_TYPE_LABELS[q.type as keyof TypeAllocation] ?? q.type}
                    </Badge>
                    <div className="flex items-center gap-0.5">
                      {difficultyDots(q.difficulty)}
                    </div>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => openQuestionEditor(q)}
                    >
                      <Pencil size={13} />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeQuestion(q.index)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>

                  {/* Title */}
                  <p className="mb-1 text-sm font-medium">
                    <LatexText>{q.title}</LatexText>
                  </p>

                  {/* Content */}
                  {q.content.text && q.content.text !== q.title && (
                    <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      <LatexText>{q.content.text}</LatexText>
                    </p>
                  )}

                  {/* Options */}
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

                  {/* Answer */}
                  <div className="mt-2 rounded bg-muted/28 p-2 text-sm">
                    <span className="font-medium text-primary">答案：</span>
                    <LatexText>{q.answer.correct ?? q.answer.text ?? JSON.stringify(q.answer)}</LatexText>
                  </div>

                  {/* Analysis */}
                  {q.analysis && (
                    <div className="mt-1 rounded bg-muted/15 p-2 text-sm text-muted-foreground">
                      <span className="font-medium">解析：</span>
                      <LatexText>{q.analysis}</LatexText>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom action bar */}
            {questions.length > 0 && (
              <div className="sticky bottom-0 flex items-center gap-3 border-t border-border/35 bg-background py-3">
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {questions.every((q) => q.selected) ? "取消全选" : "全选"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  已选择 {selectedCount}/{questions.length} 道题目
                </span>
                <div className="flex-1" />
                <Button onClick={saveToBank} disabled={isSaving || selectedCount === 0}>
                  {isSaving && <Loader2 size={14} className="animate-spin" />}
                  保存到题库
                </Button>
              </div>
            )}
          </>
        )}
        {isGenerating && <AIGenerateLoadingOverlay generatedCount={questions.length} />}
      </main>

      <Dialog open={editingQuestion !== null} onOpenChange={(open) => !open && closeQuestionEditor()}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑生成题目</DialogTitle>
            <DialogDescription>
              这里复用题目编辑界面，修改后再保存到题库。
            </DialogDescription>
          </DialogHeader>

          {editingQuestion ? (
            <QuestionEditFormContent
              key={editingQuestion.index}
              question={generatedQuestionToEditableQuestion(editingQuestion)}
              banks={[]}
              allTags={[]}
              variant="dialog"
              showHeader={false}
              showQuestionBankAndTags={false}
              submitLabel="保存修改"
              onCancel={closeQuestionEditor}
              onSubmit={saveQuestionEdit}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
