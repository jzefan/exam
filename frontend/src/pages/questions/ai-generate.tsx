import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Trash2,
  Loader2,
  StopCircle,
  FileQuestion,
  Pencil,
  Bot,
} from "lucide-react";
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
import { validateTypeAllocation } from "./ai-generate-utils";
import {
  AI_DIFFICULTY_LABELS,
  AI_MODEL_OPTIONS,
  EMPTY_AI_TYPE_ALLOC,
  AI_TYPE_LABELS,
  type AIModelProvider,
  type AIQuestionType,
} from "@/components/questions/ai-question-config-constants";
import {
  AIQuestionConfigPanel,
  type SelectedKnowledgePoint,
} from "@/components/questions/ai-question-config-panel";
import { QuestionEditFormContent, type QuestionEditSubmitValues } from "./edit";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { cn } from "@/lib/utils";
import { getDefaultScore } from "@/lib/question-defaults";

const EMPTY_TYPE_ALLOC: TypeAllocation = {
  ...EMPTY_AI_TYPE_ALLOC,
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GeneratedQuestion {
  index: number;
  type: QuestionType;
  title: string;
  content: { text: string; multi?: boolean };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string | string[] };
  analysis: string | null;
  difficulty: number;
  selected: boolean;
}

type TypeAllocation = Record<AIQuestionType, number>;
const AI_GENERATE_PREFILL_KEY = "ai_generate_prefill_v1";

type AIGeneratePrefill = {
  selectedKnowledgePoints?: SelectedKnowledgePoint[];
  customPrompt?: string;
  kind?: "course_material" | string;
  material_title?: string;
  node_id?: string;
  node_name?: string;
  course_name?: string;
};

type AIGenerateNavState = {
  backTo?: string;
  backLabel?: string;
  successTo?: string;
};

function inferCourseNameForAIGeneration(
  selectedKPs: SelectedKnowledgePoint[],
  explicitCourseName: string,
): string | undefined {
  const explicit = explicitCourseName.trim();
  if (explicit) return explicit;

  const slashPath = selectedKPs.find((kp) => kp.path.includes("/"))?.path;
  if (!slashPath) return undefined;
  const parts = slashPath
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[0] : undefined;
}

function rootKnowledgeQuestionBankName(rootName: string | undefined) {
  const normalized = rootName?.trim();
  return normalized ? `${normalized.slice(0, 197)}-题库` : "主知识对应题库";
}

