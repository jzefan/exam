// Chat-style question generation: the teacher types a free-form instruction,
// the selected 出题技能 grounds the run, questions stream back as cards, and each
// answered turn can be saved into the course bank.
//
// Reuses the same SSE event shape, question card, and save endpoint as the form
// mode — only the entry (a chat message) and the layout differ.

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ClipboardList, ListChecks, Loader2, Rocket, Send, Sparkles, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AIGeneratedQuestionCard,
  type AIGeneratedQuestionPreview,
} from "@/components/questions/ai-generated-question-card";
import type { QuestionType } from "@/types";
import { chatGenerateFromTemplate, saveGeneratedToCourseBank } from "./api";
import { hasCodeMissingAnswer, publishGenerated, type PublishTarget } from "./publish";

function answerText(answer: AIGeneratedQuestionPreview["answer"]): string {
  const raw = answer?.text ?? answer?.correct;
  if (Array.isArray(raw)) return raw.join("");
  return raw == null ? "" : String(raw).trim();
}

interface ChatTurn {
  id: string;
  prompt: string;
  questions: AIGeneratedQuestionPreview[];
  status: "streaming" | "done" | "error";
  error?: string;
  saved?: boolean;
}

export function ChatGenerate({
  skillId,
  skillName,
  courseId,
}: {
  skillId: string;
  skillName: string;
  courseId: string;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patchTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || generating) return;
    const turnId = `turn-${Date.now()}`;
    setTurns((prev) => [...prev, { id: turnId, prompt: message, questions: [], status: "streaming" }]);
    setInput("");
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let index = 0;
    try {
      const response = await chatGenerateFromTemplate(skillId, message, controller.signal);
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail ?? `请求失败：${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.replace(/^data:\s*/, ""));
          if (event.type === "question") {
            const next: AIGeneratedQuestionPreview = {
              index: index++,
              type: (event.data.type ?? "choice") as QuestionType,
              title: event.data.title ?? "",
              content: { text: event.data.content?.text ?? event.data.title ?? "" },
              options: event.data.options ?? null,
              answer: event.data.answer ?? {},
              analysis: event.data.analysis ?? null,
              difficulty: event.data.difficulty ?? 3,
              selected: true,
            };
            setTurns((prev) =>
              prev.map((t) => (t.id === turnId ? { ...t, questions: [...t.questions, next] } : t)),
            );
          } else if (event.type === "error") {
            throw new Error(event.message ?? "生成失败");
          }
        }
      }
      patchTurn(turnId, { status: "done" });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        patchTurn(turnId, { status: "done" });
      } else {
        patchTurn(turnId, { status: "error", error: String((error as Error).message ?? error) });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [input, generating, skillId, patchTurn]);

  const removeQuestion = useCallback((turnId: string, qIndex: number) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, questions: t.questions.filter((q) => q.index !== qIndex) } : t,
      ),
    );
  }, []);

  const saveTurn = useCallback(
    async (turn: ChatTurn) => {
      if (turn.questions.length === 0) return;
      const codeMissing = turn.questions.find((q) => q.type === "code" && !answerText(q.answer));
      if (codeMissing) {
        toast({ title: "代码题缺少参考答案", description: "请删除或补充后再保存。", variant: "destructive" });
        return;
      }
      setSavingId(turn.id);
      try {
        const payload = turn.questions.map((q) => ({
          type: q.type,
          title: q.title,
          content: q.content,
          options: q.options,
          answer: q.type === "code" ? { ...q.answer, code: answerText(q.answer) } : q.answer,
          analysis: q.analysis,
          difficulty: q.difficulty,
          score: 10,
          tag_ids: [],
          knowledge_point_ids: [courseId],
        }));
        const result = await saveGeneratedToCourseBank(payload);
        patchTurn(turn.id, { saved: true });
        toast({ title: `已保存 ${result.created_question_ids?.length ?? turn.questions.length} 道题到课程题库` });
      } catch (error) {
        toast({ title: "保存失败", description: String(error), variant: "destructive" });
      } finally {
        setSavingId(null);
      }
    },
    [courseId, patchTurn, toast],
  );

  const publishTurn = useCallback(
    async (turn: ChatTurn, target: PublishTarget) => {
      if (turn.questions.length === 0) return;
      if (hasCodeMissingAnswer(turn.questions)) {
        toast({ title: "代码题缺少参考答案", description: "请删除或补充后再发布。", variant: "destructive" });
        return;
      }
      setSavingId(turn.id);
      try {
        await publishGenerated({ courseId, questions: turn.questions, target, navigate });
      } catch (error) {
        toast({ title: "发布失败", description: String(error), variant: "destructive" });
        setSavingId(null);
      }
    },
    [courseId, navigate, toast],
  );

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[460px] flex-col rounded-xl border border-border/70 bg-card">
      {/* 对话区 */}
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Sparkles size={32} className="opacity-40" />
            <div>
              <p className="text-sm font-medium text-foreground">用对话出题</p>
              <p className="mt-1 text-xs leading-5">
                直接描述你想要的题目，例如：
                <br />
                “出 3 道关于子网划分的判断题和 2 道简答题，偏难”。
                <br />
                当前技能《{skillName}》会基于课程知识库出题。
              </p>
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              {/* 用户消息 */}
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                  {turn.prompt}
                </div>
              </div>

              {/* 生成结果 */}
              <div className="space-y-2">
                {turn.questions.map((q) => (
                  <AIGeneratedQuestionCard
                    key={q.index}
                    question={q}
                    onRemove={() => removeQuestion(turn.id, q.index)}
                  />
                ))}

                {turn.status === "streaming" && (
                  <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" />
                    正在基于课程知识库出题...
                  </div>
                )}
                {turn.status === "error" && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    出题失败：{turn.error}
                  </p>
                )}
                {turn.status === "done" && turn.questions.length > 0 && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">本轮生成 {turn.questions.length} 道题</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === turn.id || turn.saved}
                        onClick={() => void saveTurn(turn)}
                      >
                        {savingId === turn.id ? (
                          <Loader2 size={14} className="mr-1.5 animate-spin" />
                        ) : (
                          <Check size={14} className="mr-1.5" />
                        )}
                        {turn.saved ? "已保存" : `保存 ${turn.questions.length} 题`}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" disabled={savingId === turn.id}>
                            <Rocket size={14} className="mr-1.5" />
                            发布
                            <ChevronDown size={13} className="ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => void publishTurn(turn, "exam")}>
                            <ClipboardList size={14} className="mr-2" />
                            发布为考试
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void publishTurn(turn, "practice")}>
                            <ListChecks size={14} className="mr-2" />
                            发布为作业
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border/60 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="描述你想要的题目，回车发送（Shift+Enter 换行）…"
            className="min-h-[44px] resize-none text-sm"
            disabled={generating}
          />
          {generating ? (
            <Button variant="destructive" size="icon" className="h-11 w-11 shrink-0" onClick={() => abortRef.current?.abort()}>
              <StopCircle size={18} />
            </Button>
          ) : (
            <Button size="icon" className="h-11 w-11 shrink-0" disabled={!input.trim()} onClick={() => void send()}>
              <Send size={18} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
