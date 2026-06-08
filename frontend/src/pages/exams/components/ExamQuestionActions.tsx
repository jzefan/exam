import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Shuffle, Pencil, Loader2, Wand2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/pages/grading/api";
import type { IQuestion } from "@/types";

interface ExamQuestionActionsProps {
  question: IQuestion;
  currentExamQuestionIds: string[];
  onReplaceQuestion: (oldId: string, newId: string) => void;
  /** 原题所属课程/主知识点 id（题目自身无子知识点时用作兜底范围）。 */
  courseKnowledgePointId?: string | null;
  /** 当前考试/练习名称，用作 AI 生成的学科边界兜底。 */
  examTitle?: string;
  /** 题目被原地更新（如重新生成答案/解析）后的回调。 */
  onQuestionUpdated?: (question: IQuestion) => void;
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  choice: "选择题",
  true_false: "判断题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

function getQuestionText(question: IQuestion): string {
  const content = question.content as
    | { text?: string; html?: string }
    | string
    | null
    | undefined;
  if (content && typeof content === "object") {
    if (typeof content.text === "string" && content.text.trim()) return content.text;
    if (typeof content.html === "string" && content.html.trim())
      return content.html.replace(/<[^>]+>/g, " ");
  }
  if (typeof content === "string" && content.trim()) return content;
  return question.title ?? "";
}

/**
 * 换题时使用的知识点范围：优先沿用原题自身的（子）知识点；
 * 原题没有任何知识点时，回退到课程/主知识点，确保 AI 不会跑题到无关学科。
 */
export function buildExamAIReplacementKnowledgePointIds(
  question: IQuestion,
  courseKnowledgePointId?: string | null,
): string[] {
  const childIds = question.knowledge_points.map((kp) => kp.id);
  if (childIds.length > 0) return childIds;
  if (courseKnowledgePointId) return [courseKnowledgePointId];
  return [];
}

/** 生成"替换原题"的 AI 提示词：约束同课程/同子知识点、同题型，禁止跑题。 */
export function buildExamAIReplacementPrompt(question: IQuestion, extraPrompt = ""): string {
  const typeLabel = QUESTION_TYPE_LABELS[question.type] ?? question.type;
  const kpNames =
    question.knowledge_points.map((kp) => kp.name).join("、") || "（无）";
  const content = getQuestionText(question).slice(0, 500);
  const extra = extraPrompt.trim();
  return `请基于下面的原题，生成一道用于替换它的新题，必须保持在同一课程/主知识点、同一子知识点范围内。
要求：
- 与原题属于同一子知识点：${kpNames}
- 原题题型：${typeLabel}；新题必须保持相同题型与难度。
- 紧扣该学科与知识点，严禁生成语文、英语等无关学科，或与该知识点无关的题目。
- 若为编程题，answer.text 必须包含可运行的参考实现或关键解题步骤，不能为空。
${extra ? `- 教师补充要求：${extra}` : ""}

原题题干：
${content}`.trim();
}

/** 生成"只重判答案与解析"的 AI 提示词：保持题干/选项/题型不变。 */
export function buildExamAnswerAnalysisPrompt(question: IQuestion): string {
  const typeLabel = QUESTION_TYPE_LABELS[question.type] ?? question.type;
  const content = getQuestionText(question).slice(0, 500);
  const optionsStr = question.options
    ? JSON.stringify(question.options)
    : "（无）";
  const perOption =
    question.type === "choice"
      ? "\n- analysis 必须逐项说明每个选项为什么正确或为什么错误。"
      : "";
  return `请只重新判断 answer 与 analysis，不要改变题干、选项或题型。
题型：${typeLabel}
题干：${content}
选项：${optionsStr}${perOption}

只返回符合原题型格式的答案与解析。`.trim();
}

export function ExamQuestionActions({
  question,
  currentExamQuestionIds,
  onReplaceQuestion,
  courseKnowledgePointId,
  examTitle,
  onQuestionUpdated,
}: ExamQuestionActionsProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [aiRegenLoading, setAIRegenLoading] = useState(false);
  const [randomPickLoading, setRandomPickLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [regenAnswerLoading, setRegenAnswerLoading] = useState(false);
  const [aiPromptDialogOpen, setAIPromptDialogOpen] = useState(false);
  const [aiReplacementPrompt, setAIReplacementPrompt] = useState("");
  const [pending, setPending] = useState<
    | { kind: "ai"; preview: IQuestion; generated: Record<string, unknown>; fromFallback: boolean }
    | { kind: "random"; preview: IQuestion }
    | null
  >(null);

  const replacementKnowledgePointIds = buildExamAIReplacementKnowledgePointIds(
    question,
    courseKnowledgePointId,
  );

  const buildPreviewQuestion = (
    data: Record<string, unknown>,
    id: string,
  ): IQuestion =>
    ({
      id,
      type: (data.type as IQuestion["type"]) ?? question.type,
      title:
        (data.title as string) ||
        ((data.content as Record<string, string>)?.text ?? ""),
      content: (data.content as IQuestion["content"]) ?? { text: "" },
      options: (data.options as Record<string, string> | null) ?? null,
      answer: (data.answer as IQuestion["answer"]) ?? {},
      analysis: (data.analysis as string | null) ?? null,
      difficulty: (data.difficulty as number) ?? question.difficulty,
      score: question.score,
      question_bank_id: question.question_bank_id,
      knowledge_points: question.knowledge_points,
      tags: [],
      usage_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }) as unknown as IQuestion;

  /** 调用流式接口生成一道题（仅返回数据，不入库）。prompt 决定是换题还是补答案。 */
  const streamGenerate = async (prompt: string): Promise<Record<string, unknown>> => {
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
        knowledge_point_ids: replacementKnowledgePointIds,
        exam_title: examTitle?.trim() || undefined,
        prompt,
        model: "deepseek",
      }),
    });

    if (!response.ok || !response.body) throw new Error("AI 生成请求失败");

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
        const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.replace(/^data:\s*/, "")) as Record<string, unknown>;
        if (event.type === "question") {
          generated = event.data as Record<string, unknown>;
        } else if (event.type === "error") {
          throw new Error((event.message as string) ?? "AI 生成失败");
        }
      }
    }

    if (!generated) throw new Error("AI 未返回题目数据");
    return generated;
  };

  const handleAIRegen = async (extraPrompt = "") => {
    setAIRegenLoading(true);
    setAIPromptDialogOpen(false);
    try {
      const generated = await streamGenerate(buildExamAIReplacementPrompt(question, extraPrompt));
      setPending({
        kind: "ai",
        generated,
        fromFallback: false,
        preview: buildPreviewQuestion(generated, "ai-preview"),
      });
    } catch (error) {
      toast({
        title: "AI 重新生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAIRegenLoading(false);
    }
  };

  const handleRandomPick = async () => {
    setRandomPickLoading(true);
    try {
      // 1) 先在原题所在题库内找相同题型、难度、知识点的候选。
      let candidates: IQuestion[] = [];
      if (question.question_bank_id) {
        const params = new URLSearchParams({
          _start: "0",
          _end: "500",
          type: question.type,
          difficulty_in: String(question.difficulty),
          question_bank_id: question.question_bank_id,
        });
        const questions = await apiRequest<IQuestion[]>(`/questions?${params}`);
        const existingSet = new Set(currentExamQuestionIds);
        const kpIdSet = new Set(question.knowledge_points.map((kp) => kp.id));
        candidates = questions.filter(
          (q) =>
            q.id !== question.id &&
            !existingSet.has(q.id) &&
            (kpIdSet.size === 0 ||
              (q.knowledge_points ?? []).some((kp) => kpIdSet.has(kp.id))),
        );
      }

      // 2) 题库里有合适题目：随机抽取并自动补全缺失的答案/解析。
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const completed = await apiRequest<IQuestion>(
          `/questions/${picked.id}/complete-answer`,
          { method: "POST" },
        );
        setPending({ kind: "random", preview: completed });
        return;
      }

      // 3) 题库里找不到：告知用户并改用 AI 生成。
      toast({
        title: "已改用 AI 生成",
        description: "题库中没有相同题型、难度、知识点的其他题目，已用 AI 自动生成。",
      });
      const generated = await streamGenerate(buildExamAIReplacementPrompt(question));
      setPending({
        kind: "ai",
        generated,
        fromFallback: true,
        preview: buildPreviewQuestion(generated, "ai-preview"),
      });
    } catch (error) {
      toast({
        title: "随机换题失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setRandomPickLoading(false);
    }
  };

  const confirmReplacement = async () => {
    if (!pending) return;
    setConfirmLoading(true);
    try {
      if (pending.kind === "random") {
        onReplaceQuestion(question.id, pending.preview.id);
        toast({ title: "已更换题目", description: "已替换为题库中的题目。" });
      } else {
        const banks = await apiRequest<Array<{ id: string; name: string }>>("/question-banks");
        let bankId = banks.find((b) => b.name === "AI题库")?.id;
        if (!bankId) {
          const created = await apiRequest<{ id: string }>("/question-banks", {
            method: "POST",
            body: JSON.stringify({ name: "AI题库", description: "AI 自动生成的考试题目" }),
          });
          bankId = created.id;
        }

        const g = pending.generated;
        const newQuestion = await apiRequest<IQuestion>("/questions", {
          method: "POST",
          body: JSON.stringify({
            type: g.type ?? question.type,
            title:
              (g.title as string) ||
              ((g.content as Record<string, string>)?.text?.slice(0, 120) ?? ""),
            content: g.content,
            options: g.options ?? null,
            answer: g.answer ?? {},
            analysis: (g.analysis as string) ?? null,
            difficulty: (g.difficulty as number) ?? question.difficulty,
            score: question.score,
            source: "ai_generated",
            tag_ids: [],
            knowledge_point_ids: replacementKnowledgePointIds,
            question_bank_id: bankId,
          }),
        });

        onReplaceQuestion(question.id, newQuestion.id);
        toast({ title: "已更换题目", description: "已替换为 AI 生成的新题。" });
      }
      setPending(null);
    } catch (error) {
      toast({
        title: "更换失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleRegenAnswerAnalysis = async () => {
    setRegenAnswerLoading(true);
    try {
      const generated = await streamGenerate(buildExamAnswerAnalysisPrompt(question));
      const updated = await apiRequest<IQuestion>(`/questions/${question.id}`, {
        method: "PUT",
        body: JSON.stringify({
          answer: generated.answer ?? {},
          analysis: (generated.analysis as string | null) ?? null,
        }),
      });
      onQuestionUpdated?.(updated);
      toast({ title: "已重新生成答案和解析" });
    } catch (error) {
      toast({
        title: "重新生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setRegenAnswerLoading(false);
    }
  };

  const handleManualEdit = () => {
    navigate(`/questions/edit/${question.id}`, {
      state: { backTo: `${location.pathname}${location.search}` },
    });
  };

  const isAnyLoading = aiRegenLoading || randomPickLoading;

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/30 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs font-medium hover:bg-primary/8 hover:text-primary"
          onClick={() => setAIPromptDialogOpen(true)}
          disabled={isAnyLoading}
        >
          {aiRegenLoading ? (
            <Loader2 size={12} className="animate-spin text-primary" />
          ) : (
            <Sparkles size={12} className="text-primary" />
          )}
          {aiRegenLoading ? "生成中…" : "AI重新生成"}
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs font-medium"
          onClick={handleRandomPick}
          disabled={isAnyLoading}
        >
          {randomPickLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Shuffle size={12} />
          )}
          {randomPickLoading ? "换题中…" : "随机换题"}
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs font-medium"
              disabled={isAnyLoading || regenAnswerLoading}
            >
              {regenAnswerLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Pencil size={12} />
              )}
              编辑
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>编辑题目</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleRegenAnswerAnalysis()}
              className="gap-2"
            >
              <Wand2 size={13} />
              重新生成答案和解析
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleManualEdit} className="gap-2">
              <ExternalLink size={13} />
              手动编辑题目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={aiPromptDialogOpen}
        onOpenChange={(open) => {
          if (!open && !aiRegenLoading) setAIPromptDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 换题提示词</DialogTitle>
            <DialogDescription>
              可以补充本次换题的额外要求，也可以留空直接生成。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exam-ai-replace-prompt">补充要求（可选）</Label>
            <Textarea
              id="exam-ai-replace-prompt"
              value={aiReplacementPrompt}
              onChange={(event) => setAIReplacementPrompt(event.target.value)}
              placeholder="例如：换成更贴近课堂案例的编程题，避免和原题使用相同场景。"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAIPromptDialogOpen(false)}
              disabled={aiRegenLoading}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleAIRegen(aiReplacementPrompt)}
              disabled={aiRegenLoading}
            >
              {aiRegenLoading ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1.5" />
              )}
              开始生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 换题预览：拿到新题后再让用户确认是否替换 */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !confirmLoading) setPending(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "random" ? "从题库抽取的新题" : "AI 生成的新题"}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "random"
                ? "已从原题所在题库中找到一道相同题型、难度、知识点的题目（缺失的答案/解析已自动补全）。确认后将替换当前题目，原题仍保留在题库中。"
                : pending?.fromFallback
                  ? "题库中没有符合条件的其他题目，已由 AI 自动生成。确认后将入库并替换当前题目。"
                  : "请预览以下新题，确认后将替换当前题目（相同题型、难度、知识点）。原题仍保留在题库中。"}
            </DialogDescription>
          </DialogHeader>

          {pending ? (
            <QuestionPreviewCard
              question={pending.preview}
              mode="detailed"
              defaultExpanded
              hideHeader
              hideMeta
              markChoiceAnswer
              className="rounded-2xl border-border/60 bg-background p-5"
            />
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={confirmLoading}
            >
              保留原题
            </Button>
            <Button onClick={() => void confirmReplacement()} disabled={confirmLoading}>
              {confirmLoading ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : null}
              确认更换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