const TYPE_COLORS: Record<keyof TypeAllocation, string> = {
  single_choice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  multi_choice: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  true_false:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  fill_in:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  short_answer:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  essay: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  code: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

function getGeneratedQuestionDisplayType(question: GeneratedQuestion): AIQuestionType {
  if (question.type === "choice") {
    return question.content?.multi === true || Array.isArray(question.answer?.correct)
      ? "multi_choice"
      : "single_choice";
  }
  return question.type;
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

function getAnswerDisplayText(answer: GeneratedQuestion["answer"]) {
  if (typeof answer.text === "string" && answer.text.trim()) {
    return answer.text.trim();
  }
  if (Array.isArray(answer.correct)) {
    return answer.correct
      .map((value) => value.trim())
      .filter(Boolean)
      .join("、");
  }
  if (typeof answer.correct === "string") {
    return answer.correct.trim();
  }
  return "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generatedQuestionToEditableQuestion(
  question: GeneratedQuestion,
): IQuestion {
  const answer =
    question.type === "true_false"
      ? { correct: normalizeTrueFalseAnswer(question.answer) }
      : question.answer;

  return {
    id: `generated-${question.index}`,
    type: question.type,
    title: question.title,
    content: {
      html: question.content.text
        ? `<p>${escapeHtml(question.content.text)}</p>`
        : "",
      text: question.content.text,
    },
    options: question.options,
    answer,
    analysis: question.analysis,
    difficulty: question.difficulty,
    score: getDefaultScore(
      question.type,
      question.content?.multi === true || Array.isArray(question.answer?.correct),
    ),
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
  const contentText =
    typeof values.content.text === "string"
      ? values.content.text
      : values.title;

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
/*  Live preview (shown before generation starts)                      */
/* ------------------------------------------------------------------ */

function GenerationPreview({
  total,
  difficulty,
  typeAlloc,
  model,
  knowledgePoints,
  customPrompt,
}: {
  total: number;
  difficulty: number;
  typeAlloc: TypeAllocation;
  model: AIModelProvider;
  knowledgePoints: SelectedKnowledgePoint[];
  customPrompt: string;
}) {
  const breakdown = (Object.keys(AI_TYPE_LABELS) as AIQuestionType[])
    .filter((type) => typeAlloc[type] > 0)
    .map((type) => ({
      type,
      label: AI_TYPE_LABELS[type],
      count: typeAlloc[type],
    }));
  const modelOption = AI_MODEL_OPTIONS.find((option) => option.value === model);
  const metaRows = [
    {
      label: "AI 模型",
      value: modelOption ? `${modelOption.label} · ${modelOption.desc}` : model,
    },
    {
      label: "知识点",
      value:
        knowledgePoints.length > 0
          ? knowledgePoints.map((kp) => kp.name).join("、")
          : "未指定（全部范围）",
    },
    { label: "自定义提示", value: customPrompt.trim() || "无" },
  ];

  return (
    <div className="mx-auto max-w-[560px]">
      <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        本次将生成
      </p>

      {/* Summary card */}
      <div className="mb-5 rounded-2xl border border-border/60 bg-muted/20 p-6">
        <div className="mb-4 flex items-baseline gap-2.5">
          <span className="text-4xl font-bold leading-none tabular-nums text-primary">
            {total}
          </span>
          <span className="text-sm text-muted-foreground">道题目</span>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-foreground">
            难度 · {AI_DIFFICULTY_LABELS[difficulty]}
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {breakdown.map((item) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <div
                key={item.type}
                className="grid grid-cols-[64px_1fr_32px] items-center gap-3"
              >
                <span className="text-[13px] font-medium text-foreground">
                  {item.label}
                </span>
                <div className="h-[7px] overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-right text-[13px] font-semibold tabular-nums text-foreground">
                  {item.count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Meta rows */}
      <div className="overflow-hidden rounded-xl border border-border/60">
        {metaRows.map((row, index) => (
          <div
            key={row.label}
            className={cn(
              "flex gap-3.5 bg-card px-4 py-3",
              index > 0 && "border-t border-border/60",
            )}
          >
            <span className="w-[72px] shrink-0 text-[13px] text-muted-foreground">
              {row.label}
            </span>
            <span className="break-words text-[13px] leading-relaxed text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        确认无误后，点击左侧「开始生成」
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AIGeneratePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as AIGenerateNavState;
  const backTo = navState.backTo ?? "/questions";
  const successTo = navState.successTo ?? backTo;
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [totalCount, setTotalCount] = useState(10);
  const [difficulty, setDifficulty] = useState(3);
  const [typeAlloc, setTypeAlloc] = useState<TypeAllocation>({
    ...EMPTY_TYPE_ALLOC,
    single_choice: 10,
  });
  const [model, setModel] = useState<AIModelProvider>("deepseek");
  const [selectedKPs, setSelectedKPs] = useState<SelectedKnowledgePoint[]>([]);
  const [generationCourseName, setGenerationCourseName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");

  // Generation state
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [persistedQuestionKeys, setPersistedQuestionKeys] = useState<string[]>(
    [],
  );
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<
    number | null
  >(null);
  const [courseMaterialTarget, setCourseMaterialTarget] = useState<{
    knowledgePointId: string;
    bankName: string;
  } | null>(null);

  const allocationState = validateTypeAllocation(totalCount, typeAlloc);
  const allocSum = allocationState.allocated;
  const allocMismatch = !allocationState.isValid;

  const selectedCount = questions.filter((q) => q.selected).length;
  const editingQuestion = useMemo(
    () =>
      questions.find((question) => question.index === editingQuestionIndex) ??
      null,
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
  const { dialog: unsavedGuardDialog, allowNextNavigation } =
    useUnsavedGeneratedQuestionsGuard({
      when: hasUnsavedGeneratedQuestions,
      message: "当前生成的题目尚未保存到题库，确定离开当前页面吗？",
    });

  useEffect(() => {
    const raw = sessionStorage.getItem(AI_GENERATE_PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(AI_GENERATE_PREFILL_KEY);
    try {
      const prefill = JSON.parse(raw) as AIGeneratePrefill;
      setGenerationCourseName(prefill.course_name?.trim() ?? "");
      if (prefill.kind === "course_material" && prefill.node_id) {
        const nodeName = prefill.node_name?.trim() || "课程节点";
        const path = [prefill.course_name, nodeName]
          .filter(Boolean)
          .join(" / ");
        setSelectedKPs([{ id: prefill.node_id, name: nodeName, path }]);
        setCourseMaterialTarget({
          knowledgePointId: prefill.node_id,
          bankName: rootKnowledgeQuestionBankName(prefill.course_name),
        });
        if (prefill.material_title && !prefill.customPrompt) {
          setCustomPrompt(
            `请基于课程资料「${prefill.material_title}」生成题目。`,
          );
        }
      } else if (prefill.selectedKnowledgePoints?.length) {
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
      type_distribution:
        Object.keys(typeDistribution).length > 0 ? typeDistribution : undefined,
      knowledge_point_ids:
        selectedKPs.length > 0 ? selectedKPs.map((kp) => kp.id) : undefined,
      course_name: inferCourseNameForAIGeneration(
        selectedKPs,
        generationCourseName,
      ),
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
  }, [
    allocationState,
    totalCount,
    difficulty,
    typeAlloc,
    selectedKPs,
    generationCourseName,
    customPrompt,
    model,
    toast,
  ]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const resetConfig = useCallback(() => {
    setTypeAlloc(EMPTY_TYPE_ALLOC);
    setCustomPrompt("");
  }, []);

  /* ---- selection ---- */

  const toggleSelect = (index: number) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.index === index ? { ...q, selected: !q.selected } : q,
      ),
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
        question.index === editingQuestionIndex
          ? applyQuestionEditValues(question, values)
          : question,
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
      const selectedKnowledgePointIds =
        selectedKPs.length > 0
          ? selectedKPs.map((kp) => kp.id)
          : courseMaterialTarget
            ? [courseMaterialTarget.knowledgePointId]
            : [];

      if (courseMaterialTarget) {
        const payload = selected.map((q) => ({
          type: q.type,
          title: q.title,
          content: q.content,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          difficulty: q.difficulty,
          score: getDefaultScore(
            q.type,
            q.content?.multi === true || Array.isArray(q.answer?.correct),
          ),
          tag_ids: [],
          knowledge_point_ids: selectedKnowledgePointIds,
        }));

        await apiFetch<{ created: number; created_question_ids?: string[] }>(
          "/api/questions/save-generated-to-course-bank",
          {
            method: "POST",
            body: JSON.stringify({ questions: payload }),
          },
        );

        toast({
          title: `已保存 ${selected.length} 道题目到「${courseMaterialTarget.bankName}」`,
        });
        setPersistedQuestionKeys((prev) =>
          Array.from(
            new Set([
              ...prev,
              ...selected.map((question) =>
                getGeneratedQuestionPersistKey(question),
              ),
            ]),
          ),
        );
        allowNextNavigation();
        navigate(successTo);
        return;
      }

      // Find or create AI题库
      const banks = await apiFetch<Array<{ id: string; name: string }>>(
        "/api/question-banks",
      );
      let bankId: string;
      const aiBank = banks.find((b) => b.name === "AI题库");
      if (aiBank) {
        bankId = aiBank.id;
      } else {
        const created = await apiFetch<{ id: string }>("/api/question-banks", {
          method: "POST",
          body: JSON.stringify({
            name: "AI题库",
            description: "AI自动生成的题目",
          }),
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
        score: getDefaultScore(
          q.type,
          q.content?.multi === true || Array.isArray(q.answer?.correct),
        ),
        source: "ai_generated",
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
        Array.from(
          new Set([
            ...prev,
            ...selected.map((question) =>
              getGeneratedQuestionPersistKey(question),
            ),
          ]),
        ),
      );
      allowNextNavigation();
      navigate(successTo);
    } catch (err) {
      toast({
        title: "保存失败",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    allowNextNavigation,
    courseMaterialTarget,
    navigate,
    questions,
    selectedKPs,
    successTo,
    toast,
  ]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full flex-col gap-6">
      {unsavedGuardDialog}
      <PageIntroHeader
        title="AI 智能出题"
        description="配置题型、难度与知识点，AI 一键生成题目，预览无误后保存到题库"
        onBack={() => navigate(backTo)}
        backLabel={navState.backLabel ?? "返回题库"}
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bot size={14} />
            当前模型 ·{" "}
            {AI_MODEL_OPTIONS.find((option) => option.value === model)?.label ??
              model}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 gap-6">
        {/* ---- Left: Config Panel ---- */}
        <AIQuestionConfigPanel
          title="AI 智能出题"
          subtitle="配置参数，一键生成题目"
          onReset={resetConfig}
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
            allocMismatch
              ? `题型数量之和 (${allocSum}) 与题目总数 (${totalCount}) 不一致`
              : null
          }
          footer={
            <>
              <div className="flex gap-2">
                {!isGenerating ? (
                  <Button
                    className="flex-1"
                    onClick={startGeneration}
                    disabled={
                      isGenerating ||
                      allocSum === 0 ||
                      (allocationState.hasCustomAllocation &&
                        !allocationState.isValid)
                    }
                  >
                    <Sparkles size={16} />
                    {allocSum > 0 ? `开始生成 ${allocSum} 道题` : "开始生成"}
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
              ) : allocSum === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  请至少为一种题型设置数量
                </p>
              ) : null}
            </>
          }
        />

        {/* ---- Right: Preview / Results Panel ---- */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
          {/* Panel header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3.5">
            <span className="text-sm font-semibold text-foreground">
              生成预览
            </span>
            {questions.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                · 共 {questions.length} 道
              </span>
            ) : null}
          </div>

          {questions.length === 0 && !isGenerating ? (
            allocSum > 0 ? (
              <div className="flex-1 overflow-y-auto p-6">
                <GenerationPreview
                  total={allocSum}
                  difficulty={difficulty}
                  typeAlloc={typeAlloc}
                  model={model}
                  knowledgePoints={selectedKPs}
                  customPrompt={customPrompt}
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[20px] border border-border/60 bg-muted/30 text-muted-foreground">
                  <FileQuestion size={40} strokeWidth={1.4} />
                </div>
                <p className="mb-1.5 text-[15px] font-semibold text-foreground">
                  配置参数后开始生成
                </p>
                <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
                  在左侧设置题型数量、难度与知识点，预览区会实时展示本次出题的构成。
                </p>
              </div>
            )
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
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
                      {(() => {
                        const displayType = getGeneratedQuestionDisplayType(q);
                        return (
                      <Badge
                        variant="secondary"
                        className={
                          TYPE_COLORS[displayType] ?? ""
                        }
                      >
                        {AI_TYPE_LABELS[displayType] ?? q.type}
                      </Badge>
                        );
                      })()}
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
                      <LatexText>
                        {getAnswerDisplayText(q.answer) || JSON.stringify(q.answer)}
                      </LatexText>
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
                <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-card px-5 py-3">
                  <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                    {questions.every((q) => q.selected) ? "取消全选" : "全选"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    已选择 {selectedCount}/{questions.length} 道题目
                  </span>
                  <div className="flex-1" />
                  <Button
                    onClick={saveToBank}
                    disabled={isSaving || selectedCount === 0}
                  >
                    {isSaving && <Loader2 size={14} className="animate-spin" />}
                    保存到题库
                  </Button>
                </div>
              )}
            </>
          )}
          {isGenerating && (
            <AIGenerateLoadingOverlay generatedCount={questions.length} />
          )}
        </main>
      </div>

      <Dialog
        open={editingQuestion !== null}
        onOpenChange={(open) => !open && closeQuestionEditor()}
      >
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
              knowledgePoints={[]}
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
