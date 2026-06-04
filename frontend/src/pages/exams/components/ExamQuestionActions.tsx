import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Shuffle, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/pages/grading/api";
import type { IQuestion } from "@/types";

interface ExamQuestionActionsProps {
  question: IQuestion;
  currentExamQuestionIds: string[];
  onReplaceQuestion: (oldId: string, newId: string) => void;
}

export function ExamQuestionActions({
  question,
  currentExamQuestionIds,
  onReplaceQuestion,
}: ExamQuestionActionsProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [aiRegenLoading, setAIRegenLoading] = useState(false);
  const [randomPickLoading, setRandomPickLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"ai" | "random" | null>(null);

  const knowledgePointIds = question.knowledge_points.map((kp) => kp.id);

  const handleAIRegen = async () => {
    setAIRegenLoading(true);
    try {
      const banks = await apiRequest<Array<{ id: string; name: string }>>("/question-banks");
      let bankId = banks.find((b) => b.name === "AI题库")?.id;
      if (!bankId) {
        const created = await apiRequest<{ id: string }>("/question-banks", {
          method: "POST",
          body: JSON.stringify({ name: "AI题库", description: "AI 自动生成的考试题目" }),
        });
        bankId = created.id;
      }

      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // 相同题型、相同难度、相同知识点
          total_count: 1,
          difficulty: question.difficulty,
          type_distribution: { [question.type]: 1 },
          knowledge_point_ids: knowledgePointIds,
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

      const newQuestion = await apiRequest<IQuestion>("/questions", {
        method: "POST",
        body: JSON.stringify({
          type: generated.type ?? question.type,
          title:
            (generated.title as string) ||
            ((generated.content as Record<string, string>)?.text?.slice(0, 120) ?? ""),
          content: generated.content,
          options: generated.options ?? null,
          answer: generated.answer ?? {},
          analysis: (generated.analysis as string) ?? null,
          difficulty: (generated.difficulty as number) ?? question.difficulty,
          score: question.score,
          tag_ids: [],
          knowledge_point_ids: knowledgePointIds,
          question_bank_id: bankId,
        }),
      });

      onReplaceQuestion(question.id, newQuestion.id);
      toast({ title: "AI 重新生成成功", description: "已用相同题型、难度、知识点的新题替换原题。" });
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
      // 相同题型、相同难度，知识点在前端按交集筛选（API 仅支持单个知识点过滤）
      const params = new URLSearchParams({
        page_size: "500",
        type: question.type,
        difficulty: String(question.difficulty),
      });
      const questions = await apiRequest<IQuestion[]>(`/questions?${params}`);
      const existingSet = new Set(currentExamQuestionIds);
      const kpIdSet = new Set(knowledgePointIds);
      const candidates = questions.filter(
        (q) =>
          q.id !== question.id &&
          !existingSet.has(q.id) &&
          // 相同知识点：原题无知识点则不限制，否则要求知识点有交集
          (kpIdSet.size === 0 ||
            (q.knowledge_points ?? []).some((kp) => kpIdSet.has(kp.id))),
      );

      if (candidates.length === 0) {
        toast({
          title: "没有可替换的题目",
          description: "题库中暂无相同题型、难度、知识点的其他题目可供替换。",
          variant: "destructive",
        });
        return;
      }

      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      onReplaceQuestion(question.id, picked.id);
      toast({ title: "随机换题成功", description: "已从题库随机替换一道相同题型、难度、知识点的题目。" });
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

  const handleEdit = () => {
    navigate(`/questions/edit/${question.id}`, {
      state: { backTo: `${location.pathname}${location.search}` },
    });
  };

  const isAnyLoading = aiRegenLoading || randomPickLoading;

  const confirmConfig = {
    ai: {
      title: "确认用 AI 重新生成本题？",
      description:
        "将生成一道相同题型、难度、知识点的新题，替换当前题目（原题仍保留在题库中）。此操作会更新试卷内容，确定继续吗？",
      action: handleAIRegen,
    },
    random: {
      title: "确认随机换题？",
      description:
        "将从题库随机抽取一道相同题型、难度、知识点的题目，替换当前题目。此操作会更新试卷内容，确定继续吗？",
      action: handleRandomPick,
    },
  } as const;

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/30 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs font-medium hover:bg-primary/8 hover:text-primary"
          onClick={() => setConfirmAction("ai")}
          disabled={isAnyLoading}
        >
          {aiRegenLoading ? (
            <Loader2 size={12} className="animate-spin text-primary" />
          ) : (
            <Sparkles size={12} className="text-primary" />
          )}
          AI重新生成
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs font-medium"
          onClick={() => setConfirmAction("random")}
          disabled={isAnyLoading}
        >
          {randomPickLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Shuffle size={12} />
          )}
          随机换题
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs font-medium"
          onClick={handleEdit}
          disabled={isAnyLoading}
        >
          <Pencil size={12} />
          修改题目
        </Button>
      </div>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction ? confirmConfig[confirmAction].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction ? confirmConfig[confirmAction].description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                if (action) void confirmConfig[action].action();
              }}
            >
              确定替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
