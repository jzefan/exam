import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, Pencil, Wand2 } from "lucide-react";

import { QuestionReplacementDialog } from "@/components/questions/question-replacement-dialog";
import { streamGenerateReplacementQuestion } from "@/components/questions/question-replacement-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/pages/grading/api";
import type { IQuestion } from "@/types";

import {
  buildExamAIReplacementKnowledgePointIds,
  buildExamAnswerAnalysisPrompt,
} from "./ExamQuestionActions.helpers";

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
  const [regenAnswerLoading, setRegenAnswerLoading] = useState(false);

  const replacementKnowledgePointIds = buildExamAIReplacementKnowledgePointIds(
    question,
    courseKnowledgePointId,
  );

  /** 调用流式接口生成一道题（仅返回数据，不入库）。prompt 决定是换题还是补答案。 */
  const streamGenerate = (prompt: string): Promise<Record<string, unknown>> =>
    streamGenerateReplacementQuestion({
      question,
      knowledgePointIds: replacementKnowledgePointIds,
      examTitle,
      prompt,
    });

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

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/30 p-0.5">
      <QuestionReplacementDialog
        question={question}
        currentQuestionIds={currentExamQuestionIds}
        request={apiRequest}
        onConfirmReplacement={({ originalQuestion, replacementQuestion }) => {
          onReplaceQuestion(originalQuestion.id, replacementQuestion.id);
        }}
        courseKnowledgePointId={courseKnowledgePointId}
        examTitle={examTitle}
        triggerLabel="题库换题"
        triggerVariant="ghost"
        triggerSize="sm"
        triggerClassName="h-7 gap-1.5 px-2.5 text-xs font-medium"
        autoPrepareOnOpen="random"
      />
      <div className="h-4 w-px bg-border/60" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs font-medium"
            disabled={regenAnswerLoading}
          >
            {regenAnswerLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
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
            <Wand2 className="h-3.5 w-3.5" />
            重新生成答案和解析
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleManualEdit} className="gap-2">
            <ExternalLink className="h-3.5 w-3.5" />
            手动编辑题目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
