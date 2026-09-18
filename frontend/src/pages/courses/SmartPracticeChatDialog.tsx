import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Sparkles, Square } from "lucide-react";

import {
  AIGeneratedQuestionCard,
  type AIGeneratedQuestionPreview,
} from "@/components/questions/ai-generated-question-card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { getDefaultScore } from "@/lib/question-defaults";
import { getPublishedExamStatus } from "@/pages/exams/components/exam-form-utils";
import { ClassStudentSelector } from "@/pages/exams/components/ClassStudentSelector";
import type { QuestionType } from "@/types";

import {
  buildSmartPracticeConversationPrompt,
  buildSmartPracticeReplacementPrompt,
  parseSmartPracticeChatPrompt,
  parseSmartPracticeReplacementTarget,
  type SmartPracticeChatIntent,
  type SmartPracticeKnowledgeOption,
} from "./smart-practice-utils";

type ChatTurnStatus = "streaming" | "done" | "error";
type DialogStage = "chat" | "publish";

type ChatTurn = {
  id: string;
  prompt: string;
  questions: AIGeneratedQuestionPreview[];
  status: ChatTurnStatus;
  intent: SmartPracticeChatIntent;
  progress: string[];
  summary?: string;
  error?: string;
};

const PROMPT_SUGGESTIONS = [
  "生成 10 道容易题",
  "生成 5 道选择题和 5 道简答题",
  "覆盖本章重点，难度适中",
];

