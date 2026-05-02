import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { IQuestion, QuestionType } from "@/types";

import { QuestionPreviewCard } from "./question-preview-card";

export type AIGeneratedQuestionPreview = {
  index: number;
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string | boolean | string[] };
  analysis: string | null;
  difficulty: number;
  selected: boolean;
  persistedQuestionId?: string;
};

function toPreviewQuestion(question: AIGeneratedQuestionPreview): IQuestion {
  const now = new Date().toISOString();
  return {
    id: `ai-generated-${question.index}`,
    type: question.type,
    title: question.title,
    content: question.content,
    options: question.options,
    answer: question.answer as Record<string, unknown>,
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
    created_at: now,
    updated_at: now,
  };
}

export function AIGeneratedQuestionCard({
  question,
  onToggleSelected,
  onRemove,
  className,
}: {
  question: AIGeneratedQuestionPreview;
  onToggleSelected?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <QuestionPreviewCard
      question={toPreviewQuestion(question)}
      mode="detailed"
      defaultExpanded
      index={question.index + 1}
      className={cn(
        "transition-colors shadow-none",
        question.selected
          ? "border-primary/15 bg-primary/[0.012] ring-1 ring-primary/6"
          : "border-border/35 bg-background/90",
        className,
      )}
      trailing={
        <div className="flex items-center gap-2">
          {onToggleSelected ? (
            <Checkbox
              checked={question.selected}
              aria-label={question.selected ? "取消选择题目" : "选择题目"}
              onCheckedChange={onToggleSelected}
            />
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-destructive"
              aria-label="移除题目"
              onClick={onRemove}
            >
              <Trash2 data-icon="inline-start" />
              移除
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
