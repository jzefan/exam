import { useMemo, useRef, useState } from "react";
import { Eye, Loader2, RefreshCcw, Shuffle, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { IQuestion, QuestionType } from "@/types";

import { QuestionPreviewCard } from "./question-preview-card";
import {
  buildQuestionReplacementKnowledgePointIds,
  buildQuestionReplacementPreviewQuestion,
  buildQuestionReplacementPrompt,
  describeQuestionStructure,
  getQuestionStructureSignature,
  getQuestionTypeLabel,
  streamGenerateReplacementQuestion,
  type QuestionReplacementApiRequest,
  type QuestionReplacementBankTarget,
  type QuestionReplacementCandidate,
  type QuestionReplacementConfirmPayload,
} from "./question-replacement-utils";

type ToastContent = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};


async function ensureQuestionBankByName(
  request: QuestionReplacementApiRequest,
  name: string,
  description: string,
): Promise<QuestionReplacementBankTarget> {
  const banks = await request<Array<QuestionReplacementBankTarget>>(
    "/question-banks",
  );
  const existing = banks.find((bank) => bank.name === name);
  if (existing) return existing;
  const created = await request<QuestionReplacementBankTarget>("/question-banks", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  return created;
}

async function defaultResolveTargetBank({
  question,
  request,
  fallbackBankName,
  fallbackBankDescription,
}: {
  question: IQuestion;
  request: QuestionReplacementApiRequest;
  fallbackBankName: string;
  fallbackBankDescription: string;
}): Promise<QuestionReplacementBankTarget> {
  if (question.question_bank_id) {
    return {
      id: question.question_bank_id,
      name: question.question_bank_name ?? "原题题库",
    };
  }
  return ensureQuestionBankByName(
    request,
    fallbackBankName,
    fallbackBankDescription,
  );
}

export function QuestionReplacementDialog({
  question,
  currentQuestionIds,
  request,
  onConfirmReplacement,
  resolveTargetBank,
  courseKnowledgePointId,
  rootKnowledgePointName,
  examTitle,
  questionLabel,
  triggerLabel = "题库换题",
  triggerTitle,
  triggerMode = "text",
  triggerVariant = "ghost",
  triggerSize = "sm",
  triggerClassName,
  disabled = false,
  autoPrepareOnOpen = "random",
  aiFallbackBankName = "AI题库",
  aiFallbackBankDescription = "AI 自动生成的考试题目",
  getSuccessToast,
}: {
  question: IQuestion;
  currentQuestionIds: string[];
  request: QuestionReplacementApiRequest;
  onConfirmReplacement: (
    payload: QuestionReplacementConfirmPayload,
  ) => Promise<void> | void;
  resolveTargetBank?: (
    question: IQuestion,
  ) => Promise<QuestionReplacementBankTarget>;
  courseKnowledgePointId?: string | null;
  rootKnowledgePointName?: string | null;
  examTitle?: string;
  questionLabel?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  triggerMode?: "text" | "icon";
  triggerVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerClassName?: string;
  disabled?: boolean;
  autoPrepareOnOpen?: "random" | null;
  aiFallbackBankName?: string;
  aiFallbackBankDescription?: string;
  getSuccessToast?: (
    payload: QuestionReplacementConfirmPayload,
  ) => ToastContent | null;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] =
    useState<QuestionReplacementCandidate | null>(null);
  const [replacementPrompt, setReplacementPrompt] = useState("");
  const [loadingMode, setLoadingMode] = useState<"random" | "ai" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showOriginalPanel, setShowOriginalPanel] = useState(false);
  const shownRandomQuestionIdsRef = useRef<Set<string>>(new Set());
  const shownRandomForQuestionIdRef = useRef<string | null>(null);

  const originalPreviewQuestion = useMemo<IQuestion>(
    () => ({
      ...question,
      answer: {},
      analysis: null,
      tags: [],
      knowledge_points: [],
      usage_count: 0,
    }),
    [question],
  );
  const knowledgePointIds = useMemo(
    () =>
      buildQuestionReplacementKnowledgePointIds(question, courseKnowledgePointId),
    [courseKnowledgePointId, question],
  );
  const isBusy = Boolean(loadingMode || confirming);

  const resolveBank = async () =>
    resolveTargetBank
      ? resolveTargetBank(question)
      : defaultResolveTargetBank({
          question,
          request,
          fallbackBankName: aiFallbackBankName,
          fallbackBankDescription: aiFallbackBankDescription,
        });

  const buildDefaultPrompt = (targetBankName?: string | null) =>
    buildQuestionReplacementPrompt(question, {
      rootKnowledgePointName,
      targetBankName,
    });

  const prepareAIReplacement = async (promptOverride?: string) => {
    setLoadingMode("ai");
    try {
      const targetBank = await resolveBank();
      const prompt = (promptOverride ?? replacementPrompt).trim() || buildDefaultPrompt(targetBank.name);
      const generated = await streamGenerateReplacementQuestion({
        question,
        knowledgePointIds,
        examTitle,
        prompt,
      });
      setReplacementPrompt(prompt);
      setCandidate({
        kind: "ai",
        preview: buildQuestionReplacementPreviewQuestion({
          generated,
          originalQuestion: question,
          targetBank,
          knowledgePoints: question.knowledge_points,
        }),
        targetBank,
        generated,
      });
    } catch (error) {
      toast({
        title: "AI 换题失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setLoadingMode(null);
    }
  };

  const prepareRandomReplacement = async (promptOverride?: string) => {
    setLoadingMode("random");
    setCandidate(null);
    try {
      if (shownRandomForQuestionIdRef.current !== question.id) {
        shownRandomQuestionIdsRef.current.clear();
        shownRandomForQuestionIdRef.current = question.id;
      }
      const targetBank = await resolveBank();
      const params = new URLSearchParams({
        _start: "0",
        _end: "500",
        type: question.type,
        difficulty_in: String(question.difficulty),
        question_bank_id: targetBank.id,
      });
      const bankQuestions = await request<IQuestion[]>(`/questions?${params}`);
      const existingSet = new Set(currentQuestionIds);
      const knowledgePointSet = new Set(knowledgePointIds);
      const structureSignature = getQuestionStructureSignature(question);
      const candidates = bankQuestions.filter(
        (item) =>
          item.id !== question.id &&
          !existingSet.has(item.id) &&
          item.type === question.type &&
          item.difficulty === question.difficulty &&
          getQuestionStructureSignature(item) === structureSignature &&
          (knowledgePointSet.size === 0 ||
            (item.knowledge_points ?? []).some((kp) =>
              knowledgePointSet.has(kp.id),
            )),
      );

      if (candidates.length > 0) {
        const currentRandomCandidateId =
          candidate?.kind === "random" ? candidate.preview.id : null;
        const unseenCandidates = candidates.filter(
          (item) => !shownRandomQuestionIdsRef.current.has(item.id),
        );
        let pickableCandidates = unseenCandidates;

        if (pickableCandidates.length === 0) {
          shownRandomQuestionIdsRef.current.clear();
          pickableCandidates =
            currentRandomCandidateId && candidates.length > 1
              ? candidates.filter((item) => item.id !== currentRandomCandidateId)
              : candidates;
        }

        const picked =
          pickableCandidates[
            Math.floor(Math.random() * pickableCandidates.length)
          ];
        const completed = await request<IQuestion>(
          `/questions/${picked.id}/complete-answer`,
          { method: "POST" },
        );
        shownRandomQuestionIdsRef.current.add(picked.id);
        if (currentRandomCandidateId === picked.id && candidates.length === 1) {
          toast({
            title: "暂无其他候选",
            description:
              "同一题库中当前只找到这一道符合题型、难度、知识点和结构要求的题目。",
          });
        }
        setReplacementPrompt(
          promptOverride?.trim() || replacementPrompt || buildDefaultPrompt(targetBank.name),
        );
        setCandidate({
          kind: "random",
          preview: completed,
          targetBank,
        });
        return;
      }

      toast({
        title: "未找到题库候选",
        description:
          "同一题库中没有符合题型、难度、知识点和结构要求的其他题目。可以改用右侧 AI 换题生成新题。",
      });
    } catch (error) {
      toast({
        title: "题库换题失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setLoadingMode((current) => (current === "random" ? null : current));
    }
  };

  const openReplacementDialog = () => {
    const initialPrompt = buildDefaultPrompt(question.question_bank_name);
    setOpen(true);
    setCandidate(null);
    setReplacementPrompt(initialPrompt);
    setLoadingMode(null);
    setConfirming(false);
    setShowOriginalPanel(false);
    if (autoPrepareOnOpen === "random") {
      window.setTimeout(() => {
        void prepareRandomReplacement(initialPrompt);
      }, 0);
    }
  };

  const confirmReplacement = async () => {
    if (!candidate) return;
    setConfirming(true);
    try {
      let replacementQuestion = candidate.preview;
      if (candidate.kind === "ai") {
        const generated = candidate.generated ?? {};
        replacementQuestion = await request<IQuestion>("/questions", {
          method: "POST",
          body: JSON.stringify({
            type: (generated.type as QuestionType | undefined) ?? question.type,
            title:
              (generated.title as string | undefined) ||
              ((generated.content as { text?: string } | undefined)?.text?.slice(
                0,
                120,
              ) ??
                question.title),
            content:
              (generated.content as IQuestion["content"] | undefined) ?? {
                text: "",
              },
            options:
              (generated.options as IQuestion["options"] | undefined) ?? null,
            answer: (generated.answer as IQuestion["answer"] | undefined) ?? {},
            analysis:
              (generated.analysis as string | null | undefined) ?? null,
            difficulty:
              (generated.difficulty as number | undefined) ??
              question.difficulty,
            score: question.score,
            source: "ai_generated",
            tag_ids: [],
            knowledge_point_ids: knowledgePointIds,
            question_bank_id: candidate.targetBank.id,
          }),
        });
      }

      const payload = {
        originalQuestion: question,
        replacementQuestion,
        candidate,
      };
      await onConfirmReplacement(payload);
      const successToast =
        getSuccessToast?.(payload) ??
        ({
          title: "已更换题目",
          description:
            candidate.kind === "ai"
              ? `已用 AI 生成并保存到「${candidate.targetBank.name}」。`
              : `已从「${candidate.targetBank.name}」中替换为同类题目。`,
        } satisfies ToastContent);
      if (successToast) {
        toast(successToast);
      }
      setCandidate(null);
      setOpen(false);
      setShowOriginalPanel(false);
    } catch (error) {
      toast({
        title: "换题失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={cn(triggerClassName)}
        disabled={disabled || isBusy}
        onClick={openReplacementDialog}
        title={triggerTitle ?? triggerLabel}
        aria-label={triggerMode === "icon" ? triggerLabel : undefined}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : triggerMode === "icon" ? (
          <RefreshCcw className="h-4 w-4" />
        ) : (
          <Shuffle className="h-4 w-4" />
        )}
        {triggerMode === "text" ? (
          <span>{loadingMode === "random" ? "题库换题中..." : triggerLabel}</span>
        ) : null}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isBusy) {
            setOpen(false);
            setCandidate(null);
            setShowOriginalPanel(false);
          }
        }}
      >
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[1440px] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {questionLabel ? `为${questionLabel}换一题` : "为当前题目换一题"}
            </DialogTitle>
            <DialogDescription>
              题库换题只从原题所在题库查找相似题；AI 换题会根据提示词生成新题。确认后才会替换当前题目，原题仍保留在题库中。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <section className="grid min-h-0 gap-4 overflow-hidden lg:grid-cols-2">
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">题库换题</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    从原题所在题库查找相似题，不生成新题，也不写入题库。
                  </p>
                </div>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">题库：</span>
                    {question.question_bank_name ?? "原题所在题库"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">题型：</span>
                    {getQuestionTypeLabel(question.type)}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">难度：</span>
                    {question.difficulty}/5
                  </div>
                  <div>
                    <span className="font-medium text-foreground">知识点：</span>
                    {question.knowledge_points.map((kp) => kp.name).join("、") ||
                      rootKnowledgePointName ||
                      "当前课程主知识点"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">结构：</span>
                    {describeQuestionStructure(question)}
                  </div>
                </div>
                <Button
                  type="button"
                  className="mt-auto w-full"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void prepareRandomReplacement()}
                >
                  {loadingMode === "random" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Shuffle className="h-4 w-4" />
                  )}
                  {loadingMode === "random" ? "正在题库换题..." : "题库换题"}
                </Button>
              </div>

              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border/60 p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">AI 换题</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    根据提示词生成新题，确认后保存回原题题库再替换。
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">提示词</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    默认提示词已包含同类型、同知识点、同难度和结构相似的要求，可按本次命题意图修改。
                  </p>
                </div>
                <Textarea
                  value={replacementPrompt}
                  onChange={(event) => setReplacementPrompt(event.target.value)}
                  rows={14}
                  disabled={isBusy}
                  className="min-h-[300px] text-xs leading-5"
                />
                <Button
                  type="button"
                  className="mt-auto w-full"
                  disabled={isBusy}
                  onClick={() => void prepareAIReplacement()}
                >
                  {loadingMode === "ai" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {loadingMode === "ai" ? "正在 AI 换题..." : "AI 换题"}
                </Button>
              </div>
            </section>

            <section className="relative min-h-0 overflow-hidden rounded-lg border border-border/60">
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-border/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {candidate
                          ? candidate.kind === "random"
                            ? "题库换题候选"
                            : "AI 换题候选"
                          : "候选题预览"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {candidate
                          ? candidate.kind === "random"
                            ? "已从题库中找到候选题。"
                            : "已生成 AI 候选题。"
                          : loadingMode
                            ? "正在准备候选题..."
                            : "点击题库换题或 AI 换题后，在这里预览新题。"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOriginalPanel(true)}
                    >
                      <Eye className="h-4 w-4" />
                      查看原题
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {candidate ? (
                    <QuestionPreviewCard
                      question={candidate.preview}
                      mode="detailed"
                      defaultExpanded
                      hideMeta
                      markChoiceAnswer
                    />
                  ) : (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-border/70 px-6 text-center text-sm leading-6 text-muted-foreground">
                      {loadingMode
                        ? "正在准备候选题，请稍候。"
                        : "尚未生成候选题。请选择题库换题查找现有题，或选择 AI 换题生成新题。"}
                    </div>
                  )}
                </div>
              </div>

              {showOriginalPanel ? (
                <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl">
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">原题</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        默认不展开，仅用于对照题干和选项。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowOriginalPanel(false)}
                      aria-label="关闭原题"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <QuestionPreviewCard
                      question={originalPreviewQuestion}
                      mode="detailed"
                      expandOnClick
                      hideHeader
                      hideMeta
                      hideScoreAndDifficulty
                      className="cursor-pointer rounded-lg border-border/60 bg-background p-3 transition-colors hover:border-primary/40"
                    />
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => {
                setOpen(false);
                setCandidate(null);
                setShowOriginalPanel(false);
              }}
            >
              保留原题
            </Button>
            <Button
              type="button"
              disabled={!candidate || isBusy}
              onClick={() => void confirmReplacement()}
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              确定换题
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