function defaultPracticeTitle(courseName: string): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${courseName}-${month}${day}练习`;
}

function generatedQuestionFromEvent(
  data: Record<string, unknown>,
  index: number,
  fallbackDifficulty: number,
): AIGeneratedQuestionPreview {
  const content = data.content as { text?: string } | undefined;
  return {
    index,
    type: (data.type ?? "choice") as QuestionType,
    title: String(data.title ?? ""),
    content: { text: content?.text ?? String(data.title ?? "") },
    options:
      data.options && typeof data.options === "object"
        ? (data.options as Record<string, string>)
        : null,
    answer:
      data.answer && typeof data.answer === "object"
        ? (data.answer as AIGeneratedQuestionPreview["answer"])
        : {},
    analysis: typeof data.analysis === "string" ? data.analysis : null,
    difficulty:
      typeof data.difficulty === "number"
        ? data.difficulty
        : fallbackDifficulty,
    selected: true,
  };
}

function replacementTypeDistribution(
  question: AIGeneratedQuestionPreview,
): Record<string, number> {
  if (question.type !== "choice") return { [question.type]: 1 };
  const isMultipleChoice = Array.isArray(question.answer.correct);
  return { [isMultipleChoice ? "multi_choice" : "single_choice"]: 1 };
}

export interface SmartPracticeChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseName: string;
  courseKpId: string;
  courseSemesterId: string | null;
  knowledgeOptions: SmartPracticeKnowledgeOption[];
  initialKnowledgePointId?: string | null;
  onPublished?: (examId: string) => void | Promise<void>;
}

export function SmartPracticeChatDialog({
  open,
  onOpenChange,
  courseName,
  courseKpId,
  courseSemesterId,
  knowledgeOptions,
  initialKnowledgePointId = null,
  onPublished,
}: SmartPracticeChatDialogProps) {
  const { toast } = useToast();
  const [stage, setStage] = useState<DialogStage>("chat");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [title, setTitle] = useState(() => defaultPracticeTitle(courseName));
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("chat");
    setTurns([]);
    setInput("");
    setTitle(defaultPracticeTitle(courseName));
    setStudentIds([]);
    setGenerating(false);
    setPublishing(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [courseName, open]);

  const patchTurn = useCallback((turnId: string, patch: Partial<ChatTurn>) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId ? { ...turn, ...patch } : turn,
      ),
    );
  }, []);

  const appendTurnProgress = useCallback((turnId: string, message: string) => {
    if (!message.trim()) return;
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== turnId || turn.progress.at(-1) === message) return turn;
        return { ...turn, progress: [...turn.progress, message].slice(-6) };
      }),
    );
  }, []);

  const latestCompletedTurn = useMemo(
    () =>
      [...turns]
        .reverse()
        .find(
          (turn) => turn.status === "done" && turn.questions.length > 0,
        ) ?? null,
    [turns],
  );
  const selectedQuestions =
    latestCompletedTurn?.questions.filter((question) => question.selected) ?? [];

  useEffect(() => {
    if (stage !== "chat") return;
    const viewport = chatScrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [stage, turns]);

  const sendMessage = useCallback(async () => {
    const message = input.trim();
    if (!message || generating) return;

    const previousTurn = [...turns]
      .reverse()
      .find((turn) => turn.status === "done" && turn.questions.length > 0);
    const intent = parseSmartPracticeChatPrompt(message, knowledgeOptions, {
      count: previousTurn?.intent.count ?? 10,
      difficulty: previousTurn?.intent.difficulty ?? 3,
      knowledgePointId:
        previousTurn?.intent.knowledgePointId ??
        initialKnowledgePointId ??
        courseKpId,
    });
    const replacementTargetIndex = previousTurn
      ? parseSmartPracticeReplacementTarget(
          message,
          previousTurn.questions.length,
        )
      : null;
    const replacementQuestion =
      replacementTargetIndex == null
        ? null
        : previousTurn?.questions[replacementTargetIndex];
    const isReplacement = Boolean(previousTurn && replacementQuestion);
    const requestCount = isReplacement ? 1 : intent.count;
    const turnId = `smart-practice-${Date.now()}`;
    const contextPrompt =
      isReplacement && previousTurn && replacementTargetIndex != null
        ? buildSmartPracticeReplacementPrompt(
            previousTurn.questions,
            replacementTargetIndex,
            message,
          )
        : buildSmartPracticeConversationPrompt(
            turns
              .filter((turn) => turn.status === "done")
              .map((turn) => ({
                prompt: turn.prompt,
                questions: turn.questions,
              })),
            message,
          );

    setTurns((current) => [
      ...current,
      {
        id: turnId,
        prompt: message,
        questions: [],
        status: "streaming",
        intent,
        progress: [
          isReplacement && replacementTargetIndex != null
            ? `已识别为局部修改，保留其余 ${Math.max(0, (previousTurn?.questions.length ?? 1) - 1)} 道题`
            : "正在理解本轮要求",
        ],
      },
    ]);
    setInput("");
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          total_count: requestCount,
          difficulty: replacementQuestion?.difficulty ?? intent.difficulty,
          type_distribution: replacementQuestion
            ? replacementTypeDistribution(replacementQuestion)
            : Object.values(intent.typeDistribution ?? {}).reduce(
                  (total, count) => total + (count ?? 0),
                  0,
                ) === requestCount
              ? intent.typeDistribution
              : undefined,
          knowledge_point_ids: intent.knowledgePointId
            ? [intent.knowledgePointId]
            : undefined,
          course_name: courseName,
          exam_title: title.trim() || undefined,
          prompt: contextPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail ?? `请求失败：${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let questionIndex = 0;
      let generatedQuestions: AIGeneratedQuestionPreview[] = [];

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
          const event = JSON.parse(dataLine.replace(/^data:\s*/, "")) as {
            type: string;
            data?: Record<string, unknown>;
            message?: string;
          };
          if (event.type === "status") {
            appendTurnProgress(turnId, String(event.message ?? ""));
          } else if (event.type === "question" && event.data) {
            const resultIndex =
              isReplacement && replacementTargetIndex != null
                ? replacementTargetIndex
                : questionIndex;
            const question = generatedQuestionFromEvent(
              event.data,
              resultIndex,
              replacementQuestion?.difficulty ?? intent.difficulty,
            );
            questionIndex += 1;
            if (
              isReplacement &&
              previousTurn &&
              replacementTargetIndex != null
            ) {
              generatedQuestions = previousTurn.questions.map((current, index) =>
                index === replacementTargetIndex ? question : { ...current },
              );
              patchTurn(turnId, { questions: generatedQuestions });
              appendTurnProgress(
                turnId,
                `已生成替换题，正在校验第 ${replacementTargetIndex + 1} 题`,
              );
            } else {
              generatedQuestions = [...generatedQuestions, question];
              patchTurn(turnId, { questions: generatedQuestions });
              appendTurnProgress(
                turnId,
                `已生成 ${generatedQuestions.length}/${requestCount} 道题`,
              );
            }
          } else if (event.type === "error") {
            throw new Error(event.message ?? "生成失败");
          }
        }
      }

      if (generatedQuestions.length === 0) {
        throw new Error("未生成题目，请调整要求后重试");
      }
      patchTurn(turnId, {
        status: "done",
        summary:
          isReplacement && replacementTargetIndex != null
            ? `已替换第 ${replacementTargetIndex + 1} 题`
            : `本轮生成 ${generatedQuestions.length} 道题`,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  status: turn.questions.length > 0 ? "done" : "error",
                  error: turn.questions.length > 0 ? undefined : "已停止生成",
                }
              : turn,
          ),
        );
      } else {
        patchTurn(turnId, {
          status: "error",
          error: error instanceof Error ? error.message : "生成失败",
        });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [
    courseKpId,
    courseName,
    appendTurnProgress,
    generating,
    initialKnowledgePointId,
    input,
    knowledgeOptions,
    patchTurn,
    title,
    turns,
  ]);

  const toggleQuestion = (turnId: string, questionIndex: number) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              questions: turn.questions.map((question) =>
                question.index === questionIndex
                  ? { ...question, selected: !question.selected }
                  : question,
              ),
            }
          : turn,
      ),
    );
  };

  const publish = async () => {
    if (
      !latestCompletedTurn ||
      selectedQuestions.length === 0 ||
      studentIds.length === 0 ||
      !title.trim() ||
      publishing
    ) {
      return;
    }

    setPublishing(true);
    try {
      const knowledgePointId =
        latestCompletedTurn.intent.knowledgePointId ?? courseKpId;
      const saveResponse = await apiClient.post<{
        created_question_ids: string[];
      }>("/api/questions/save-generated-to-course-bank", {
        questions: selectedQuestions.map((question) => ({
          type: question.type,
          title: question.title,
          content: question.content,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          difficulty: question.difficulty,
          score: getDefaultScore(
            question.type,
            Array.isArray(question.answer.correct),
          ),
          tag_ids: [],
          knowledge_point_ids: [knowledgePointId],
        })),
      });
      const questionIds = saveResponse.data.created_question_ids ?? [];
      if (questionIds.length === 0) {
        throw new Error("题目保存失败，请重试");
      }

      const now = new Date();
      const endAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const scores = selectedQuestions.map((question) =>
        getDefaultScore(
          question.type,
          Array.isArray(question.answer.correct),
        ),
      );
      const totalScore = scores.reduce((sum, score) => sum + score, 0);
      const examResponse = await apiClient.post<{ id: string }>("/api/exams", {
        category: "practice",
        title: title.trim(),
        description: null,
        start_time: now.toISOString(),
        end_time: endAt.toISOString(),
        duration_minutes: 60,
        total_score: totalScore,
        status: getPublishedExamStatus(
          { start_time: now.toISOString(), end_time: endAt.toISOString() },
          now,
        ),
        question_mode: "ai",
        question_items: questionIds.map((questionId, index) => ({
          question_id: questionId,
          order: index,
          score_override: scores[index] ?? null,
        })),
        question_ids: questionIds,
        student_ids: studentIds,
        course_kp_id: knowledgePointId,
        course_semester_id: courseSemesterId ?? undefined,
      });

      toast({
        title: "练习已发布",
        description: `${questionIds.length} 道题 · 有效期 7 天`,
      });
      onOpenChange(false);
      await onPublished?.(examResponse.data.id);
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

  const canPublish =
    !generating &&
    !publishing &&
    selectedQuestions.length > 0 &&
    studentIds.length > 0 &&
    title.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!generating && !publishing) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex h-[min(860px,90vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles aria-hidden="true" />
            {stage === "chat" ? "智能练习" : "发布练习"}
          </DialogTitle>
          <DialogDescription>
            {stage === "chat"
              ? courseName
              : `已确定 ${selectedQuestions.length} 道题`}
          </DialogDescription>
        </DialogHeader>
        <Separator />

        {stage === "chat" ? (
          <>
            <ScrollArea ref={chatScrollAreaRef} className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-5">
                {turns.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles aria-hidden="true" />
                      描述你想要的练习
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {PROMPT_SUGGESTIONS.map((suggestion) => (
                        <Button
                          key={suggestion}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setInput(suggestion)}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  turns.map((turn) => (
                    <div key={turn.id} className="flex flex-col gap-3">
                      <div className="flex justify-end">
                        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
                          {turn.prompt}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Sparkles aria-hidden="true" />
                          AI
                        </div>
                        {turn.progress.length > 0 ? (
                          <div
                            role="status"
                            aria-live="polite"
                            className="flex flex-col gap-1 border-l-2 border-muted pl-3 text-xs text-muted-foreground"
                          >
                            {turn.progress.map((message, index) => (
                              <div
                                key={`${turn.id}-progress-${index}`}
                                className="flex items-center gap-2"
                              >
                                {turn.status === "streaming" &&
                                index === turn.progress.length - 1 ? (
                                  <Spinner />
                                ) : null}
                                <span>{message}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {turn.questions.map((question) => (
                          <AIGeneratedQuestionCard
                            key={question.index}
                            question={question}
                            onToggleSelected={() =>
                              toggleQuestion(turn.id, question.index)
                            }
                          />
                        ))}
                        {turn.status === "done" ? (
                          <p className="text-xs text-muted-foreground">
                            {turn.summary ?? `本轮生成 ${turn.questions.length} 道题`}
                          </p>
                        ) : null}
                        {turn.status === "error" ? (
                          <p className="text-sm text-destructive">
                            {turn.error}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <Separator />
            <div className="shrink-0 px-5 py-3">
              <div className="mx-auto flex max-w-4xl items-end gap-2">
                <Textarea
                  aria-label="练习对话输入"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="描述题量、范围、题型或难度"
                  className="max-h-32 min-h-12 resize-none"
                  rows={2}
                  maxLength={2000}
                  disabled={generating}
                />
                {generating ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label="停止生成"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Square />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    className="shrink-0"
                    aria-label="发送"
                    disabled={!input.trim()}
                    onClick={() => void sendMessage()}
                  >
                    <Send />
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex max-w-4xl flex-col gap-5 px-5 py-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="smart-practice-chat-title">练习名称</Label>
                <Input
                  id="smart-practice-chat-title"
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
          </ScrollArea>
        )}

        <Separator />
        <DialogFooter className="shrink-0 items-center px-5 py-4 sm:justify-between sm:space-x-0">
          <span className="text-xs text-muted-foreground">
            {stage === "chat"
              ? latestCompletedTurn
                ? `当前选择 ${selectedQuestions.length} 道题`
                : "可连续发送要求调整题单"
              : `有效期 7 天 · ${selectedQuestions.length} 道题`}
          </span>
          <div className="flex items-center gap-2">
            {stage === "chat" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={generating}
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={
                    generating ||
                    !latestCompletedTurn ||
                    selectedQuestions.length === 0
                  }
                  onClick={() => setStage("publish")}
                >
                  确定题目
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={publishing}
                  onClick={() => setStage("chat")}
                >
                  返回调整
                </Button>
                <Button
                  type="button"
                  disabled={!canPublish}
                  onClick={() => void publish()}
                >
                  {publishing ? <Spinner data-icon="inline-start" /> : null}
                  确定发布 · 7 天
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
